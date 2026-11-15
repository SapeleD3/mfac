---
id: crash-only-software
name: Crash-only software
group: reliability
rule: Design components so that crashing and restarting is the only way to stop them and always safe, with all durable state in stores built for it.
sources: [candea-fox-2003, wiggins-2011]
related: [single-source-of-truth, fail-fast, twelve-factor-app, immutability]
tensions: []
pstack: [principle-make-operations-idempotent]
---
# Crash-only software

**Rule.** Candea and Fox: if a system must recover from crashes anyway, make crash-and-recover the *only* shutdown and startup path, so it is the well-tested one. Keep durable state in crash-safe stores (transactions, append-only logs), make requests idempotent or resumable, and use timeouts and leases rather than trusting peers to clean up.

## Apply when
- Daemons, schedulers and runners that own long-lived work (agent sessions, queues).
- Any "graceful shutdown" path with logic the crash path skips: that logic is a bug waiting to happen.

## Watch for
- In-memory state that matters. If losing the process loses it, it is in the wrong place.
- Recovery that needs a human. Startup should reconcile automatically (e.g. compare the DB to live tmux sessions).

## Trade-offs
- Every write goes through a durable store; recovery becomes routine and testable (kill -9 in tests).

## Tensions
- None strong. Pairs with idempotency (pstack `principle-make-operations-idempotent`).

## Example
The engine keeps everything in `factory.db` (one transaction per transition) and tmux. On start it reconciles: tasks marked running whose tmux session is gone are resumed or parked. `kill -9` is a supported way to stop it.

## Cite as
`crash-only-software`: name where state lives and what startup reconciles.

## Sources
- Candea & Fox 2003, *Crash-Only Software* (HotOS IX).
- *The Twelve-Factor App*, factor IX (disposability).
