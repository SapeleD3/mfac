---
id: information-hiding
name: Information hiding
group: modularity
rule: Draw module boundaries around design decisions that are likely to change, and hide each decision behind an interface that would survive the change.
sources: [parnas-1972, ousterhout-2018]
related: [deep-modules, separation-of-concerns, cohesion-and-coupling, hexagonal-architecture]
tensions: [dry, yagni]
pstack: [principle-foundational-thinking, principle-minimize-reader-load]
---
# Information hiding

**Rule.** Decompose by *secrets*, not by steps. Each module owns one decision that could change (a file format, a storage engine, an algorithm, an external API) and nothing outside it can tell which choice was made.

## Apply when
- Splitting a feature into modules or files. List the decisions that might change first, then give each one a home.
- A change to one detail (a column name, a provider, a wire format) forces edits in many files. That is a leaked secret.
- Wrapping a third-party API or an OS facility (tmux, Notion, Slack, SQLite).

## Watch for
- Decomposing by the order things happen ("parse, then validate, then save" as three modules). Parnas showed this flowchart split leaks the data format into every step.
- Hiding things that will never change. A wrapper that hides nothing is a shallow module (see [[deep-modules]]).
- Getters and setters that expose every field: the representation is still public.

## Trade-offs
- Costs an interface and a little indirection up front; pays back every time the hidden decision changes.
- You must guess what will change. Guess from evidence (vendor churn, open questions in the spec), not imagination; otherwise [[yagni]] wins.

## Tensions
- [[dry]]: two modules may hold similar code because they hide *different* decisions. Merging them couples two secrets.
- [[yagni]]: hiding a decision costs little only when the boundary already exists; do not invent boundaries for imagined change.

## Example
```ts
// Leaks the secret: every caller knows tasks live in SQLite and how the row is shaped.
db.prepare("SELECT state, round FROM tasks WHERE id = ?").get(id);

// Hides it: callers ask a question; the storage decision lives in one file.
interface TaskStore { get(id: TaskId): Task | undefined; save(task: Task): void }
```

## Cite as
`information-hiding`: name the decision you hid and the module that owns it, e.g. "information-hiding: the tmux command line is private to tmux.ts".

## Sources
- Parnas 1972, *On the Criteria To Be Used in Decomposing Systems into Modules* (the KWIC example: modularisation 2 hides each design decision).
- Ousterhout 2018, *A Philosophy of Software Design*, ch. 5 "Information Hiding (and Leakage)".
