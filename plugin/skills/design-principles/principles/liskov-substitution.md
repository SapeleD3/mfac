---
id: liskov-substitution
name: Liskov substitution (LSP)
group: solid
rule: Anything that claims to implement an interface or subtype must honour its full contract, so callers never need to check which implementation they got.
sources: [liskov-wing-1994, martin-2000, meyer-1997]
related: [design-by-contract, interface-segregation, composition-over-inheritance]
tensions: []
pstack: [principle-type-system-discipline]
---
# Liskov substitution (LSP)

**Rule.** Liskov and Wing: a subtype must preserve the supertype's behaviour: no stronger preconditions, no weaker postconditions, keep the invariants, and do not throw where the parent promised not to. Types checking is not enough; the *behaviour* must substitute.

## Apply when
- Writing a second implementation of an interface (a fake for tests, a new adapter).
- A caller does `if (x instanceof Special)` to work around one implementation. That is an LSP violation surfacing.
- Designing class hierarchies (usually a sign to prefer [[composition-over-inheritance]]).

## Watch for
- Implementations that throw "not supported" for part of the interface. Split the interface instead ([[interface-segregation]]).
- Fakes in tests that are more forgiving than the real thing, so tests pass and production fails.
- Square-extends-Rectangle style hierarchies where mutation breaks the parent's invariant.

## Trade-offs
- Honouring a contract strictly can make an implementation harder; the alternative is every caller paying with special cases.

## Tensions
- Rarely in conflict; it is the precondition for [[open-closed]] and [[dependency-inversion]] to work at all.

## Example
```ts
interface Store { put(k: string, v: string): void; get(k: string): string | undefined }
// Violates the contract: get() after put() must return the value.
class CacheOnly implements Store { put() {} get() { return undefined } }
```

## Cite as
`liskov-substitution`: name the contract every implementation (including fakes) now honours.

## Sources
- Liskov & Wing 1994, *A Behavioral Notion of Subtyping*.
- Martin 2000 (LSP in SOLID); Meyer 1997 (contracts and inheritance).
