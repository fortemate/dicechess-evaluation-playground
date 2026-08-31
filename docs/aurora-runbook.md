<!--
SPDX-FileCopyrightText: 2026 Jegors Čemisovs
SPDX-License-Identifier: AGPL-3.0-only
-->

# Aurora deployment runbook

This runbook prepares and operates one protected evaluation-playground candidate on Aurora. It does not authorize a deployment, a model transfer, secret provisioning, or a Cloudflare change. Those are separate human-controlled steps tracked by Issues #12 and #13.

## Security and runtime shape

The Compose project runs two non-root containers:

```text
cloudflared on Aurora -> 127.0.0.1:3100 -> playground/BFF -> private network -> evaluator
```

Only the playground publishes a host port, and it binds IPv4 loopback. The evaluator has no host port and joins only the internal `evaluation` network. Its model directory is mounted read-only. Both services have read-only root filesystems, all Linux capabilities dropped, `no-new-privileges`, PID/CPU/memory limits, bounded writable `tmpfs`, bounded application concurrency and rotated local logs. General-purpose temporary storage remains `noexec`; the evaluator has a separate 64 MiB `exec,nodev,nosuid` tmpfs configured through `JAVA_TOOL_OPTIONS` as the JVM default temporary directory. Any Java code using the default temporary-file location can write there; executable access is required for ONNX Runtime JNI extraction.

The playground `/health` endpoint proves only process liveness. Compose waits for the evaluator `/ready` endpoint, which proves that the configured model loaded, before starting the playground. A healthy playground must never be interpreted as evaluator readiness.

## Prerequisites

Before a change window, the operator must confirm:

- an approved Aurora deployment action under Issue #12;
- Docker Engine with Compose v2, Git, `mise`, and access to both private GHCR packages;
- enough reserved host capacity for the configured maximum of 2.5 CPUs, 2.25 GiB container memory, model page cache, Docker overhead, and existing Aurora workloads;
- an exact playground image digest and evaluator image digest produced by successful repository CI;
- an external model directory containing exactly the selected `model.onnx` and `manifest.json` files;
- the SHA-256 of `manifest.json`, recorded with the deployment evidence;
- a strong evaluator token, the Cloudflare Access team domain, and the Access application audience supplied through an operator-owned environment file;
- the intended loopback port is unused and the existing `cloudflared` process can reach it.

Do not put model files, populated environment files, private origins, tokens, or deployment evidence containing secrets in this public repository.

## Prepare the candidate

1. Check out the reviewed commit on Aurora. Do not build production images from this checkout.
2. Create the local environment file and restrict it:

   ```bash
   cp deploy/aurora/.env.example deploy/aurora/.env
   chmod 600 deploy/aurora/.env
   ```

3. Populate every name in `deploy/aurora/.env` locally:

   - `PLAYGROUND_IMAGE` and `EVALUATOR_IMAGE`: full `ghcr.io/...@sha256:<64 lowercase hex>` references;
   - `PLAYGROUND_LOOPBACK_PORT`: normally `3100`, after proving it is unused;
   - `MODEL_PACKAGE_DIR`: absolute directory containing `model.onnx` and `manifest.json`;
   - `MODEL_MANIFEST_SHA256`: lowercase SHA-256 of the exact manifest file;
   - `EVALUATION_INTERNAL_TOKEN`: one strong random token shared only by the BFF and evaluator;
   - `CF_ACCESS_TEAM_DOMAIN`: the HTTPS team domain used to validate Access JWTs;
   - `CF_ACCESS_AUD`: the exact audience of the playground Access application.

4. Authenticate Docker to GHCR with a least-privilege token that can read both packages. Keep the token out of shell history and repository files.
5. Run the non-applying checks:

   ```bash
   mise run aurora:preflight
   docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml config --quiet
   ```

The preflight fails on mutable image tags, non-loopback publication, evaluator exposure, missing resource/security bounds, a writable or missing model mount, unsafe environment-file permissions, or model/manifest digest mismatch.

## Deploy during an approved window

Record the current rendered configuration and running image digests before changing anything. Never record secret environment values.

```bash
docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml pull
docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml up -d --remove-orphans
docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml ps
```

`pull` is intentionally separate from preflight. There is no workflow in this repository that changes Aurora.

## Read back and verify

