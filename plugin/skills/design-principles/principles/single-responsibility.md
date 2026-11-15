---
id: single-responsibility
name: Single responsibility (SRP)
group: solid
rule: A module should have one reason to change, meaning it answers to one actor or one source of requirements.
sources: [martin-2000, stevens-myers-constantine-1974]
related: [separation-of-concerns, cohesion-and-coupling, information-hiding]
tensions: [deep-modules, kiss]
pstack: []
---
# Single responsibility (SRP)

**Rule.** Martin's later wording is the useful one: "a module should be responsible to one, and only one, actor." Group code by who asks for changes to it. Billing rules and report formatting change for different people at different times, so they live apart.

## Apply when
- A class or file is edited for unrelated reasons in its git history (`git log -p` shows formatting fixes interleaved with business-rule changes).
- Two teams or two stations edit the same file and step on each other.

## Watch for
- Reading SRP as "do one tiny thing". That produces shallow modules and pass-through classes ([[deep-modules]]).
- Counting methods instead of reasons to change.

## Trade-offs
- Splitting by actor isolates change, at the cost of more modules. Split only when you can name the two actors.

## Tensions
- [[deep-modules]]: keep the responsibility broad enough that the module hides something real.
- [[kiss]]: for a small script, one actor (you) means one module is fine.

## Example
```ts
// Two actors: finance (pay rules) and ops (hours report) share one class, so a report tweak can break pay.
class Employee { calculatePay() {} reportHours() {} save() {} }
// One actor each; Employee stays a plain data shape.
const pay = (e: Employee) => {}; const hoursReport = (e: Employee) => {}; const employees: Repo<Employee> = {};
```

## Cite as
`single-responsibility`: name the actor the module now answers to.

## Sources
- Martin 2000, *Design Principles and Design Patterns* (SOLID's first statement; SRP formalised in *Agile Software Development*, 2002, and restated around actors in *Clean Architecture*, 2017).
- Stevens, Myers & Constantine 1974 (functional cohesion, SRP's ancestor).
