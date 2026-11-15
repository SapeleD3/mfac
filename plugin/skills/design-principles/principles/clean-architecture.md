---
id: clean-architecture
name: Clean architecture (the dependency rule)
group: architecture
rule: Source-code dependencies point only inward, from frameworks and I/O toward use cases and then entities; inner circles know nothing about outer ones.
sources: [martin-2012, cockburn-2005]
related: [hexagonal-architecture, dependency-inversion, separation-of-concerns, functional-core-imperative-shell]
tensions: [kiss, yagni]
pstack: [principle-boundary-discipline]
---
# Clean architecture (the dependency rule)

**Rule.** Martin's synthesis of hexagonal, onion and DCI architectures. Circles: entities (enterprise rules), use cases (application rules), interface adapters (controllers, presenters, gateways), frameworks and drivers. The one rule: nothing in an inner circle names anything in an outer circle, including data formats.

## Apply when
- Deciding where code goes: does it know about HTTP, SQL, React, the filesystem? Then it is outer.
- Reviewing imports: an entity importing a database client, or a use case importing a UI component, breaks the rule.

## Watch for
- Four layers of folders and mapping code for a small app. Keep the rule; skip ceremonial layers. Two circles (pure core, imperative edge) are often enough.
- Mapping objects between every layer by hand. Share plain types inward-out; never outward-in.

## Trade-offs
- More types and boundaries; frameworks become replaceable and the core testable. Costs most where the app is mostly CRUD with little logic.

## Tensions
- [[kiss]]/[[yagni]]: apply the dependency rule always, the full layer set only when the domain is rich.

## Example
`src/statechart.ts` imports nothing from the store, server or UI; `src/store.ts` imports the statechart's types. The dependency arrow points at the rules.

## Cite as
`clean-architecture`: name the inward dependency you kept, or the outward one you removed.

## Sources
- Martin 2012, *The Clean Architecture* (blog; expanded in the 2017 book).
- Cockburn 2005 (ports and adapters).
