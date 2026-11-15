---
id: conways-law
name: Conway's law
group: modularity
rule: A system's structure mirrors the communication structure of the people (or agents) that build it, so design the module boundaries and the team or agent boundaries together.
sources: [conway-1968, winters-swe-at-google-2020]
related: [domain-driven-design, cohesion-and-coupling]
tensions: []
pstack: [principle-guard-the-context-window]
---
# Conway's law

**Rule.** "Organizations which design systems are constrained to produce designs which are copies of the communication structures of these organizations." If two groups rarely talk, the interface between their parts will be thin and awkward; if one group owns everything, boundaries blur.

## Apply when
- Splitting work across agents, stations or teams: give each one a module it owns, with an interface you can write down.
- An interface keeps breaking at a handoff between two owners. Either change the boundary or change who owns it ("inverse Conway manoeuvre").
- Choosing service boundaries: a service per team is natural; a service per function owned by one person is overhead.

## Watch for
- Microservices for a one-person or one-agent project. The communication structure is one node; one deployable is the honest mirror.
- Shared modules with no owner; they decay.

## Trade-offs
- Aligning code to people makes ownership clear but makes reorganisation expensive. Keep boundaries where communication is truly expensive.

## Tensions
- None strong; it is descriptive. It mostly constrains [[domain-driven-design]] bounded contexts, which should match who owns the language.

## Example
In a factory pipeline, each station (research, plan, build, review) writes one output file in the job folder. That file is the interface between two "teams" of agents, so its format must be explicit and stable.

## Cite as
`conways-law`: name the owner boundary and the interface you made explicit at it.

## Sources
- Conway 1968, *How Do Committees Invent?*
- *Software Engineering at Google* (2020), on team structure and code ownership.
