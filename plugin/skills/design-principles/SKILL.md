---
name: design-principles
description: The factory's design-principles knowledge base. Use when making or reviewing a design decision (module boundaries, abstractions, architecture, data structures, error handling, state, permissions) and when writing the "Design principles applied" section of a stage's output. Maps decisions to 41 sourced principles and complements pstack's principle-* skills.
---

# Design principles

A guide for decisions, not a rulebook. Every station in the factory uses it the same way:

1. **Find the decision.** Before writing code or a plan, list the design decisions the task forces (where a boundary goes, what the data looks like, how errors surface, who may do what).
2. **Look it up.** Open [decision-guide.md](decision-guide.md), find each decision, and read the one to three principle files it points to. For data-structure choices, use [data-structures.md](data-structures.md).
3. **Weigh tensions.** Each principle file lists the principles it pulls against. When two apply and disagree, say which one you chose and why. Do not pretend there was no trade-off.
4. **Cite.** End your output with a "Design principles applied" section. One line per principle: the id, then where it shows. Example: `information-hiding: the tmux command line is private to src/tmux.ts`. Only cite principles you actually used; three honest lines beat ten decorative ones.

The repository's own conventions (CLAUDE.md, lint, existing patterns) win over this guide on how to write code. This guide is for choosing between designs.

## How this fits with pstack

pstack ships 24 `principle-*` skills about *how to work* (laziness, prove it works, fix root causes, guard the context window). This knowledge base is about *what shape the software takes*, and it cites the classic sources. Where the two overlap, the principle file links the pstack skill under `pstack:` instead of repeating it. Use the pstack skill directly for:

| topic | use pstack's |
|---|---|
| illegal states unrepresentable, parse at the boundary, branded types | `principle-type-system-discipline` |
| idempotent operations and retries | `principle-make-operations-idempotent` |
| guards only at system boundaries | `principle-boundary-discipline` |
| encoding the domain in a structure | `principle-model-the-domain` (with [`domain-driven-design`](principles/domain-driven-design.md) for boundaries) |
| choosing core types first | `principle-foundational-thinking` (with [`data-dominates`](principles/data-dominates.md) and the data-structures guide) |
| deleting before adding, smallest change | `principle-laziness-protocol`, `principle-subtract-before-you-add` |
| verification, root causes, tests | `principle-prove-it-works`, `principle-fix-root-causes`, `principle-test-behavior-not-implementation` |
| shared mutable state | `principle-separate-before-serializing-shared-state` |
| compatibility layers during migrations | `principle-migrate-callers-then-delete-legacy-apis` |

## Index

Each file has the same sections: rule, apply when, watch for, trade-offs, tensions, example, how to cite, sources.

### Modularity

| principle | rule |
|---|---|
| [`cohesion-and-coupling`](principles/cohesion-and-coupling.md) | Put things that change together in the same module, and make the connections between modules few, narrow and explicit. |
| [`conways-law`](principles/conways-law.md) | A system's structure mirrors the communication structure of the people (or agents) that build it, so design the module boundaries and the team or agent boundaries together. |
| [`deep-modules`](principles/deep-modules.md) | A module's interface should be much simpler than its implementation; prefer few, powerful operations over many thin ones. |
| [`information-hiding`](principles/information-hiding.md) | Draw module boundaries around design decisions that are likely to change, and hide each decision behind an interface that would survive the change. |
| [`separation-of-concerns`](principles/separation-of-concerns.md) | Study and build one aspect of a problem at a time, so each part of the code answers to one kind of question. |

### SOLID

| principle | rule |
|---|---|
| [`dependency-inversion`](principles/dependency-inversion.md) | High-level policy should not depend on low-level detail; both depend on an abstraction that the policy side owns. |
| [`interface-segregation`](principles/interface-segregation.md) | Clients should not depend on operations they do not use; give each kind of client the narrow interface it needs. |
| [`liskov-substitution`](principles/liskov-substitution.md) | Anything that claims to implement an interface or subtype must honour its full contract, so callers never need to check which implementation they got. |
| [`open-closed`](principles/open-closed.md) | Make the parts that vary pluggable so new behaviour is added by adding code, not by editing stable code, but only along axes of change you have actually seen. |
| [`single-responsibility`](principles/single-responsibility.md) | A module should have one reason to change, meaning it answers to one actor or one source of requirements. |

### Object collaboration

| principle | rule |
|---|---|
| [`command-query-separation`](principles/command-query-separation.md) | A function either changes state (a command) or returns an answer (a query), not both. |
| [`composition-over-inheritance`](principles/composition-over-inheritance.md) | Build behaviour by combining small parts (functions, objects, interfaces) rather than by extending class hierarchies. |
| [`design-by-contract`](principles/design-by-contract.md) | State each operation's preconditions, postconditions and invariants explicitly, and check them where violations are cheapest to catch. |
| [`law-of-demeter`](principles/law-of-demeter.md) | A unit should talk only to its immediate collaborators (its arguments, its own fields, objects it creates), not reach through them to strangers. |
| [`tell-dont-ask`](principles/tell-dont-ask.md) | Put behaviour next to the data it uses; tell an object what to do instead of pulling its state out and deciding for it. |

