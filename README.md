# Dice Chess Evaluation Playground

AGPL-licensed SvelteKit playground for interactively testing Dice Chess evaluation models. The deployed service is intended to remain protected even when the source repository is public. The MVP is tracked by [Epic #1](https://github.com/fortemate/dicechess-evaluation-playground/issues/1).

The repository provides the single-model MVP: an explicit Dice Chess position editor, a same-origin evaluator BFF, typed results and errors, immutable model provenance, and automated API, BFF, browser, and container checks.

## Security boundary

The browser application calls a server-side BFF on the same origin. Only the BFF may hold the evaluator credential or know its private origin. The evaluator must never be exposed directly to a browser, Cloudflare Tunnel hostname, public port, or LAN-accessible host port.

This repository contains the playground UI and BFF only. It does not contain the proprietary evaluator implementation, model weights or manifests, training assets, credentials, private service origins, or environment-specific Aurora and Cloudflare values. The generic build, installation, runtime configuration schema, and evaluator HTTP contract needed to operate the playground remain part of this source boundary. Publishing this source does not make a deployed playground anonymous or public.

## Board decision

The accepted [board-editor decision](docs/decisions/0001-board-editor.md) selects `@lichess-org/chessground@10.1.1` under its upstream `GPL-3.0-or-later` license. The editor is implemented independently; no proprietary `dicechess-analytics-ui` editor or FEN-building code is copied.

## Prerequisites

- [mise](https://mise.jdx.dev/)
- Docker with BuildKit for container checks

Node.js 26, Lefthook, Betterleaks, and actionlint are pinned through `mise.toml`. The current dependency graph uses the public npm registry only. Public-fork CI must not receive private-package credentials; adding a private `@fortemate/*` package requires a separate architecture and license review.

## Local development

```sh
mise install
mise run setup
mise run dev
```

`mise run setup` performs a reproducible `npm ci` and installs the repository Git hooks.

## Quality gates

```sh
mise run check                      # lint, format, types, workflow syntax, coverage, contract tests, build
mise run test:contracts:evaluator   # evaluator black-box contract gate
mise run test:e2e:install           # one-time local Chromium install
mise run test:e2e                   # fixture-backed adapter-node acceptance flow
mise run hook:run                   # full secret scan plus pre-commit jobs on tracked files
```

## Evaluator contract testing

The evaluator contract suite validates public liveness/readiness (`/health`, `/ready`), authentication rejection (missing and wrong bearer tokens on protected endpoints), `/version`, `/manifest`, invalid FEN handling, and position evaluation (`/api/v1/evaluate/position`) via Hurl.

```sh
mise run test:contracts:evaluator
```

By default, the task runs against a deterministic local fixture server. To test an external candidate (such as on Aurora), pass all four required configuration values via environment variables:

```sh
EVALUATOR_ORIGIN="https://evaluator.internal:8080" \
EVALUATOR_BEARER_TOKEN="your-token" \
EXPECTED_MODEL_ID="your-model-id" \
EXPECTED_MODEL_SHA256="your-64-hex-sha256" \
mise run test:contracts:evaluator
```

External mode fails before making a request if any required value is missing or if the expected digest is not exactly 64 hexadecimal characters. The origin and bearer token are passed to Hurl as secrets so that failure diagnostics redact them.

The pre-commit hook scans staged changes for secrets, formats supported staged files, and validates changed GitHub Actions workflows. The pre-push hook runs `mise run check`.

## Container

Build and test the production image:

```sh
mise run container:build
mise run container:smoke
```

The image build uses only public package sources and accepts no npm credential. The runtime image uses `node:26-trixie-slim`, runs as UID/GID `10001`, includes the applicable license notices, and exposes a dependency-free `GET /health` liveness endpoint on port `3000`.

## CI and image publishing

CI runs the canonical gate, the adapter-node Playwright flow, an amd64 container smoke, and a critical-vulnerability scan. Untrusted pull-request jobs have read-only source access and receive neither repository secrets nor private-package credentials.

After successful `main` CI, CD publishes an annotated amd64/arm64 image index with development and full-commit tags, but no `latest` or release tag, to:

```text
ghcr.io/fortemate/dicechess-evaluation-playground
```

Publishing first creates an explicitly untrusted `candidate-<sha>` tag. It validates the OCI index and its BuildKit provenance, scans both platform manifests with Trivy, and only then promotes the exact digest to development and full-commit tags. A failed gate may leave the candidate artifact, but it cannot create the promoted tags; only a digest from a successful run is eligible for deployment. Release tags remain a separate future workflow. CD does **not** deploy or restart anything on Aurora. Deployment will use a separately reviewed, human-approved, immutable image digest.

Repository visibility and GHCR package visibility are independent. Neither this source change nor image publication changes either visibility setting automatically.

## License and source

Copyright © 2026 Jegors Čemisovs.

Fortemate-authored code in this repository is licensed under the [GNU Affero General Public License version 3 only](LICENSE), identified as `AGPL-3.0-only`. CI/CD images embed a full Git commit and the running UI links to that exact source revision. A local build without a verified commit falls back to the repository overview and is not deployment evidence. Third-party components retain their own licenses and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Every network user must be able to retrieve that corresponding source without charge. Until the repository is public, do not grant playground access to a tester who cannot follow the source link, unless the exact source is made available through another equivalent channel.

The `"private": true` package setting only prevents accidental publication to the npm registry; it does not limit the license grant or repository visibility.

This license applies only to material distributed from this repository. It does not grant access to or license the separately maintained evaluator implementation, model weights, model manifests, training data, credentials, private origins, or deployment secrets. The software is provided without warranty as described in the license.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md); do not publish sensitive reports in an Issue.
