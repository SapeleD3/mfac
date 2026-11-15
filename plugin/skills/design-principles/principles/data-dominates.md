---
id: data-dominates
name: Data dominates (choose the data structures first)
group: data
rule: Choose the data structures and their invariants first; with the right representation, the algorithms and code become obvious.
sources: [pike-1989, brooks-1975, morin-ods, erickson-algorithms]
related: [statecharts, essential-vs-accidental-complexity, domain-driven-design, single-source-of-truth]
tensions: []
pstack: [principle-foundational-thinking, principle-model-the-domain]
---
# Data dominates

**Rule.** Pike's rule 5: "Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident." Brooks: "Show me your tables, and I won't usually need your flowcharts." Also Pike's rules 1 to 4: do not guess at bottlenecks, measure, and prefer simple algorithms because n is usually small.

Complements pstack's `principle-foundational-thinking`; the practical lookup table is [data-structures.md](../data-structures.md).

## Apply when
- Starting any feature: write the types and the storage shape before the functions.
- Code is full of searches, re-sorting, or index bookkeeping: the structure does not match the access pattern.
- Choosing between a list, a map, a set, a queue, a heap, a tree, a log or a table. See the guide.

## Watch for
- Fancy structures for small n. A sorted array beats a balanced tree below a few thousand items, and is simpler.
- Optimising a structure before measuring (Pike's rules 1 and 2).

## Trade-offs
- Time spent on representation early; much less code later.

## Tensions
- None; it is upstream of most others.

## Example
Pending prompts are looked up by id and listed by creation time: a SQLite table with a primary key and an index on `(status, created_at)`, not an in-memory array scanned on every call.

## Cite as
`data-dominates`: name the structure chosen and the access pattern it serves.

## Sources
- Pike 1989, *Notes on Programming in C* (rules 1 to 5).
- Brooks 1975, *The Mythical Man-Month*, ch. 9.
- Morin, *Open Data Structures* (CC BY); Erickson, *Algorithms* (CC BY).
