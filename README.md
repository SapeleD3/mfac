# Factory

An on-device software factory for one person. Work arrives from Slack and Jira, a Haiku triage step
sorts it, and each task runs through research, planning and a build loop driven by Claude Code on
your own subscription. You see it at three gates: the research doc and the plan (reviewed in Notion, the plan only after it's been checked against the original ask),
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
                  (SQLite, WAL)             (one Claude session   (through Claude's own
                                             per stage, in a git   connectors; no
                                             worktree per task)    tokens held)
```

- **Everything stays on the Mac.** No TCP port, no Docker. The parts meet over one Unix socket and one
  SQLite file. The only traffic that leaves the machine is Claude itself, which also reaches Slack, Jira and
  Notion through your connectors.
- **The engine enforces the rules.** A task's life is a statechart ([spec/statechart.md](spec/statechart.md)),
  model-checked with TLC from [spec/Factory.tla](spec/Factory.tla). `src/workflow/statechart.ts` is its code copy,
  and the engine refuses any move it doesn't allow, whoever asks.
- **Three ways to run it:** the widget (default), the full app, or headless with the `factory` CLI.
  They all attach to the same engine; closing the app leaves the factory working.

## Status

Built in milestones, each its own PR:

1. **Engine core**: the statechart in code, SQLite store, Unix socket API, `factory` CLI, CI with TLC.
2. **Claude Code runner**: tmux sessions, git worktrees, the Opus coordinator, stages and hooks.
3. **Intake and Notion**: Slack and Jira polling, Haiku triage, the Notion factory board and review sync, routines.
4. **The Mac app**: widget pill, kanban queue, task rail, review gates routed to Notion, PR ready, live session with take-over, inbox, connections, routines, rules, settings.
5. **Setup and upkeep**: `setup.sh`, the launch agents, `factory doctor`, the factory's skills, the usage
   guard, retros and the self-improving loop.

## Set it up on a Mac

```sh
./setup.sh              # engine, CLI, login agents, skills and the app in ~/Applications
./setup.sh --headless   # no Rust, no app
```

It is safe to run again: each step checks first and installs only what's missing. Only installing
Homebrew (if you don't have it) asks for your password. It installs node, tmux, git, gh, Java (for
TLC), Claude Code, Rust, uv and the graphify CLI, builds and links `factory`, fetches TLC, installs the
skills, builds the app, and registers two login agents (`com.sapeled3.factoryd` keeps the engine
running; `com.sapeled3.factory.app` opens the app). It ends with `factory doctor`.

### Skills

Sessions load the factory's own skills with `--plugin-dir ~/.factory/plugin`; `~/.claude` is never written.

| Skill | Source |
| --- | --- |
| superpowers | [obra/superpowers](https://github.com/obra/superpowers) |
| pstack (statechart, create-formal-verification, poteto-mode, the `principle-*` skills, and its two agents) | Lauren Tan's original [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack), a sparse clone of just that folder, unchanged. Its skills are plain `SKILL.md` folders, which Claude Code reads as they are; the factory's own `pstack-on-claude-code` skill ([plugin/skills](plugin/skills)) maps the Cursor tool names and paths they mention to Claude Code's |
| ponytail | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| graphify | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (the CLI comes from `uv tool install graphifyy`) |
| design-principles | bundled in this repo ([plugin/skills/design-principles](plugin/skills/design-principles/SKILL.md)); `factory skills add design-principles <git url or folder>` overrides it |

If Claude Code already has one from the same source (a plugin under `~/.claude/plugins/cache` whose
manifest names the same GitHub owner; for graphify, `~/.claude/skills/graphify`), the factory links to
that copy instead of cloning it again. A fork or port is never taken for the original. A source can be
`<git url>#<folder>` to take one folder of a larger repo, and if a skill's source changes, the next
install replaces the factory's old copy. `factory skills` lists them,
`factory skills update` pulls new versions, and `factory skills add NAME SOURCE` adds or overrides one.

### Upkeep

- `factory doctor` checks tools, Claude Code (and warns if `ANTHROPIC_API_KEY` would bill the API), the
  engine, the login agent, tmux, TLC, connections, skills and the app. It also runs daily.
- **Usage guard**: reads Claude Code's own usage logs every two minutes and holds new stages when the
  factory's share of the current 5-hour window passes the ceiling in Settings. Set limits with
  `factory usage --limit-5h N --limit-week N`, or let it estimate from your busiest window in 14 days.
- **Retros**: every task that ends writes `retro.md` (send-backs at each gate, review loops, tokens, minutes, times it needed you).
  `factory retro` lists them. Weekly, once there are at least 3 new retros, the improve-factory routine
  opens a task against this repo proposing changes to prompts, rules and skills, gated like any other.
- `factory update` pulls this repo, rebuilds (the app too, unless headless) and restarts the engine.

## Try the engine

Needs Node 22.13 or newer (for the built-in SQLite).

```sh
npm install
npm run build
npm link                  # puts `factory` on your PATH

factory engine start      # setup.sh's login agent does this for you
factory add "Fix the Safari export button" --repo ~/code/web --tag ui
factory ls
factory show F-001
factory watch             # stream every move as it happens
```

Gate commands: `factory approve`, `factory send-back --to Planning --note "..."`, `factory drop`,
`factory park`, `factory unpark`, `factory stop` (stops a running stage; the task goes to Needs you),
and `factory tag F-001 +learn -urgent`. `factory add --backlog`, `factory backlog F-001` and
`factory prioritize F-001` move work between the backlog and the queue; `factory restore F-001` takes a
task out of the bin (parked work goes back where it was, dropped work comes back as a new backlog task).

## How a task runs

Each task gets a parent Claude Code session on Opus, the coordinator. It starts each stage as its own
session (Sonnet by default) in the task's git worktree, reads what the stage wrote, and decides the next
step with `factory coord` commands. The engine checks every one of those against the statechart.

| Stage | Writes (in `~/.factory/jobs/<task>/`) | May do without asking |
| --- | --- | --- |
| researcher | requirements.md (R1, R2, … each with source quote, acceptance criterion and how to verify), research.md, statechart.md, a TLA+ model + .cfg | read the repo, search the web, run TLC |
| planner | plan.md with a traceability table, tickets (`factory ticket add`) | read the repo |
| requirements_review (Opus) | review-requirements.md: its own read of the source, a traceability matrix, gaps, scope creep, `VERDICT: covered` or `gaps` | read the repo and the source in Slack or Jira |
| builder | build.md, pr.md, commits on the task branch | edit code, run the repo's checks, `git add`/`commit` |
| code_review, security_review, ui_review (ui tag) | review-*.md with a row per requirement, a ticket per blocking finding | read, run the repo's checks |
| confirm | confirm.md with PASS or FAIL per requirement and evidence, ending `VERDICT: solved` or `not solved` | run the app and the repo's checks |

Every prompt is a contract: its inputs, its output's required sections, its acceptance criteria, what
counts as evidence, and when to stop and say BLOCKED instead of guessing. Every stage traces its work back
to the requirement ids, so the chain from the original ask to the merged code can be followed end to end.

- **The research rule is a check, not a prompt.** `factory coord submit-research` makes the engine check
  requirements.md's shape and run TLC itself on the stage's model. A failure sends research back with the
  reason (max 3).
- **The plan is checked against the original ask before you see it.** A separate requirements review
  rereads the Slack message or Jira ticket and traces every requirement into the research and the plan.
  Gaps or scope creep go back to the planner (max 3). The engine refuses "covered" unless every
  requirement appears in the plan's traceability table and the review's matrix.
- **Solved means every requirement passed.** The engine refuses `confirm --solved` unless confirm.md has a
  PASS line for every requirement.
- **No assumed toolchain.** At start the factory reads the repo's manifests (package.json scripts, Makefile,
  justfile, Taskfile, Cargo, Go, Python, Ruby, Maven, Gradle, Swift, .NET, Elixir, Composer) and its CI
  workflows into conventions.md, and lets the build, review and confirm sessions run exactly those commands.
