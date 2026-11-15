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
3. **Intake and Notion**: Slack and Jira polling, Haiku triage, the Notion factory board and review sync, routines.
4. **The Mac app**: widget pill, kanban queue, task rail, review gates routed to Notion, PR ready, live session with take-over, inbox, connections, routines, rules, settings.
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

## Where work comes from

Routines poll Slack (DMs and @-mentions of you) and Jira (tickets assigned to you) every 10 minutes in
working hours, newer than a saved cursor. Bots, your own messages and muted channels are dropped by plain
rules, and the rest goes to one batched Haiku call: **ignore** (logged), **reply** (a Sonnet draft you send
with `factory send`; nothing is ever posted as you without that), **task**, or **urgent** (outage words, a
VIP, Jira Highest or due within a day; the engine checks these itself too). An empty poll spends no tokens.

Overrule triage with `factory triage ID task` (or `ignore`, `reply`, `urgent`). After three of the same
override, a rule is proposed (`factory rules`), and approved rules sort items before Haiku sees them.

## Connections and Notion

`factory connections` shows Slack, Notion, Jira, Claude Code and GitHub as connected, expired or missing.
`factory connect slack` (or `notion`, `jira`) opens the right page, prints the steps and stores the token
in your Keychain. Each intake run tests its connection first; a failure raises a sticky alert, and the
work that needs it waits and catches up from its cursor.

`factory connect notion` also builds your factory board on a page you share: **Jobs**, **Tickets**
(each tagged with its job, the stage that created it and the stage picking it up) and **Reviews**.
At the research and plan gates the review doc is published there. Comment in Notion on every issue,
then give one overall verdict (`factory approve`, `send-back`, `drop`, or the app). On a send-back, every
comment and the words it's anchored to go to the stage, and the next round lands on the same page.

## Routines

`factory routines` lists everything the factory does on a schedule, with the last run, its result and the
next run: health check, Slack and Jira intake, triage, Notion sync, cleanup, and the post-merge watch
(phase 2, off). Add your own: `factory routines add "Weekly deps" --every 7d --command "factory add 'Update dependencies' --repo ~/code/app"`.

## The app

A Tauri app in `app/`: a Rust shell (`app/src-tauri`) and a Preact UI (`app/ui`) ported from the approved
mockups. The UI never touches the database; every button is an engine call over the Unix socket, relayed
by Rust, and engine events stream back to both windows.

- **Widget (default)**: a pill at the top right that opens into Needs you, Running and Up next. Gates
  can be approved or dropped right there; questions and permission prompts are answered there too.
- **Full app**: the board (drag a card to Parked and back; the engine refuses anything else, with the
  reason), each task's rail with its caps, the research and plan gates (read the summary, review in
  Notion, then one overall verdict), PR ready, Needs you, the live session (watch, take over, or open
  it in Terminal), inbox and triage, connections, routines, rules and learning, settings.
- **Headless**: Settings → How it runs → Headless. The app quits at launch; the engine keeps running.
- The menu bar icon opens the app or Needs you and shows or hides the widget. macOS notifications fire
  when a gate opens, a session asks, or a connection breaks. Closing a window never stops the factory.

```sh
cd app && npm install
npm run app          # builds Factory.app into app/src-tauri/target/release/bundle/macos (needs Rust)
npm run dev          # the app with the UI rebuilt on save
npm run preview      # dev only: the UI in a browser against your running engine, on 127.0.0.1:5174
```

## Develop

```sh
npm test          # builds, then runs the tests (including a walk of every reachable task state)
npm run tlc       # model-checks spec/Factory.tla with TLC (needs Java 11+)
```

Factory files live in `~/.factory` (or `$FACTORY_HOME`), never inside a repo.
