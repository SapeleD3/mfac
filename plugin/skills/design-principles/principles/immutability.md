---
id: immutability
name: Prefer immutable data
group: data
rule: Represent values as immutable and produce new values instead of mutating shared ones; confine mutation to one owner.
sources: [hickey-2011, moseley-marks-2006, kreps-2013]
related: [functional-core-imperative-shell, simple-not-easy, single-source-of-truth, command-query-separation]
tensions: []
pstack: [principle-separate-before-serializing-shared-state]
---
# Prefer immutable data

**Rule.** A value that cannot change can be shared, cached, compared, logged and sent across threads or processes without coordination. Mutation is where time enters the program; keep it in one place with one owner. Append-only logs apply the same idea to storage.

## Apply when
- Data is shared between async callers, workers, or UI and engine.
- You need history, undo, audit or replay: keep events immutable and derive current state.
- Writing state machines: return the next state, do not mutate the current one.

## Watch for
- Hot loops over large arrays where copying matters. Measure; mutate locally inside a function that returns a fresh value.
- Deep-freezing everything at runtime. `readonly` types are usually enough in TypeScript.

## Trade-offs
- Some allocation cost; far fewer aliasing bugs and trivially correct snapshots.

## Tensions
- None strong; performance is the usual counterweight, and it is local.

## Example
```ts
type Machine = Readonly<{ state: State; round: number; approved: ReadonlySet<State> }>;
const next: Machine = { ...m, round: m.round + 1 };
```

## Cite as
`immutability`: name the value made immutable and the single owner of mutation.

## Sources
- Hickey 2011, *Simple Made Easy* (state complects value and time).
- Moseley & Marks 2006; Kreps 2013, *The Log*.
