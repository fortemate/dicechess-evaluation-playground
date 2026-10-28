# ADR 0001: Board editor dependency, licensing, and reuse boundary

- Status: Accepted
- Date: 2026-08-30
- Decision owner: repository maintainer
- Tracking: [Issue #4](https://github.com/fortemate/dicechess-evaluation-playground/issues/4)

## Context

The playground needs an interactive Dice Chess position editor. An existing editor in the private `dicechess-analytics-ui` repository uses Chessground, but its component and FEN-building implementation are proprietary. Its FEN builder also infers castling rights and clears en-passant state, while the playground contract requires side to move, castling rights, and en-passant state to remain explicit.

The board decision must therefore address both software licensing and the position-state boundary before implementation starts. This record captures the maintainer's engineering decision; it is not legal advice.

## Alternatives considered

### Copy the analytics editor

Rejected. Copying its `PositionEditor` or `buildFen` implementation would cross the private-source boundary and would preserve semantics that conflict with the playground's explicit position state.

### Build a board renderer and interaction layer from scratch

Rejected for the MVP. It would avoid a board dependency, but would add substantial input, accessibility, touch, animation, and rendering work unrelated to evaluating the model.

### Use Chessground through a new playground-owned adapter

Accepted. The editor will use Chessground only through its published API and assets. Fortemate-specific position state, controls, validation, and serialization will be written anew in this repository.

## Decision

1. Fortemate-authored material in this repository is licensed under `AGPL-3.0-only` using the standard GNU Affero General Public License version 3 text in the root `LICENSE`.
2. The approved board dependency is exactly `@lichess-org/chessground@10.5.0`. The reviewed upstream tag `v10.5.0` resolves to commit [`b4f605018e1043640c917e82a74b214cb58e4a05`](https://github.com/lichess-org/chessground/tree/b4f605018e1043640c917e82a74b214cb58e4a05).
3. Chessground remains the work of the Lichess Team under its upstream `GPL-3.0-or-later` license. Its immutable [package metadata](https://github.com/lichess-org/chessground/blob/v10.5.0/package.json) and [license text](https://github.com/lichess-org/chessground/blob/v10.5.0/LICENSE) are authoritative for the reviewed version. Section 13 of AGPLv3 explicitly permits combining an AGPLv3-covered work with GPLv3-covered work while each part retains its license identity. Fortemate does not relicense or relabel Chessground as AGPL-authored code.
4. Keep the dependency pinned to the reviewed exact version. Any version change requires license and provenance revalidation in the same pull request.
5. The new adapter and editor may use public Chessground documentation and APIs, but must not copy the private analytics `PositionEditor`, `buildFen`, styles, or other implementation. Side to move, castling rights, and en-passant state remain explicit model fields; they are never inferred or silently cleared by board placement.
6. A pull request that first distributes Chessground must add the exact upstream copyright notice and GPL license text under `LICENSES/`, update `THIRD_PARTY_NOTICES.md`, and include those files in the container image and corresponding source.
7. The public source boundary contains the SvelteKit UI and BFF, including their generic build and run instructions, runtime configuration schema, and versioned evaluator HTTP contract. The BFF must call the evaluator as a separately deployed service over authenticated HTTP and must not link a private evaluator SDK or implementation into the playground. Evaluator implementation, production model weights and manifests, training assets, credentials, private service origins, and environment-specific Aurora or Cloudflare values remain outside this repository.
8. The UI must prominently link to the exact source revision for every deployable build. Local development builds without a verified commit may link to the repository overview but must not be treated as release or deployment evidence. Publishing source does not authorize anonymous access to the deployed service.

## Dependency revalidation: 2026-10-28

Version 10.5.0 was revalidated against the upstream tag and package metadata linked above. The package still identifies the Lichess Team as its author and uses `GPL-3.0-or-later`. The upstream `LICENSE` is byte-identical to the preserved text in `LICENSES/chessground-GPL-3.0-or-later.txt` (Git blob `94a9ed024d3859793618152ea559a168bbcbb5e2`). The playground-owned adapter and reuse boundary remain applicable.

## Consequences

- The editor work can proceed without copying proprietary code or inheriting the analytics editor's implicit FEN behavior.
- Redistributors must follow the AGPL obligations for Fortemate-authored playground code and the preserved upstream terms for third-party code.
- Network deployment needs a corresponding-source link for the deployed revision.
- Every authorized network user must be able to retrieve that source without charge; a private repository link is sufficient only for users who can actually access it.
- Repository visibility is a separate, human-controlled disclosure after the source, history, workflows, and GitHub metadata pass the public-readiness review.

## Approval

The authorized maintainer approved this decision in the [Issue #4 decision comment](https://github.com/fortemate/dicechess-evaluation-playground/issues/4#issuecomment-5469274745).
