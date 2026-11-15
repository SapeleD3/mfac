---
id: domain-driven-design
name: Domain-driven design (strategic and tactical)
group: architecture
rule: Model the software on the domain experts' language within explicit bounded contexts, and keep each model consistent inside its boundary.
sources: [evans-ddd-reference-2015, evans-2003]
related: [conways-law, information-hiding, data-dominates, statecharts]
tensions: [kiss, yagni]
pstack: [principle-model-the-domain]
---
# Domain-driven design

**Rule.** Evans. *Strategic*: find bounded contexts, each with its own ubiquitous language, and map how they relate (shared kernel, customer/supplier, anticorruption layer). *Tactical*: entities (identity), value objects (immutable values), aggregates (consistency boundaries with one root), domain events, repositories.

Complements pstack's `principle-model-the-domain` (encode the domain in a structure); this note adds the boundaries and the vocabulary for them.

## Apply when
- The same word means different things in different parts of the system ("task" in Jira vs the factory's task vs a Claude Code task). Draw a context boundary and translate at it.
- Integrating an external system whose model you do not control: put an anticorruption layer in the adapter.
- Deciding transactional boundaries: one aggregate per transaction.

## Watch for
- Tactical-pattern ceremony (repositories, factories, services) in a CRUD app with no real rules.
- One "enterprise model" shared by every context. It ends up wrong for all of them.

## Trade-offs
- Up-front modelling and translation code; the code reads like the business and changes along the business's seams.

## Tensions
- [[kiss]]/[[yagni]]: use the strategic part (language, boundaries) almost always; the tactical patterns only where invariants are rich.

## Example
Slack messages and Jira tickets enter through adapters that translate them into one `Item` type (anticorruption layer). Inside the engine only the factory's language is used: item, task, stage, gate, round.

## Cite as
`domain-driven-design`: name the bounded context, aggregate or anticorruption layer and the language it protects.

## Sources
- Evans 2015, *Domain-Driven Design Reference* (CC BY 4.0, free PDF).
- Evans 2003, *Domain-Driven Design*.
