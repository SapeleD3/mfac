---
id: yagni
name: You aren't gonna need it (YAGNI)
group: simplicity
rule: Do not build capability for a presumed future need; build it when the need is real, and keep the code easy to change so that is cheap.
sources: [beck-1999, fowler-yagni]
related: [kiss, galls-law, wrong-abstraction]
tensions: [information-hiding, open-closed]
pstack: [principle-laziness-protocol]
---
# You aren't gonna need it (YAGNI)

**Rule.** From Extreme Programming. Fowler lists the costs of a presumptive feature: the cost to build, the cost of delay to what you should have built, the cost of carrying it, and the cost of repair when you guessed wrong. Most guesses are wrong.

## Apply when
- A plan includes options, settings, plug-in points, multi-tenant support or "future" fields that no current ticket needs.
- Someone says "while we're here, let's also make it support ...".

## Watch for
- YAGNI does **not** apply to work that makes the code easier to change: refactoring, tests, clear names, good boundaries. Those are what make deferring features safe.
- Decisions that are expensive to reverse later (data formats, public APIs, security). Think ahead there; YAGNI is for features, not for one-way doors.

## Trade-offs
- Building later may cost a little more per feature; you skip all the features you never needed.

## Tensions
- [[information-hiding]]/[[open-closed]]: hide or open along change you have *evidence* for. Without evidence, YAGNI wins.

## Example
Do not add a `provider: "claude" | "codex"` switch to every call site while only Claude Code is supported. Keep the agent launch in one module, so adding Codex later is one change.

## Cite as
`yagni`: name the speculative capability you declined to build.

## Sources
- Beck 1999, *Extreme Programming Explained*.
- Fowler 2015, *Yagni* (bliki).