### Simplicity

| principle | rule |
|---|---|
| [`chestertons-fence`](principles/chestertons-fence.md) | Before removing or changing something whose purpose you do not know, find out why it is there. |
| [`dry`](principles/dry.md) | Every piece of knowledge should have a single, authoritative representation in the system; duplication of knowledge, not of text, is the problem. |
| [`essential-vs-accidental-complexity`](principles/essential-vs-accidental-complexity.md) | Separate the complexity the problem demands from the complexity our tools and choices add, and attack the accidental kind, mostly mutable state and control flow. |
| [`galls-law`](principles/galls-law.md) | A complex system that works evolved from a simple system that worked; start with the smallest end-to-end thing that runs and grow it. |
| [`kiss`](principles/kiss.md) | Choose the simplest design that meets today's real requirements; complexity must earn its place with a concrete need. |
| [`least-astonishment`](principles/least-astonishment.md) | A component should behave the way most of its users expect; follow the conventions of the platform, the language and the surrounding code. |
| [`rule-of-least-power`](principles/rule-of-least-power.md) | Choose the least powerful language, format or mechanism that does the job, because less powerful things are easier to analyse, reuse and secure. |
| [`simple-not-easy`](principles/simple-not-easy.md) | Prefer designs where concerns are not intertwined (simple) over designs that are merely familiar or quick to start (easy). |
| [`unix-philosophy`](principles/unix-philosophy.md) | Write programs that do one thing well, work together through simple, text-based interfaces, and can be composed by others. |
| [`wrong-abstraction`](principles/wrong-abstraction.md) | Wait until duplication shows a stable shared concept (often the third occurrence) before abstracting, and inline an abstraction that callers keep bending with flags. |
| [`yagni`](principles/yagni.md) | Do not build capability for a presumed future need; build it when the need is real, and keep the code easy to change so that is cheap. |

### Architecture

| principle | rule |
|---|---|
| [`clean-architecture`](principles/clean-architecture.md) | Source-code dependencies point only inward, from frameworks and I/O toward use cases and then entities; inner circles know nothing about outer ones. |
| [`domain-driven-design`](principles/domain-driven-design.md) | Model the software on the domain experts' language within explicit bounded contexts, and keep each model consistent inside its boundary. |
| [`end-to-end-argument`](principles/end-to-end-argument.md) | Put a function (reliability, security, deduplication, verification) at the endpoints that can actually guarantee it; lower layers may only add it as a performance optimisation. |
| [`functional-core-imperative-shell`](principles/functional-core-imperative-shell.md) | Put decisions in pure functions over plain values, and keep I/O, time, randomness and mutation in a thin outer shell that calls them. |
| [`hexagonal-architecture`](principles/hexagonal-architecture.md) | Keep the application core independent of every outside actor (UI, CLI, database, vendor APIs, tests) by talking to them only through ports the core defines, with adapters at the edge. |
| [`statecharts`](principles/statecharts.md) | When behaviour depends on history, model it as an explicit state machine (or a statechart, with hierarchy and parallel regions), and make that model the single place transitions are decided. |
| [`twelve-factor-app`](principles/twelve-factor-app.md) | Build services that keep config in the environment, treat backing services as attached resources, run as stateless disposable processes, and keep dev and prod alike. |

### Data and state

| principle | rule |
|---|---|
| [`data-dominates`](principles/data-dominates.md) | Choose the data structures and their invariants first; with the right representation, the algorithms and code become obvious. |
| [`immutability`](principles/immutability.md) | Represent values as immutable and produce new values instead of mutating shared ones; confine mutation to one owner. |
| [`single-source-of-truth`](principles/single-source-of-truth.md) | Each piece of state has exactly one authoritative owner and store; everything else is a derived, rebuildable view of it. |

### Reliability and evolution

| principle | rule |
|---|---|
| [`crash-only-software`](principles/crash-only-software.md) | Design components so that crashing and restarting is the only way to stop them and always safe, with all durable state in stores built for it. |
| [`fail-fast`](principles/fail-fast.md) | Detect invalid states and inputs as early as possible and stop loudly with a precise message, instead of continuing with bad data. |
| [`hyrums-law`](principles/hyrums-law.md) | With enough users, every observable behaviour of an interface will be depended on by somebody, so design what is observable on purpose. |
| [`least-privilege`](principles/least-privilege.md) | Give every program, process, agent and user only the access its task needs, for only as long as it needs it, with fail-safe defaults. |
| [`robustness-principle`](principles/robustness-principle.md) | Be conservative in what you send; be liberal in what you accept only where interoperability truly requires it, and never silently. |

## Sources

Every citation resolves to an entry in [sources.json](sources.json): title, authors, year, a link, and whether it is a free PDF, open-licence, free to read online, or cite-only (a paid book we summarise in our own words). The notes are original summaries; no copyrighted text is reproduced beyond short attributed quotations.

The free PDFs are downloaded to `~/.factory/cache/design-principles/` on your machine (never into git) by `npm run principles:fetch`, which calls `fetchDesignPrincipleSources()` in `src/design-principles.ts`. Read them there when a note is not enough.
