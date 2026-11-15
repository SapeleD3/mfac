---
id: dry
name: Don't repeat yourself (DRY)
group: simplicity
rule: Every piece of knowledge should have a single, authoritative representation in the system; duplication of knowledge, not of text, is the problem.
sources: [hunt-thomas-1999]
related: [single-source-of-truth, wrong-abstraction, cohesion-and-coupling]
tensions: [wrong-abstraction, cohesion-and-coupling, information-hiding]
pstack: [principle-type-system-discipline]
---
# Don't repeat yourself (DRY)

**Rule.** Hunt and Thomas define DRY about *knowledge*: a business rule, a schema, a constant, a protocol. If changing one fact needs edits in several places, the fact is duplicated. Two code fragments that look alike but encode different facts are not a DRY violation.

## Apply when
- The same rule (a cap, a state list, a file name, a validation) appears in code, tests, docs and config.
- Types are hand-copied from a schema: derive them instead.
- A spec and its implementation must agree (e.g. a TLA+ model and the code statechart): make one generate or check the other.

## Watch for
- Merging look-alike code that changes for different reasons. That is the wrong abstraction ([[wrong-abstraction]]).
- Over-DRY tests: tests should be readable on their own; some repetition there is fine.

## Trade-offs
- One source of truth needs a mechanism (import, codegen, a check in CI). Without one, "DRY" docs drift anyway.

## Tensions
- [[wrong-abstraction]]: wait for the third occurrence and the same reason to change.
- [[cohesion-and-coupling]]: a shared helper couples its callers.

## Example
```ts
// The cap lives once; the spec check in CI reads the same value.
export const CAP = 3;
```

## Cite as
`dry`: name the fact and its single home.

## Sources
- Hunt & Thomas 1999, *The Pragmatic Programmer*, "The Evils of Duplication" (and the 2019 edition's clarification that DRY is about knowledge).
