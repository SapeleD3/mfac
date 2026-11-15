---
id: functional-core-imperative-shell
name: Functional core, imperative shell
group: architecture
rule: Put decisions in pure functions over plain values, and keep I/O, time, randomness and mutation in a thin outer shell that calls them.
sources: [bernhardt-2012, moseley-marks-2006]
related: [hexagonal-architecture, clean-architecture, immutability, separation-of-concerns, command-query-separation]
tensions: [tell-dont-ask]
pstack: [principle-boundary-discipline]
---
# Functional core, imperative shell

**Rule.** Bernhardt: the core is many small pure functions with many paths (unit-test them exhaustively, no mocks); the shell has few paths and many dependencies (integration-test a few cases). Values are the boundary between them.

## Apply when
- Logic is entangled with database calls, timers, `Date.now()`, network or tmux.
- Tests need lots of mocks: the decision code is not separated from the effects.
- A state machine: `step(state, event) -> state` is the core; persisting and executing the effects is the shell.

## Watch for
- Pushing everything into the shell because "it's all I/O". Look for the decision hiding inside.
- A core that returns giant effect descriptions that the shell interprets with more logic. Keep the shell dumb.

## Trade-offs
- Passing time and data in explicitly makes signatures longer; it makes tests trivial and behaviour deterministic.

## Tensions
- [[tell-dont-ask]] in its object form keeps behaviour inside mutable objects; here data is plain. Co-locate the type and its pure functions in one module to keep both benefits.

## Example
```ts
// Core: pure, total, exhaustively testable.
export function step(m: Machine, e: Event): Machine { /* ... */ }
// Shell: load, call core, save, run effects.
const next = step(store.load(id), event); store.save(id, next); await runner.apply(next);
```

## Cite as
`functional-core-imperative-shell`: name the pure function and the shell that calls it.

## Sources
- Bernhardt 2012, *Functional Core, Imperative Shell* screencast and *Boundaries* talk.
- Moseley & Marks 2006 (separating essential logic from state and control).
