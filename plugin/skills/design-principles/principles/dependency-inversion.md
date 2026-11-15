---
id: dependency-inversion
name: Dependency inversion (DIP)
group: solid
rule: High-level policy should not depend on low-level detail; both depend on an abstraction that the policy side owns.
sources: [martin-2000, martin-2012, cockburn-2005]
related: [hexagonal-architecture, clean-architecture, open-closed, interface-segregation]
tensions: [kiss, yagni]
pstack: [principle-boundary-discipline]
---
# Dependency inversion (DIP)

**Rule.** The module that makes decisions defines the interface it needs ("I need something that can `send(message)`"), and the detail (Slack client, SMTP, a test fake) implements it. Source-code dependencies point toward policy, even though control flows outward to the detail.

## Apply when
- Business logic imports a vendor SDK, an ORM, `fs`, or `child_process` directly, and you need to test it or swap the vendor.
- Defining ports in [[hexagonal-architecture]].
- The engine needs to run with fakes in tests (fake tmux, fake TLC) and real tools in production.

## Watch for
- Interfaces that mirror the vendor API one-to-one. The abstraction must be shaped by the policy's needs, or nothing is inverted.
- Dependency-injection frameworks for a small program. Passing a parameter is dependency injection.

## Trade-offs
- One interface and one wiring point per dependency. Testability and replaceability in return. Not worth it for stable, side-effect-free libraries (do not wrap `Math` or `path`).

## Tensions
- [[kiss]]/[[yagni]]: invert only dependencies that are volatile, slow, or side-effecting.

## Example
```ts
// Policy owns the port.
export interface Tlc { check(spec: string): Promise<{ ok: boolean; states: number }> }
export function makeRunner(deps: { tlc: Tlc; tmux: Tmux }) { /* uses deps.tlc.check */ }
// Wiring at the edge: real in production, fakes in tests.
makeRunner({ tlc: realTlc, tmux: realTmux });
```

## Cite as
`dependency-inversion`: name the port, who owns it, and the adapters behind it.

## Sources
- Martin 2000, *Design Principles and Design Patterns*; Martin 2012, *The Clean Architecture* (the dependency rule).
- Cockburn 2005, *Hexagonal Architecture* (ports).
