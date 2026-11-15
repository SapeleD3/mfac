---
id: composition-over-inheritance
name: Composition over inheritance
group: collaboration
rule: Build behaviour by combining small parts (functions, objects, interfaces) rather than by extending class hierarchies.
sources: [gof-1994]
related: [liskov-substitution, open-closed, dependency-inversion]
tensions: [kiss]
pstack: []
---
# Composition over inheritance

**Rule.** The Gang of Four: "favor object composition over class inheritance." Inheritance couples a subclass to its parent's implementation (the fragile base class problem); composition couples only to an interface.

## Apply when
- You want to reuse part of a class's behaviour, not be a substitutable subtype of it.
- A hierarchy is growing a second axis of variation (`SlackUrgentTask`, `JiraUrgentTask`, ...).
- In TypeScript generally: functions plus discriminated unions usually beat class trees.

## Watch for
- True is-a relationships with a stable parent contract (framework base classes, error types): inheritance is fine there.

## Trade-offs
- A bit more wiring; each part can be tested and swapped alone, and combinations do not explode.

## Tensions
- [[kiss]]: a single subclass of a framework class is simpler than reinventing it by delegation.

## Example
```ts
// Two axes in one hierarchy.
class UrgentSlackTask extends SlackTask {}
// Compose the axes.
type Task = { source: Source; priority: Priority };
```

## Cite as
`composition-over-inheritance`: name the parts now composed instead of inherited.

## Sources
- Gamma, Helm, Johnson & Vlissides 1994, *Design Patterns*, ch. 1.
