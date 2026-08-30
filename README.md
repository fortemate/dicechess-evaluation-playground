# Dice Chess Evaluation Playground

Private SvelteKit playground for interactively testing Dice Chess evaluation models. The MVP is tracked by [Epic #1](https://github.com/fortemate/dicechess-evaluation-playground/issues/1).

The repository currently provides the engineering baseline from [Issue #2](https://github.com/fortemate/dicechess-evaluation-playground/issues/2). The position editor and evaluator BFF are intentionally not implemented yet.

## Security boundary

The eventual browser application will call a server-side BFF on the same origin. Only the BFF may hold the evaluator credential or know its private origin. The evaluator must never be exposed directly to a browser, Cloudflare Tunnel hostname, public port, or LAN-accessible host port.

This baseline does not contain evaluator, Aurora, Cloudflare, model, or production-hostname configuration.

## Prerequisites

- [mise](https://mise.jdx.dev/)
- Docker with BuildKit for container checks
- GitHub Packages read access once private `@fortemate/*` dependencies are introduced

Node.js 26, Lefthook, Betterleaks, and actionlint are pinned through `mise.toml`.

## Local development

```sh
mise install
mise run setup
mise run dev
```

`mise run setup` performs a reproducible `npm ci` and installs the repository Git hooks.

## Quality gates

```sh
mise run check             # lint, format, types, workflow syntax, coverage, build
mise run test:e2e:install  # one-time local Chromium install
mise run test:e2e          # built adapter-node browser smoke
mise run hook:run          # full secret scan plus pre-commit jobs on tracked files
```

The pre-commit hook scans staged changes for secrets, formats supported staged files, and validates changed GitHub Actions workflows. The pre-push hook runs `mise run check`.

## Container

Build and test the production image:

```sh
mise run container:build
mise run container:smoke
```

When private npm packages are added, pass the package token only as a BuildKit secret:

```sh
docker build \
  --secret id=node_auth_token,env=NODE_AUTH_TOKEN \
  -t dicechess-evaluation-playground:local .
```

The runtime image uses `node:26-trixie-slim`, runs as UID/GID `10001`, and exposes a dependency-free `GET /health` liveness endpoint on port `3000`.

## CI and image publishing

CI runs the canonical gate, the adapter-node Playwright flow, an amd64 container smoke, and a critical-vulnerability scan.

After successful `main` CI, CD publishes an annotated amd64/arm64 image index with development and full-commit tags, but no `latest` or release tag, to:

```text
ghcr.io/fortemate/dicechess-evaluation-playground
```

Publishing first creates an explicitly untrusted `candidate-<sha>` tag. It validates the OCI index and its BuildKit provenance, scans both platform manifests with Trivy, and only then promotes the exact digest to development and full-commit tags. A failed gate may leave the private candidate artifact, but it cannot create the promoted tags; only a digest from a successful run is eligible for deployment. Release tags remain a separate future workflow. CD does **not** deploy or restart anything on Aurora. Deployment will use a separately reviewed, human-approved, immutable image digest.

## License status

The package is currently `UNLICENSED` and the repository is private. OCI metadata uses `LicenseRef-Proprietary` only to express that no license grant is made and all rights are reserved. A compatible license and board implementation must be selected before importing GPL-licensed Chessground code or copying an existing editor implementation.
