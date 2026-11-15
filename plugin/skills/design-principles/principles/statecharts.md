---
id: statecharts
name: Explicit state machines and statecharts
group: architecture
rule: When behaviour depends on history, model it as an explicit state machine (or a statechart, with hierarchy and parallel regions), and make that model the single place transitions are decided.
sources: [harel-1987, minsky-2011, lampson-1983]
related: [design-by-contract, single-source-of-truth, functional-core-imperative-shell, data-dominates]
tensions: [kiss]
pstack: [principle-model-the-domain, principle-type-system-discipline]
---
# Explicit state machines and statecharts

**Rule.** Harel: statecharts are state diagrams plus depth (nested states), orthogonality (parallel regions) and broadcast communication. They tame the state explosion of flat machines. In code: one `step(state, event)` function, states as a closed union, transitions in a table, invariants checked.

This factory requires a statechart for every research stage; pstack's `/statechart` and `/create-formal-verification-skill` produce and check it. This note covers *when and why* to design with one.

## Apply when
- Several booleans together encode a mode (`isRunning && !isPaused && hasError`): some combinations are impossible but representable.
- Workflows, UIs, connection lifecycles, retries with caps, approval gates.
- Behaviour must be reviewed by people who do not read code: draw it.

## Watch for
- A state machine for something with two states and one transition. A boolean is fine.
- Transitions decided in several places. The point is one authority.
- Code and model drifting: check one against the other in CI (model checker, generated tests, or a walk of the state space).

## Trade-offs
- An explicit model costs design time; it makes impossible states unrepresentable, reveals missing transitions, and enables model checking.

## Tensions
- [[kiss]]: use when the number of meaningful states exceeds what a reader can hold in their head (roughly more than three, or any retry/cap logic).

## Example
```ts
type State = "intake" | "research" | "plan" | "build" | "review" | "done" | "parked";
const transitions: Record<State, Partial<Record<Event["type"], State>>> = { /* one table, one authority */ };
```

## Cite as
`statecharts`: name the machine, its owner module, and how it is checked.

## Sources
- Harel 1987, *Statecharts: A Visual Formalism for Complex Systems*.
- Minsky 2011, *Effective ML Revisited* ("make illegal states unrepresentable").
- Lampson 1983, *Hints* (on making state and its invariants explicit).
