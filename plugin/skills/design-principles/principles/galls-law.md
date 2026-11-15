---
id: galls-law
name: Gall's law (evolve from a working simple system)
group: simplicity
rule: A complex system that works evolved from a simple system that worked; start with the smallest end-to-end thing that runs and grow it.
sources: [gall-1975, brooks-1975]
related: [kiss, yagni, end-to-end-argument]
tensions: []
pstack: [principle-sequence-verifiable-units, principle-prove-it-works]
---
# Gall's law

**Rule.** Gall: "A complex system designed from scratch never works and cannot be patched up to make it work. You have to start over, beginning with a working simple system." Brooks: "plan to throw one away; you will, anyhow."

## Apply when
- Planning milestones: each one should leave a running system (a walking skeleton), not a pile of finished parts that have never met.
- A big-bang rewrite is proposed.

## Watch for
- "Simple" first versions that skip the hard part (the end-to-end path). The skeleton must cross every boundary, thinly.

## Trade-offs
- Early versions get reworked; integration risk is retired early instead of at the end.

## Tensions
- None strong. It shapes how [[yagni]] and [[kiss]] are sequenced over time.

## Example
Milestone 1 of a factory: one ticket goes through every station with stub agents and comes out as a PR. Real research, review and UI are added on top of a pipeline that already works.

## Cite as
`galls-law`: name the smallest working system you started from.

## Sources
- Gall 1975, *Systemantics*.
- Brooks 1975, *The Mythical Man-Month*, "Plan to Throw One Away".
