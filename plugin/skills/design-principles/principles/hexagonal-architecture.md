---
id: hexagonal-architecture
name: Hexagonal architecture (ports and adapters)
group: architecture
rule: Keep the application core independent of every outside actor (UI, CLI, database, vendor APIs, tests) by talking to them only through ports the core defines, with adapters at the edge.
sources: [cockburn-2005, martin-2012]
related: [dependency-inversion, clean-architecture, functional-core-imperative-shell, information-hiding]
tensions: [kiss]
pstack: [principle-boundary-discipline]
---
# Hexagonal architecture (ports and adapters)

**Rule.** Cockburn: "Allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases." Driving ports (how the world calls the app) and driven ports (what the app needs from the world) are interfaces in the core's language; adapters translate.

## Apply when
- The same core must be driven by several fronts: a CLI, a socket API, a desktop app, tests.
- The core depends on volatile or slow outside systems: Slack, Jira, Notion, tmux, Claude Code, git.
- You need a fast test suite that runs without the network.

## Watch for
- A port per class. Ports are per *conversation* with the outside world (e.g. "issue tracker", "chat", "agent runtime"), usually a handful.
- Adapters that leak vendor types into the core (a Slack message object in a domain function).

## Trade-offs
- Interfaces and wiring up front; swap-ability and isolated tests in return. Overkill for a script with one input and one output.

## Tensions
- [[kiss]]: for small tools, a single function with injected I/O functions gives most of the benefit.

## Example
```
core:     engine (statechart, queue, gates)
driving:  CLI adapter, Unix-socket API adapter, Tauri app adapter, test harness
driven:   AgentRuntime port -> Claude Code via tmux adapter (fake in tests)
          Tracker port      -> Jira adapter, Notion adapter
          Chat port         -> Slack adapter
```

## Cite as
`hexagonal-architecture`: name the port and its adapters.

## Sources
- Cockburn 2005, *Hexagonal Architecture*.
- Martin 2012, *The Clean Architecture* (same idea, concentric form).
