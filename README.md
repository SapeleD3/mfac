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

1. **Engine core** (this PR): the statechart in code, SQLite store, Unix socket API, `factory` CLI, CI with TLC.
2. Claude Code runner: tmux sessions, git worktrees, the Opus coordinator, stages and hooks.
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

## Develop

```sh
npm test          # builds, then runs the tests (including a walk of every reachable task state)
npm run tlc       # model-checks spec/Factory.tla with TLC (needs Java 11+)
```

Factory files live in `~/.factory` (or `$FACTORY_HOME`), never inside a repo.
