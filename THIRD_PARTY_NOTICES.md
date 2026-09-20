# Third-Party Notices

This file records third-party material distributed in or used to produce Dice Chess Evaluation Playground. Third-party material remains under its own license; the project's `AGPL-3.0-only` declaration does not replace those terms.

## Current build

The current lockfile and container build use the following directly relevant MIT-licensed projects. Their complete license texts are retained in their installed packages and copied into `/app/licenses/third-party/` in the runtime image:

| Component              | Locked version | Copyright source                              | License |
| ---------------------- | -------------: | --------------------------------------------- | ------- |
| Svelte                 |         5.57.0 | Svelte Contributors                           | MIT     |
| SvelteKit              |         2.70.3 | SvelteKit contributors                        | MIT     |
| SvelteKit adapter-node |          5.5.7 | SvelteKit contributors                        | MIT     |
| Vite                   |          8.2.2 | VoidZero Inc. and Vite contributors           | MIT     |
| Tailwind CSS           |          4.3.3 | Tailwind Labs, Inc.                           | MIT     |
| cookie                 |          0.7.2 | Roman Shtylman and Douglas Christopher Wilson | MIT     |
| clsx                   |          2.1.1 | Luke Edwards                                  | MIT     |
| devalue                |          5.9.2 | devalue contributors                          | MIT     |
| jose                   |         6.2.10 | Filip Skokan                                  | MIT     |
| set-cookie-parser      |          3.1.2 | Nathan Friedly                                | MIT     |

The exact dependency graph and package license metadata are recorded in `package-lock.json`. The Node.js container base also retains the operating-system notices supplied by the upstream `node:26-trixie-slim` image.

## Fortemate brand assets (trademark, not licensed with the sources)

`static/favicon.svg`, `static/favicon-16.png`, `static/favicon-32.png`, `static/favicon-48.png`, `static/apple-touch-icon-180.png` and `src/lib/assets/fortemate-mark.svg` (inlined verbatim in `src/lib/components/BrandMark.svelte`) are byte-identical copies of the approved Fortemate web identity bundle (`fortemate/brand`, `dist/identity/web`, commit `44f2b4a`). The Fortemate name and mark identify the origin of this deployment and are trademarks of Jegors Čemisovs; they are **not** covered by the `AGPL-3.0-only` licence of the sources, and redistributions or forks must not use them to suggest origin from or endorsement by Fortemate. Replace them with your own identity when you redistribute a modified playground.

## Chessground

The position editor distributes Chessground through a playground-owned adapter.

- Package: `@lichess-org/chessground@10.1.1`
- Reviewed upstream commit: <https://github.com/lichess-org/chessground/tree/4d7e91bb02bd7ed2796aac2c1956c9552b323e7c>
- Copyright: Lichess Team
- License: `GPL-3.0-or-later`
- Preserved license text: [`LICENSES/chessground-GPL-3.0-or-later.txt`](LICENSES/chessground-GPL-3.0-or-later.txt)

Chessground retains its upstream license identity and is not described as Fortemate-authored or relicensed under AGPL. The exact dependency graph and resolved package integrity are recorded in `package-lock.json`. See [ADR 0001](docs/decisions/0001-board-editor.md) for the approved reuse boundary.