1. Confirm the running containers use the approved digests, UID/GID `10001`, read-only roots, dropped capabilities, resource limits, and expected networks with `docker inspect`.
2. Confirm `docker compose ps` reports the evaluator healthy before the playground is considered usable.
3. From Aurora, verify the loopback origin:

   ```bash
   curl --fail --silent --show-error http://127.0.0.1:3100/health
   ```

4. Prove the port is loopback-only with the host socket inspection tool (`ss -ltnp` on Linux). There must be no `0.0.0.0`, LAN-address, or IPv6 wildcard bind for the playground port.
5. Prove the evaluator has no published port in `docker compose ps` and cannot be reached through Aurora's host/LAN addresses or any Tunnel hostname.
6. Run the evaluator black-box contract suite from inside the private network or via an operator-only one-shot container. Do not publish a temporary evaluator host port.
7. Observe container CPU, memory, PIDs, restart count, health state, and logs during several explicit evaluations. Stop if host contention or repeated restarts appear.
8. Only after the Aurora checks pass, perform the separately approved Cloudflare Tunnel and Access work in Issue #13. Verify anonymous denial, invalid JWT denial, and one allowlisted tester's successful evaluation.

## Logs and diagnosis

```bash
docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml logs --since 15m playground
docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml logs --since 15m evaluator
docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml stats --no-stream
```

Logs rotate locally. Treat correlation IDs as diagnostic metadata, but sanitize logs and rendered configuration before attaching evidence. Never paste tokens, JWTs, private origins, model paths, or full environment dumps.

## Model replacement

Model replacement is an immutable candidate change, not an in-place file overwrite:

1. Place the new `model.onnx` and `manifest.json` together in a new versioned directory.
2. Verify the model hash in the manifest and calculate the manifest SHA-256.
3. Update only `MODEL_PACKAGE_DIR` and `MODEL_MANIFEST_SHA256` in the local environment file.
4. Run `mise run aurora:preflight` before restarting anything.
5. Recreate the evaluator, wait for `/ready`, then recreate the playground if necessary.
6. Verify returned provenance identifies the intended model digest. Retain the previous model directory until rollback evidence is complete.

## Secret rotation

1. Generate a new strong random evaluator token in the approved secret-handling tool.
2. Update `EVALUATION_INTERNAL_TOKEN` in the local environment file without printing it.
3. Run preflight, then recreate evaluator and playground together so their shared token cannot drift.
4. Perform one allowed evaluation and verify authentication failures are generic and contain no upstream details.
5. Destroy the retired token according to the local secret-management policy.

Rotating Cloudflare Access configuration is separate Issue #13 work. Keep its issuer/audience synchronized with the BFF configuration and re-run both negative and allowed-user checks.

## Rollback

Before deployment, retain the last known-good environment file securely, the two prior image digests, the prior model directory, and sanitized readback evidence.

To roll back:

1. Restore the previous immutable image references, model directory, manifest digest, and matching secrets in the local environment file.
2. Run `mise run aurora:preflight`.
3. Pull the prior digests and run `docker compose --env-file deploy/aurora/.env -f deploy/aurora/compose.yaml up -d --remove-orphans`.
4. Wait for evaluator readiness, verify the loopback origin, run an explicit evaluation, and read back the running image/model provenance.
5. If rollback cannot restore a healthy private stack, stop both containers and remove or disable the Tunnel route under the separately authorized Cloudflare procedure. Do not expose the evaluator as a workaround.

## Recovery

- **Evaluator never becomes ready:** inspect evaluator logs, verify model and manifest hashes, engine compatibility, file readability by UID `10001`, memory availability, and the internal token. Leave the playground unavailable until readiness succeeds.
- **Playground is healthy but evaluation fails:** verify private-network DNS for `evaluator`, token equality, BFF timeout, evaluator admission metrics/logs, and model readiness. `/health` alone is not success evidence.
- **Loopback port is occupied:** stop and identify the owner. Select another approved loopback port in the local environment and synchronize the Tunnel origin later; never bind a wildcard address.
- **Host pressure:** stop the candidate with `docker compose ... down`, preserve logs, and revise the approved resource plan. Do not weaken limits during an incident.
- **Configuration drift:** restore from reviewed repository files and the last known-good local environment. Run preflight and read back the rendered/running state again.
