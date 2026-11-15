---
id: law-of-demeter
name: Law of Demeter
group: collaboration
rule: A unit should talk only to its immediate collaborators (its arguments, its own fields, objects it creates), not reach through them to strangers.
sources: [lieberherr-holland-1989]
related: [tell-dont-ask, information-hiding, cohesion-and-coupling]
tensions: [deep-modules]
pstack: [principle-minimize-reader-load]
---
# Law of Demeter

**Rule.** "Only talk to your friends." A method may call methods on itself, its parameters, objects it creates, and its direct fields. Chains like `order.customer.address.city.name` couple the caller to the whole object graph.

## Apply when
- Long property chains appear in business logic.
- A change to an inner structure (renaming `address`) breaks callers far away.

## Watch for
- Fluent builders and plain data records: chaining over *data* you own (`config.server.port`) or a fluent API designed for chaining is not the problem the law targets.
- Mechanical compliance: adding `getCustomerCityName()` wrappers everywhere bloats interfaces. Ask whether the caller should be asking at all ([[tell-dont-ask]]).

## Trade-offs
- Fewer structural dependencies; possibly more delegating methods. Prefer moving the behaviour to where the data is over adding forwarders.

## Tensions
- [[deep-modules]]: many tiny forwarding methods make interfaces wider and shallower. Move behaviour instead.

## Example
```ts
// Reaches through three objects.
if (task.stage.session.process.pid) kill(task.stage.session.process.pid);
// Asks the immediate collaborator.
runner.stop(task.id);
```

## Cite as
`law-of-demeter`: name the chain you removed and which collaborator now owns the behaviour.

## Sources
- Lieberherr & Holland 1989, *Assuring Good Style for Object-Oriented Programs* (IEEE Software); Northeastern Demeter project's "general formulation".
