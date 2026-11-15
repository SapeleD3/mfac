---
id: fail-fast
name: Fail fast
group: reliability
rule: Detect invalid states and inputs as early as possible and stop loudly with a precise message, instead of continuing with bad data.
sources: [shore-2004, raymond-2003]
related: [design-by-contract, crash-only-software, end-to-end-argument]
tensions: [robustness-principle]
pstack: [principle-fix-root-causes, principle-boundary-discipline]
---
# Fail fast

**Rule.** Shore: "a fail-fast system fails immediately and visibly", so bugs are found close to their cause. Raymond's Rule of Repair: "when you must fail, fail noisily and as soon as possible." Validate config at startup, assert invariants, refuse unknown inputs at boundaries.

## Apply when
- Reading config, environment, CLI flags, files from other stages: validate on load, not at first use an hour later.
- Defaults that hide errors (`?? ""`, `catch {}`, `|| 0`) appear in core logic.
- A long-running daemon: refuse to start on bad config rather than run half-configured.

## Watch for
- Failing fast in front of a user for recoverable conditions. At the user-facing edge, fail fast internally, then present a clear, actionable message.
- Crashing on input you do not own and must tolerate (third-party webhooks). Reject that one item, log it, keep serving.

## Trade-offs
- More visible failures early; far fewer silent corruptions and long debugging sessions.

## Tensions
- [[robustness-principle]]: be strict with your own components and data; tolerant only where interoperability demands it, and then log what you tolerated.

## Example
```ts
const home = process.env.FACTORY_HOME;
if (home !== undefined && !isAbsolute(home)) throw new Error(`FACTORY_HOME must be an absolute path, got "${home}"`);
```

## Cite as
`fail-fast`: name the check and how early it now runs.

## Sources
- Shore 2004, *Fail Fast* (IEEE Software).
- Raymond 2003, *The Art of Unix Programming* (Rule of Repair).
