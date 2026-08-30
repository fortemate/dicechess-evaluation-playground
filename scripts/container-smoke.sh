#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Jegors Čemisovs
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

playground_image="${IMAGE:-dicechess-evaluation-playground:local}"
playground_container="evaluation-playground-smoke-${RANDOM}"
playground_internal_port="${CONTAINER_PORT:-3100}"

playground_license_label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.licenses" }}' "${playground_image}")"
if [ "${playground_license_label}" != "AGPL-3.0-only" ]; then
  echo "Expected OCI license AGPL-3.0-only, got ${playground_license_label:-missing}" >&2
  exit 1
fi

if [[ ! "${playground_internal_port}" =~ ^[0-9]+$ ]]; then
  echo "CONTAINER_PORT must be numeric: ${playground_internal_port}" >&2
  exit 1
fi

cleanup_playground_container() {
  docker rm --force "${playground_container}" >/dev/null 2>&1 || true
}

trap cleanup_playground_container EXIT

docker run \
  --detach \
  --name "${playground_container}" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --env "PORT=${playground_internal_port}" \
  --health-interval 1s \
  --health-timeout 3s \
  --health-start-period 0s \
  --publish "127.0.0.1::${playground_internal_port}" \
  "${playground_image}" >/dev/null

playground_port_mapping="$(docker port "${playground_container}" "${playground_internal_port}/tcp")"
playground_port="${playground_port_mapping##*:}"
playground_health_url="http://127.0.0.1:${playground_port}/health"

for _ in $(seq 1 30); do
  playground_health_status="$(docker inspect --format '{{.State.Health.Status}}' "${playground_container}")"
  if [ "${playground_health_status}" = "healthy" ] \
    && playground_health_body="$(curl --fail --silent --show-error --connect-timeout 1 --max-time 3 "${playground_health_url}" 2>/dev/null)"; then
    break
  fi
  sleep 1
done

if [ "${playground_health_status:-}" != "healthy" ] || [ -z "${playground_health_body:-}" ]; then
  docker logs "${playground_container}"
  echo "Container did not become healthy: ${playground_health_url} (${playground_health_status:-unknown})" >&2
  exit 1
fi

node -e '
  const response = JSON.parse(process.argv[1]);
  if (response.status !== "ok" || response.service !== "dicechess-evaluation-playground") {
    process.exit(1);
  }
' "${playground_health_body}"

playground_runtime_uid="$(docker exec "${playground_container}" id -u)"
if [ "${playground_runtime_uid}" != "10001" ]; then
  echo "Expected runtime UID 10001, got ${playground_runtime_uid}" >&2
  exit 1
fi

for playground_notice_path in \
  /app/licenses/LICENSE \
  /app/licenses/THIRD_PARTY_NOTICES.md \
  /app/licenses/third-party/svelte-LICENSE.md \
  /app/licenses/third-party/sveltekit-LICENSE \
  /app/licenses/third-party/adapter-node-LICENSE \
  /app/licenses/third-party/vite-LICENSE.md \
  /app/licenses/third-party/tailwindcss-LICENSE \
  /app/licenses/third-party/cookie-LICENSE \
  /app/licenses/third-party/clsx-LICENSE \
  /app/licenses/third-party/devalue-LICENSE \
  /app/licenses/third-party/set-cookie-parser-LICENSE; do
  if ! docker exec "${playground_container}" test -r "${playground_notice_path}"; then
    echo "Missing readable license notice: ${playground_notice_path}" >&2
    exit 1
  fi
done

echo "Container smoke passed: ${playground_image} (${playground_health_url}, uid=${playground_runtime_uid}, license=${playground_license_label})"
