---
id: cohesion-and-coupling
name: High cohesion, low coupling
group: modularity
rule: Put things that change together in the same module, and make the connections between modules few, narrow and explicit.
sources: [stevens-myers-constantine-1974, parnas-1972, ousterhout-2018]
related: [information-hiding, separation-of-concerns, law-of-demeter, single-responsibility]
tensions: [dry]
pstack: [principle-minimize-reader-load]
---
# High cohesion, low coupling

**Rule.** Cohesion: how strongly the parts of one module belong together. Coupling: how much one module must know about another. Aim for high cohesion and low coupling; it is the yardstick most other modularity principles are measuring.

## Apply when
- Deciding whether two functions belong in one file or two.
- A pull request touches many modules for one small behaviour change (low cohesion, high coupling).
- Reviewing imports: a module that imports from everywhere is a coupling hub.

## Watch for
- Hidden coupling: shared global state, a shared database table written by two modules, implicit ordering ("call init first"), magic strings both sides must agree on.
- Temporal coupling (A must run before B) that is not visible in types.
- "Coincidental cohesion": a utils.ts grab-bag.

## Trade-offs
- Lowering coupling usually costs an interface or a message type. Lowering it to zero is impossible; make the remaining coupling explicit (types, function arguments) rather than implicit (globals, conventions).

## Tensions
- [[dry]]: removing duplication between two modules couples them through the shared helper. Prefer duplication when the two copies change for different reasons.

## Example
```ts
// Coupled through a convention both sides must remember.
writeFileSync(join(dir, "review-code.md"), body);    // writer
readFileSync(join(dir, "review-code.md"), "utf8");   // reader elsewhere
// Coupled through one explicit name.
export const jobFile = { codeReview: "review-code.md" } as const;
```

## Cite as
`cohesion-and-coupling`: say what now changes together, or which dependency you removed or made explicit.

## Sources
- Stevens, Myers & Constantine 1974, *Structured Design* (origin of the cohesion and coupling scales).
- Parnas 1972; Ousterhout 2018 ch. 5 (information leakage as coupling).
