---
id: essential-vs-accidental-complexity
name: Essential vs accidental complexity
group: simplicity
rule: Separate the complexity the problem demands from the complexity our tools and choices add, and attack the accidental kind, mostly mutable state and control flow.
sources: [brooks-1986, moseley-marks-2006]
related: [simple-not-easy, functional-core-imperative-shell, single-source-of-truth, data-dominates]
tensions: []
pstack: [principle-redesign-from-first-principles, principle-foundational-thinking]
---
# Essential vs accidental complexity

**Rule.** Brooks: some complexity is essential to the problem and cannot be removed; the rest is accidental. Moseley and Marks: most accidental complexity in practice comes from *state* (especially derived and mutable state) and *control* (needless ordering). Keep essential state minimal, derive the rest, and declare logic rather than sequencing it.

## Apply when
- A design stores values that could be computed from others (caches, counters, denormalised flags).
- Code is hard to follow because of the order things happen, not because of the rules themselves.
- Estimating: essential complexity does not shrink with better tools, so do not promise it will.

## Watch for
- Calling necessary performance caches "accidental". Some derived state is worth it; name it, and keep one source of truth that can rebuild it.

## Trade-offs
- Deriving instead of storing can cost CPU; it removes a whole class of "out of sync" bugs.

## Tensions
- None directly; it is the lens behind [[kiss]], [[simple-not-easy]] and [[single-source-of-truth]].

## Example
Store events and the current state machine; compute "rounds left" as `CAP - round` rather than storing a second counter that can drift.

## Cite as
`essential-vs-accidental-complexity`: name the accidental state or control you removed.

## Sources
- Brooks 1986, *No Silver Bullet*.
- Moseley & Marks 2006, *Out of the Tar Pit*.
