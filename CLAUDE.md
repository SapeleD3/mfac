# Rules for this repo

These apply to every change, by people or agents, and to everything the factory writes in other repos.

- Never credit Claude or any agent. No `Co-Authored-By` trailers, no "Generated with Claude Code" lines, no session links, in commits, PR titles, PR bodies or code.
- No comments by default. Add one only to give the next developer context they can't get from the code: a non-obvious why, a workaround, a constraint. Never to narrate what the code does, never as notes to yourself or to the reader of a PR.
- No section-break or banner comments (`// ---------- x ----------`, `/* ==== */`).

`npm run check:rules` checks the code and, in CI, the PR title and body.