- **Reviews run in parallel** after each build. The coordinator compiles their findings into one list
  and sends it back to the builder, at most 3 times.
- **No human gate on the build.** You first see code as a PR that's been reviewed, fixed and confirmed.
  Before the PR gate the engine rebases on the latest base, pushes and opens the PR with `gh`, with the
  confirm evidence, statechart, TLC result and review summary in its description.
- **Permissions:** each station has an allowlist (`src/stages/agent.ts`). Anything else goes to the
  PermissionRequest hook and waits for your click (`factory prompts`, `factory allow`/`deny`; the app's
  panel in milestone 4). Pushing, merging and `sudo` are always denied. Nothing runs with permissions skipped.
- **Watch and take over:** `factory sessions`, `factory attach F-001` (read along in your terminal),
  `factory take-over F-001` (the coordinator waits until `--off`).
- **Repo rules always apply:** sessions start inside the worktree, so CLAUDE.md, `.claude/settings.json`,
  skills and hooks load exactly as if you opened the repo yourself.
- **Design principles:** every station consults the bundled `design-principles` skill
  ([plugin/skills/design-principles](plugin/skills/design-principles/SKILL.md)): 41 sourced principles, a
  decision guide and a data-structure guide, complementing pstack's `principle-*` skills. Outputs end with
  "Design principles applied". `npm run principles:fetch` downloads the free source PDFs into
  `~/.factory/cache/design-principles/` (never into git).

