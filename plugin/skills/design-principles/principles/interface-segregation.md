---
id: interface-segregation
name: Interface segregation (ISP)
group: solid
rule: Clients should not depend on operations they do not use; give each kind of client the narrow interface it needs.
sources: [martin-2000]
related: [liskov-substitution, dependency-inversion, least-privilege, deep-modules]
tensions: [deep-modules]
pstack: []
---
# Interface segregation (ISP)

**Rule.** When different callers use disjoint slices of a big interface, give each its own slice. A reader should not need to depend on, mock, or recompile against write operations.

## Apply when
- Test fakes must stub ten methods to exercise one.
- A component takes a whole service object but calls one method on it. Pass the function, or a one-method interface.
- Capabilities should be limited: a read-only view handed to untrusted code ([[least-privilege]]).

## Watch for
- Splitting interfaces nobody uses separately. That fragments a deep module into shallow ones.

## Trade-offs
- More named types; much smaller blast radius and easier fakes. In TypeScript, `Pick<T, "a" | "b">` or a function parameter is often enough; no new type file needed.

## Tensions
- [[deep-modules]]: segregate per *client role*, not per method. The implementation behind them can stay one deep module.

## Example
```ts
// The notifier needs one thing; do not hand it the whole store.
function notifyLate(tasks: Pick<TaskStore, "listOverdue">, send: (msg: string) => Promise<void>) { /* ... */ }
```

## Cite as
`interface-segregation`: name the client and the narrower interface it now depends on.

## Sources
- Martin 2000, *Design Principles and Design Patterns*.
