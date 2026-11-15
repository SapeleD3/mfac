---
id: single-source-of-truth
name: Single source of truth
group: data
rule: Each piece of state has exactly one authoritative owner and store; everything else is a derived, rebuildable view of it.
sources: [moseley-marks-2006, kleppmann-2017, kreps-2013]
related: [dry, essential-vs-accidental-complexity, crash-only-software, immutability]
tensions: []
pstack: [principle-separate-before-serializing-shared-state]
---
# Single source of truth

**Rule.** Decide, for each fact, where the truth lives (a table, a file, an event log, a git ref) and who may write it. Caches, UI state, indexes and copies are derived and can be thrown away and rebuilt. When two stores disagree, the authoritative one wins by definition.

## Apply when
- State is mirrored in several places: database, in-memory objects, the UI, an external tool (Notion, Jira).
- Syncing with external systems: decide per field which side owns it.
- Designing caches: write down how to rebuild them.

## Watch for
- "Two-way sync" without an owner per field. It produces conflicts nobody can resolve.
- Derived state that is written by hand instead of recomputed.

## Trade-offs
- Readers sometimes pay to derive; consistency bugs become rare and recovery is "rebuild the view".

## Tensions
- None strong. It is [[dry]] for runtime state.

## Example
The engine's SQLite database owns task state. The Notion board is a projection: the engine writes it; a person's verdict comes back as an event the engine applies, not as an edit the engine reads back as truth.

## Cite as
`single-source-of-truth`: name the fact, its owner, and the derived views.

## Sources
- Moseley & Marks 2006 (essential vs derived state).
- Kleppmann 2017, *Designing Data-Intensive Applications*, ch. 11 and 12 (systems of record vs derived data).
- Kreps 2013, *The Log*.
