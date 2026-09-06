# AGENTS.md — Contributor and Agent Guidelines

Operational guidance for humans and coding agents working on `fortemate/dicechess-evaluation-playground`.

## Toolchain and commands

- Node.js 26 and repository tools are managed by `mise`.
- The application uses SvelteKit, Svelte 5 runes, TypeScript, Tailwind CSS 4, and `@sveltejs/adapter-node`.
- Install dependencies and hooks with `mise run setup`.
- Run `mise run check` before concluding any code change.
- Run `mise run test:e2e` for changes that affect routes, rendering, server behavior, or the production build.
- Run `mise run container:build` and `mise run container:smoke` for Dockerfile or runtime changes.

## Architecture and security boundaries

- Browser code must never receive the evaluator origin or evaluator credentials.
- Evaluation requests will go through same-origin SvelteKit server routes. Keep secrets in server-only modules and runtime environment variables.
- The evaluator remains on a private container network. Do not add a public hostname, public port, LAN-accessible host port, or direct browser integration.
- `GET /health` is process liveness only and must remain cheap and independent of the evaluator.
- Image publication ends at GHCR. Aurora deployment, Cloudflare configuration, secrets, and model artifacts are separately authorized human-controlled operations.
- Never commit `.env` files, tokens, model weights, production hostnames, or private service URLs.

## Code and dependency conventions

- Use Svelte 5 runes for new stateful components and `$lib` aliases for application imports.
- Keep `mise run check` as the canonical non-browser gate; do not bypass or weaken it for generated changes.
- Preserve non-root container execution. Builds use the public npm dependency graph and must not receive private-package credentials.
- Fortemate-authored code in this repository is `AGPL-3.0-only`. Preserve SPDX identifiers and the root license and source offer.
- Third-party code retains its own license identity and notices. Chessground is approved only under the exact version and boundary in `docs/decisions/0001-board-editor.md`; do not describe it as relicensed by Fortemate.
- Do not copy the proprietary analytics editor or its FEN builder. Implement the editor independently with explicit side-to-move, castling, and en-passant state.
- Keep evaluator and training implementations, model artifacts, secrets, private origins, and exact host deployment overlays outside this public-source repository.

## Issue management

<!-- dc-shared:issue-management v7 — keep identical across Fortemate repositories -->

- Classify work with the native GitHub Issue Type: `Bug` (unexpected or incorrect behavior), `Feature` (request, idea, new user-visible capability), `Task` (a specific piece of engineering, research, maintenance or documentation work). Labels on Issues name a technical domain or cross-cutting concern only, never repeat the Type, and must already exist in the repository.
- Never commit to a repository's default branch. Name branches you control `<type>/<short-description>` or `<type>/<issue-id>-<short-description>` with a type from `task|feat|bug|refactor|chore|docs|ci|test|perf`. A branch that carries an Issue id must be closed by its pull request (`Closes #<id>`, or `Closes owner/repository#<id>` across repositories); partial work uses a non-closing reference. Before dispatching an external tool, read the repository's live PR-policy workflow: a tool-managed branch name is acceptable only when that policy allows it and the pull request closes the delegated leaf Issue — never edit a workflow to make a generated branch pass. A delegated pull request and its commits close only their leaf Issue, never a parent or sibling.
- GitHub-facing text is English-only. Every Issue has `Context`, `Objective` and a testable `Definition of Done`; create it with `gh issue create --body-file <file>`, never with an inline multi-line body, and search open and closed Issues across Fortemate repositories for duplicates first. Every actionable Issue (never a pull request) belongs to the organization Project [Fortemate Engineering](https://github.com/orgs/fortemate/projects/1); triage (Type, `Execution tier`, `Status`, `Priority`, labels, relationships, assignee) and the mandatory read-back after every mutation follow the `github-issue-workflow` skill in `fortemate-internal/skills/`.
- `jules` is a live execution trigger, not a label. Jules, Antigravity, CI, delegated subagents and any agent without the current user's explicit task-scoped authorization never apply, reapply or remove it. Dispatch qualification, monitoring, feedback (only a submitted comment starting with `@jules`; every other comment by the triggering user wakes the session too), takeover, the audit-marker rule for closed Issues and the "no bare `#N` in a spec" rule are the `jules-delegation` skill; a repository must pass the `jules-repo-readiness` skill before its first dispatch.
- The human owner reviews, approves and merges pull requests. Agents never merge pull requests or execute releases.

<!-- /dc-shared:issue-management -->