Slots: at most 3 tasks run sessions at once (`factory settings slots=2`); `factory pause` stops new starts.

**Sessions stay tidy.** Every Claude session the factory starts has a name. Stage sessions are named for their task
and stage (`factory-F-012-research`, `factory-F-012-build-r2`). Small jobs reuse one session each, resumed call
after call: `factory-triage`, `factory-replies`, and `factory-mcp-slack` / `-notion` / `-jira` for connector
calls. Those run in `~/.factory/sessions`, so they list under one Claude project and never in your repos, and
each one is replaced by a fresh session (old transcript deleted) after 30 calls or a week, to keep its context
and cost small. A week after a task finishes, the cleanup routine deletes its sessions' transcripts.

## Where work comes from

Every 30 minutes in working hours (Settings: 15, 30 or 60), a small Haiku call reads Slack (DMs, group DMs
and @-mentions of you) and Jira (tickets assigned to you) since the last run, through the Slack and
Atlassian connectors you already have in Claude. Those calls may use only the connector's read-only tools.
Approved rules sort what they can, and the rest goes to one batched Haiku call: **ignore** (logged),
**reply** (a Sonnet draft you send with `factory send`; nothing is ever posted as you without that),
**task**, or **urgent** (outage words, a VIP, Jira Highest or due within a day; the engine checks these
itself too).

Overrule triage with `factory triage ID task` (or `ignore`, `reply`, `urgent`). After three of the same
override, a rule is proposed (`factory rules`), and approved rules sort items before Haiku sees them.

## Connections and Notion

Slack, Notion and Jira come through Claude itself: the connectors (or MCP servers) your Claude Code already
has. The factory holds no tokens, needs no Slack app and no admin approval beyond what Claude already has.

- `factory connections` shows Slack, Notion, Jira, Claude Code and GitHub as connected, expired or missing.
  The health check reads `claude mcp list` every 5 minutes, which makes no model call. A connector that
  needs you to sign in again shows as expired with a sticky alert, and the work that needs it waits and
  catches up from its cursor.
