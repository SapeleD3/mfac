# Factory

An on-device software factory for one person. Work arrives from Slack and Jira, a Haiku triage step
sorts it, and each task runs through research, planning and a build loop driven by Claude Code on
your own subscription. You see it at three gates: the research doc and the plan (reviewed in Notion),
and a pull request that has already been reviewed, fixed and confirmed to solve the problem.

"Factory" is a placeholder name.

## How it fits together

```
 Factory.app (Tauri)          factory CLI          Claude Code hooks
   widget pill + window          │                      │
        │ Tauri IPC              │                      │
        └──────── Unix socket ~/.factory/run/factoryd.sock (mode 0600) ───────┐
                                                                               │
                       factoryd (Node): engine, queue, runner, intake, routines
                         │                     │                    │
                  ~/.factory/factory.db     tmux -L factory      Slack / Jira / Notion
                  (SQLite, WAL)             (one Claude session   (outbound only)
                                             per stage, in a git
                                             worktree per task)
```

- **Everything stays on the Mac.** No TCP port, no Docker. The parts meet over one Unix socket and one
  SQLite file. The only traffic that leaves the machine is outbound: Claude itself, Slack, Jira and Notion.
- **The engine enforces the rules.** A task's life is a statechart ([spec/statechart.md](spec/statechart.md)),
  model-checked with TLC from [spec/Factory.tla](spec/Factory.tla). `src/statechart.ts` is its code copy,
  and the engine refuses any move it doesn't allow, whoever asks.
- **Three ways to run it:** the widget (default), the full app, or headless with the `factory` CLI.
  They all attach to the same engine; closing the app leaves the factory working.

## Status

Built in milestones, each its own PR:

1. **Engine core**: the statechart in code, SQLite store, Unix socket API, `factory` CLI, CI with TLC.
2. **Claude Code runner**: tmux sessions, git worktrees, the Opus coordinator, stages and hooks.
3. Intake and Notion: Slack and Jira polling, Haiku triage, the Notion factory board and review sync, routines.
4. The Tauri app: widget pill, kanban queue, gates, live session, connections, routines.
5. `setup.sh`, the launch agent, `factory doctor`, and the self-improving loop.

## Try the engine

Needs Node 22.13 or newer (for the built-in SQLite).

```sh
npm install
npm run build
npm link                  # puts `factory` on your PATH

factory engine start      # the launch agent does this at login once setup.sh exists
factory add "Fix the Safari export button" --repo ~/code/web --tag ui
factory ls
factory show F-001
factory watch             # stream every move as it happens
```

Gate commands: `factory approve`, `factory send-back --to Planning --note "..."`, `factory drop`,
`factory park`, `factory unpark`, `factory stop` (stops a running stage; the task goes to Needs you),
and `factory tag F-001 +learn -urgent`.

## How a task runs

Each task gets a parent Claude Code session on Opus, the coordinator. It starts each stage as its own
session (Sonnet by default) in the task's git worktree, reads what the stage wrote, and decides the next
step with `factory coord` commands. The engine checks every one of those against the statechart.

| Stage | Writes (in `~/.factory/jobs/<task>/`) | May do without asking |
| --- | --- | --- |
| researcher | research.md, statechart.md, a TLA+ model + .cfg | read the repo, search the web, run TLC |
| planner | plan.md, tickets (`factory ticket add`) | read the repo |
| builder | build.md, commits on the task branch | edit code, run lint/types/tests, `git add`/`commit` |
| code_review, security_review, ui_review (ui tag) | review-*.md, a ticket per blocking finding | read, run tests |
| confirm | confirm.md ending `VERDICT: solved` or `not solved`, evidence files | run the app and tests |

- **The research rule is a check, not a prompt.** `factory coord submit-research` makes the engine run
  TLC itself on the stage's model. A failure sends research back with the counterexample (max 3).
- **Reviews run in parallel** after each build. The coordinator compiles their findings into one list
  and sends it back to the builder, at most 3 times.
- **No human gate on the build.** You first see code as a PR that's been reviewed, fixed and confirmed.
  Before the PR gate the engine rebases on the latest base, pushes and opens the PR with `gh`, with the
  confirm evidence, statechart, TLC result and review summary in its description.
- **Permissions:** each station has an allowlist (`src/agent.ts`). Anything else goes to the
  PermissionRequest hook and waits for your click (`factory prompts`, `factory allow`/`deny`; the app's
  panel in milestone 4). Pushing, merging and `sudo` are always denied. Nothing runs with permissions skipped.
- **Watch and take over:** `factory sessions`, `factory attach F-001` (read along in your terminal),
  `factory take-over F-001` (the coordinator waits until `--off`).
- **Repo rules always apply:** sessions start inside the worktree, so CLAUDE.md, `.claude/settings.json`,
  skills and hooks load exactly as if you opened the repo yourself.

Slots: at most 3 tasks run sessions at once (`factory settings slots=2`); `factory pause` stops new starts.

## Develop

```sh
npm test          # builds, then runs the tests (including a walk of every reachable task state)
npm run tlc       # model-checks spec/Factory.tla with TLC (needs Java 11+)
```

Factory files live in `~/.factory` (or `$FACTORY_HOME`), never inside a repo.
