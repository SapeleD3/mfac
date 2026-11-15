---
id: design-by-contract
name: Design by contract
group: collaboration
rule: State each operation's preconditions, postconditions and invariants explicitly, and check them where violations are cheapest to catch.
sources: [meyer-1997, shore-2004]
related: [liskov-substitution, fail-fast, statecharts]
tensions: [robustness-principle]
pstack: [principle-type-system-discipline, principle-boundary-discipline]
---
# Design by contract

**Rule.** Meyer: a routine's caller guarantees the precondition, the routine guarantees the postcondition, and the class keeps its invariant between calls. Write these down, in types first, then assertions, then docs.

## Apply when
- An invariant spans several fields ("`round` never exceeds `CAP`", "a task in `build` has a worktree").
- Writing an interface that several implementations (or fakes) must honour ([[liskov-substitution]]).
- A model checker or property test needs properties to check (TLA+ invariants are contracts).

## Watch for
- Duplicating checks at every layer. Check at boundaries and in the module that owns the invariant; trust inside.
- Contracts only in comments. Prefer types, then runtime assertions, then tests.

## Trade-offs
- Assertions cost a little runtime and must be maintained; they turn silent corruption into an early, located failure ([[fail-fast]]).

## Tensions
- [[robustness-principle]]: contracts say "reject what violates the precondition"; Postel says "be liberal in what you accept". At internal boundaries, contracts win.

## Example
```ts
export function step(m: Machine, e: Event): Machine {
  const next = transition(m, e);
  for (const [name, holds] of Object.entries(invariants)) if (!holds(next)) throw new Error(`invariant ${name} broken by ${e.type}`);
  return next;
}
```

## Cite as
`design-by-contract`: name the invariant or postcondition and where it is enforced.

## Sources
- Meyer 1997, *Object-Oriented Software Construction*, 2nd ed., ch. 11.
- Shore 2004, *Fail Fast* (assertions as early detection).