- `factory connect slack` (or `notion`, `jira`) finds the connector in `claude mcp list`. If it needs you
  to sign in (or you pass `--login`), it runs Claude Code's own sign-in, `claude mcp login "claude.ai Slack"`,
  which opens your browser; the factory never sees the credentials. If Claude has no such connector yet,
  it opens [Claude's connector settings](https://claude.ai/customize/connectors). Then it makes one small
  Haiku call to confirm it can read and remembers the connector's tool names. With more than one match,
  pick with `--server "<name>"`. Inside Claude Code, `/mcp` does the same sign-in by hand.
- Every factory session may use the connectors' **read-only** tools without asking, so stations can look
  up the thread or ticket a task came from. Posting, commenting and editing still ask you, except the
  factory's own write-back at gates and replies you press Send on.
- `factory disconnect slack` stops the factory using a connector; Claude keeps it. Remove it in Claude's
  connector settings to revoke access entirely.

`factory connect notion` also builds your factory board on a page you pick: **Jobs**, **Tickets**
(each tagged with its job, the stage that created it and the stage picking it up) and **Reviews**.
At the research and plan gates the review doc is published there. Comment in Notion on every issue,
then give one overall verdict (`factory approve`, `send-back`, `drop`, or the app). On a send-back, every
comment and the words it's anchored to go to the stage, and the next round lands on the same page.
Board changes queue up and go in one batched call every 10 minutes (none when nothing changed); review
pages are published as soon as a gate opens, and tickets you add on the board are picked up every 2 hours.

Your own Notion kanban board can be a source of work too: `factory notion intake <board link>` (or the
Connections page). Every 15 minutes in working hours, cards in its "Ready for agent" column (change it with
`--status`) go straight to the queue without triage, once each, and the factory comments on the card when
the task finishes.

## Routines

`factory routines` lists everything the factory does on a schedule, with the last run, its result and the
next run: health check, Slack, Jira and Notion board intake, triage, Notion sync and ticket pickup, cleanup, and the post-merge watch
(phase 2, off). Every built-in schedule is a default you can change (`factory routines set ID --every 1h`, or the
pencil in the app) or pause. A run ends ok, warn (it ran but found something to fix, like an expired connector),
skipped or failed. Add your own: `factory routines add "Weekly deps" --every 7d --command "factory add 'Update dependencies' --repo ~/code/app"`.
The app also lists your Mac's own scheduled jobs, read-only: launch agents in `~/Library/LaunchAgents` with
their `launchctl` state, and your crontab.

## The app

A Tauri app in `app/`: a Rust shell (`app/src-tauri`) and a Preact UI (`app/ui`) ported from the approved
mockups. The UI never touches the database; every button is an engine call over the Unix socket, relayed
by Rust, and engine events stream back to both windows.

- **Widget (default)**: a pill at the top right that opens into Needs you, Running and Up next. Gates
  can be approved or dropped right there; questions and permission prompts are answered there too.
- **Full app**: the board (the engine refuses moves it doesn't allow, with the reason), the backlog and
  the bin, each task's rail with its caps, the research and plan gates (read the summary, review in
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

The engine is split into modules by what they do, in layers. A module imports only from its own layer or lower ones, and `npm run check:rules` enforces it.

| Layer | Module | What it owns |
| --- | --- | --- |
| 0 | `shared/` | Paths under `~/.factory`, the HTTP error type |
| 1 | `workflow/` | The statechart, the task store and the engine that moves tasks through it |
| 2 | `daemon/` | The socket server and client, the core API, and the plugin host |
| 3 | `claude/` | Named, reused `claude -p` sessions and usage reading |
| 3 | `skills/` | Installing the core skills and the design-principles KB |
| 3 | `repo/` | Git worktrees and branches, the target repo's conventions, the repo rules check |
| 3 | `connectors/` | Slack, Notion and Jira through Claude's MCP connectors, and connection health |
| 3 | `board/` | Tickets, and the Notion board sync |
| 3 | `stages/` | The runner, stage sessions in tmux, and the research check |
| 3 | `integrations/` | Intake from Slack and Jira, triage and routines |
| 3 | `upkeep/` | Doctor, launchd agents, retros and self-update |
| 4 | `cli/` | The `factory` command |
| 4 | `main/` | The `factoryd` entry point, which wires the plugins together |

```sh
npm test          # builds, then runs the tests (including a walk of every reachable task state)
npm run tlc       # model-checks spec/Factory.tla with TLC (needs Java 11+)
npm run check:rules
```

In a target repo, that repo's conventions win. Stage sessions run inside its worktree, so its CLAUDE.md, `.claude` skills, settings and hooks load as usual, and its git hooks run on every commit and push. Its gitignored `.claude/settings.local.json` and `CLAUDE.local.md` are copied into the worktree. At start the factory writes `conventions.md` to the job folder: PR templates, CONTRIBUTING, commitlint and commitizen config, commit-msg hooks, branch-name rules and recent branch names. The builder writes `pr.md` from it, with the branch, title and body in the repo's style. The factory renames the branch to match before pushing, and opens the PR with that title and body. The factory's defaults apply only where the repo defines nothing.

The rules in [CLAUDE.md](CLAUDE.md) apply here, and the no-credit rule applies to everything the factory writes in other repos: no agent credit in commits or PRs, and no comments unless they give the next developer context the code can't. Stage sessions run with attribution turned off, and the factory strips any credit lines from a task branch's commits and PR body before it pushes.

Factory files live in `~/.factory` (or `$FACTORY_HOME`), never inside a repo.
