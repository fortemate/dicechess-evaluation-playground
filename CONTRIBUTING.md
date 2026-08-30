# Contributing

Thank you for helping improve Dice Chess Evaluation Playground.

## Before starting

- Search existing Issues before proposing new work.
- Use an Issue for changes that affect behavior, architecture, security boundaries, dependencies, or licensing.
- Keep the browser-to-BFF-to-evaluator boundary described in `README.md` and `AGENTS.md` intact.
- Do not submit evaluator code, model artifacts, training assets, credentials, private endpoints, or material copied from private Fortemate repositories.

## Development workflow

1. Create a conventionally named branch linked to the applicable Issue.
2. Install the pinned toolchain with `mise install` and dependencies with `mise run setup`.
3. Make a focused change with tests.
4. Run `mise run check`; also run `mise run test:e2e` for UI or route changes and the container gates for image changes.
5. Open a pull request that closes its independently actionable Issue and explains verification performed.

## Licensing contributions

Fortemate-authored project code is licensed under `AGPL-3.0-only`. By submitting a contribution, you confirm that you have the right to provide it under that project license. Preserve SPDX identifiers, copyright notices, and all third-party notices. Do not copy code whose license or provenance is unclear.

Adding or upgrading a dependency requires checking its exact resolved version, authoritative license, source provenance, and redistribution obligations. Third-party code must retain its own license identity and notice; it must not be described as Fortemate-authored AGPL code.

## Security reports

Do not open a public Issue for a vulnerability or a suspected secret. Follow `SECURITY.md` instead.
