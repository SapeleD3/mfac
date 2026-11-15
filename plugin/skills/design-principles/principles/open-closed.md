---
id: open-closed
name: Open/closed principle (OCP)
group: solid
rule: Make the parts that vary pluggable so new behaviour is added by adding code, not by editing stable code, but only along axes of change you have actually seen.
sources: [meyer-1997, martin-2000]
related: [dependency-inversion, composition-over-inheritance, hexagonal-architecture]
tensions: [yagni, kiss]
pstack: [principle-model-the-domain]
---
# Open/closed principle (OCP)

**Rule.** Meyer (1988): modules should be open for extension and closed for modification. Practically: when the same `switch` on a kind grows with every feature, turn the kinds into a table or an interface so adding a kind is one new entry.

## Apply when
- The third time you add a case to the same conditional in several places (the axis of change is now proven).
- Plug-in points the product needs: new intake sources, new review stations, new storage adapters.

## Watch for
- Speculative extension points: strategy interfaces with one implementation "in case". That is [[yagni]] territory.
- Closing code that is still young. Early code should be easy to *modify*.

## Trade-offs
- Extension points add indirection and make the flow harder to read. Pay for them only where variation is real.
- Exhaustive `switch` over a discriminated union is a good alternative in TypeScript: the compiler finds every place to update, which can beat OCP for closed sets.

## Tensions
- [[yagni]]/[[kiss]]: prefer the plain conditional until the variation repeats.
- With a closed, known set of variants, prefer exhaustive matching over open extension (see pstack `principle-type-system-discipline`).

## Example
```ts
// Every new source edits this function.
function ingest(src: Source) { if (src.kind === "slack") {/*...*/} else if (src.kind === "jira") {/*...*/} }
// New source = new entry; ingest() is closed.
const adapters: Record<Source["kind"], (s: Source) => Item[]> = { slack: fromSlack, jira: fromJira };
```

## Cite as
`open-closed`: name the axis of variation and the extension point that now absorbs it.

## Sources
- Meyer 1997, *Object-Oriented Software Construction* (origin, 1st ed. 1988).
- Martin 2000, *Design Principles and Design Patterns* (the abstraction-based restatement).
