#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Jegors Čemisovs
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
compose_file="$repository_root/deploy/aurora/compose.yaml"
example_env="$repository_root/deploy/aurora/.env.example"
mode=preflight
env_file="$repository_root/deploy/aurora/.env"

usage() {
  printf 'Usage: %s [--policy-only | --env-file PATH]\n' "${0##*/}" >&2
}

while (($# > 0)); do
  case "$1" in
    --policy-only)
      mode=policy
      shift
      ;;
    --env-file)
      if (($# < 2)); then
        usage
        exit 2
      fi
      env_file=$2
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

for command in docker node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Aurora validation failed: required command not found: %s\n' "$command" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  printf 'Aurora validation failed: Docker Compose v2 is required\n' >&2
  exit 1
fi

if grep -Ev '^[[:space:]]*(#.*|$|[A-Z][A-Z0-9_]*=)$' "$example_env" >/dev/null; then
  printf 'Aurora validation failed: .env.example may contain names, but no populated values\n' >&2
  exit 1
fi

rendered_config=$(mktemp "${TMPDIR:-/tmp}/aurora-compose.XXXXXX.json")
cleanup() {
  rm -f "$rendered_config"
}
trap cleanup EXIT

if [[ "$mode" == policy ]]; then
  digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  export PLAYGROUND_IMAGE="ghcr.io/fortemate/dicechess-evaluation-playground@$digest"
  export EVALUATOR_IMAGE="ghcr.io/fortemate/dicechess-evaluation@$digest"
  export PLAYGROUND_LOOPBACK_PORT=3100
  export MODEL_PACKAGE_DIR=/var/lib/dicechess/evaluation/current
  export MODEL_MANIFEST_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  export EVALUATION_INTERNAL_TOKEN=policy-validation-token-32-chars
  export CF_ACCESS_TEAM_DOMAIN=https://example.cloudflareaccess.com
  export CF_ACCESS_AUD=policy-validation-audience
  docker compose -f "$compose_file" config --format json >"$rendered_config"
else
  if [[ ! -f "$env_file" ]]; then
    printf 'Aurora validation failed: environment file not found: %s\n' "$env_file" >&2
    exit 1
  fi

  if [[ "$(uname -s)" == Darwin ]]; then
    env_mode=$(stat -f '%Lp' "$env_file")
  else
    env_mode=$(stat -c '%a' "$env_file")
  fi
  if ((8#$env_mode & 8#077)); then
    printf 'Aurora validation failed: %s must not be readable or writable by group/others (use chmod 600)\n' "$env_file" >&2
    exit 1
  fi

  docker compose --env-file "$env_file" -f "$compose_file" config --format json >"$rendered_config"
fi

AURORA_VALIDATION_MODE=$mode node - "$rendered_config" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const mode = process.env.AURORA_VALIDATION_MODE;
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const fail = (message) => {
  throw new Error(`Aurora validation failed: ${message}`);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};
const digestPattern = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const services = config.services ?? {};
const playground = services.playground;
const evaluator = services.evaluator;
const resourceCeilings = {
  playground: { cpus: 1, memory: 512 * 1024 * 1024, pids: 256 },
  evaluator: { cpus: 4, memory: 4 * 1024 * 1024 * 1024, pids: 512 },
};

assert(playground && evaluator, 'compose must define playground and evaluator services');
assert(Object.keys(services).length === 2, 'compose must not introduce additional services');

for (const [name, service] of Object.entries({ playground, evaluator })) {
  assert(digestPattern.test(service.image ?? ''), `${name} image must use an immutable sha256 digest`);
  const imageName = service.image.slice(0, service.image.indexOf('@'));
  assert(
    !imageName.slice(imageName.lastIndexOf('/') + 1).includes(':'),
    `${name} image must not combine a mutable tag with its digest`,
  );
  assert(service.user === '10001:10001', `${name} must run as UID/GID 10001`);
  assert(service.read_only === true, `${name} root filesystem must be read-only`);
  assert(service.init === true, `${name} must use an init process`);
  assert(service.cap_drop?.includes('ALL'), `${name} must drop every Linux capability`);
  assert(
    service.security_opt?.includes('no-new-privileges:true'),
    `${name} must enable no-new-privileges`,
  );
  assert(Number(service.pids_limit) > 0, `${name} must set a positive PID limit`);
  assert(Number(service.cpus) > 0, `${name} must set a positive CPU limit`);
  assert(Number(service.mem_limit) > 0, `${name} must set a positive memory limit`);
  assert(Number(service.pids_limit) <= resourceCeilings[name].pids, `${name} PID limit exceeds policy ceiling`);
  assert(Number(service.cpus) <= resourceCeilings[name].cpus, `${name} CPU limit exceeds policy ceiling`);
  assert(Number(service.mem_limit) <= resourceCeilings[name].memory, `${name} memory limit exceeds policy ceiling`);
  assert(service.restart === 'unless-stopped', `${name} must use the reversible restart policy`);
  assert(Array.isArray(service.tmpfs) && service.tmpfs.length > 0, `${name} must bound writable tmpfs`);
  assert(
    service.tmpfs.every(
      (mount) => String(mount).includes('size=') && String(mount).includes('noexec') && String(mount).includes('nosuid'),
    ),
    `${name} tmpfs must set a size and disable exec/suid`,
  );
}

const allPublishedPorts = Object.entries(services).flatMap(([name, service]) =>
  (service.ports ?? []).map((port) => ({ serviceName: name, ...port })),
);
assert(allPublishedPorts.length === 1, 'only one host port may be published');
const published = allPublishedPorts[0];
assert(published.serviceName === 'playground', 'only playground may publish a host port');
assert(published.host_ip === '127.0.0.1', 'playground host port must bind IPv4 loopback');
assert(Number(published.target) === 3000, 'playground host port must target container port 3000');
assert(
  Number.isInteger(Number(published.published)) &&
    Number(published.published) >= 1024 &&
    Number(published.published) <= 65535,
  'playground loopback port must be between 1024 and 65535',
);
assert(!(evaluator.ports?.length), 'evaluator must not publish a host port');
assert(!(evaluator.expose?.length), 'evaluator must not declare an exposed port');

assert(config.networks?.evaluation?.internal === true, 'evaluation network must be internal');
assert(
  Object.keys(evaluator.networks ?? {}).length === 1 &&
    Object.hasOwn(evaluator.networks ?? {}, 'evaluation'),
  'evaluator must attach only to the private evaluation network',
);
assert(
  Object.hasOwn(playground.networks ?? {}, 'edge') &&
    Object.hasOwn(playground.networks ?? {}, 'evaluation'),
  'playground must bridge edge and evaluation networks',
);

const modelMount = (evaluator.volumes ?? []).find((mount) => mount.target === '/model');
assert(modelMount?.type === 'bind', 'model package must use a bind mount');
assert(modelMount?.read_only === true, 'model package must be mounted read-only');
assert(modelMount?.bind?.create_host_path === false, 'model mount must not create a missing host directory');

assert(
  playground.depends_on?.evaluator?.condition === 'service_healthy',
  'playground must wait for evaluator readiness',
);
assert(
  JSON.stringify(evaluator.healthcheck?.test ?? []).includes('/ready'),
  'evaluator healthcheck must use readiness, not liveness',
);
assert(
  JSON.stringify(playground.healthcheck?.test ?? []).includes('/health'),
  'playground healthcheck must use its cheap liveness endpoint',
);

const playgroundEnv = playground.environment ?? {};
const evaluatorEnv = evaluator.environment ?? {};
assert(playgroundEnv.EVALUATOR_ORIGIN === 'http://evaluator:8000', 'BFF must use the private evaluator origin');
assert(playgroundEnv.ALLOW_DEV_AUTH_BYPASS === 'false', 'production auth bypass must remain disabled');
assert(evaluatorEnv.ALLOW_UNAUTHENTICATED_DEV === 'false', 'evaluator auth bypass must remain disabled');
assert(
  /^https:\/\/[^/]+$/.test(playgroundEnv.CF_ACCESS_TEAM_DOMAIN ?? ''),
  'Cloudflare Access team domain must be an HTTPS origin without a path',
);
assert((playgroundEnv.CF_ACCESS_AUD ?? '').trim().length > 0, 'Cloudflare Access audience must not be empty');
assert(
  playgroundEnv.EVALUATOR_BEARER_TOKEN === evaluatorEnv.EVALUATION_INTERNAL_TOKEN &&
    evaluatorEnv.EVALUATION_INTERNAL_TOKEN.length >= 16,
  'BFF and evaluator must receive the same non-empty strong token',
);
for (const [name, value] of Object.entries({
  MAX_REQUEST_BODY_BYTES: playgroundEnv.MAX_REQUEST_BODY_BYTES,
  EVALUATOR_TIMEOUT_MS: playgroundEnv.EVALUATOR_TIMEOUT_MS,
  MAX_CONCURRENT_EVALUATIONS: playgroundEnv.MAX_CONCURRENT_EVALUATIONS,
  MAX_HTTP_BODY_BYTES: evaluatorEnv.MAX_HTTP_BODY_BYTES,
  MAX_CONCURRENT_ANALYSES: evaluatorEnv.MAX_CONCURRENT_ANALYSES,
  DEFAULT_TIMEOUT_MS: evaluatorEnv.DEFAULT_TIMEOUT_MS,
  FEATURE_EXTRACTION_PARALLELISM: evaluatorEnv.FEATURE_EXTRACTION_PARALLELISM,
})) {
  assert(Number.isInteger(Number(value)) && Number(value) > 0, `${name} must be a positive integer`);
}
assert(Number(playgroundEnv.MAX_REQUEST_BODY_BYTES) <= 65536, 'playground request body limit exceeds policy ceiling');
assert(Number(playgroundEnv.MAX_CONCURRENT_EVALUATIONS) <= 2, 'playground concurrency exceeds policy ceiling');
assert(Number(evaluatorEnv.MAX_HTTP_BODY_BYTES) <= 65536, 'evaluator request body limit exceeds policy ceiling');
assert(Number(evaluatorEnv.MAX_CONCURRENT_ANALYSES) <= 2, 'evaluator concurrency exceeds policy ceiling');
assert(Number(evaluatorEnv.FEATURE_EXTRACTION_PARALLELISM) <= 2, 'feature extraction parallelism exceeds policy ceiling');
assert(
  Number(playgroundEnv.EVALUATOR_TIMEOUT_MS) >= Number(evaluatorEnv.DEFAULT_TIMEOUT_MS) &&
    Number(playgroundEnv.EVALUATOR_TIMEOUT_MS) <= Number(evaluatorEnv.MAX_TIMEOUT_MS),
  'BFF timeout must contain the evaluator default without exceeding the evaluator maximum',
);

const manifestDigest = evaluator.labels?.['com.fortemate.model.manifest.sha256'];
assert(sha256Pattern.test(manifestDigest ?? ''), 'manifest must be pinned by a lowercase SHA-256');

if (mode === 'preflight') {
  const modelDirectory = modelMount.source;
  const modelPath = path.join(modelDirectory, 'model.onnx');
  const manifestPath = path.join(modelDirectory, 'manifest.json');
  assert(path.isAbsolute(modelDirectory), 'model package directory must be an absolute host path');
  assert(
    fs.existsSync(modelDirectory) && fs.statSync(modelDirectory).isDirectory(),
    `model package is not a directory: ${modelDirectory}`,
  );
  assert(fs.existsSync(modelPath) && fs.statSync(modelPath).isFile(), `model file is missing: ${modelPath}`);
  assert(
    fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile(),
    `manifest file is missing: ${manifestPath}`,
  );

  const actualManifestDigest = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
  assert(actualManifestDigest === manifestDigest, 'manifest SHA-256 does not match MODEL_MANIFEST_SHA256');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(sha256Pattern.test(manifest.modelSha256 ?? ''), 'manifest modelSha256 must be lowercase SHA-256');
  const actualModelDigest = crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex');
  assert(actualModelDigest === manifest.modelSha256, 'model.onnx SHA-256 does not match manifest modelSha256');
}

console.log(
  mode === 'policy'
    ? 'Aurora Compose policy validation passed.'
    : 'Aurora preflight passed: Compose policy and model package digests are valid.',
);
NODE
