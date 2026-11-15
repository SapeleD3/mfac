# Data-structure guide

Pick the structure from the access pattern, not from habit ([`data-dominates`](principles/data-dominates.md)). Write the pattern down first: what you look up by, what order you need, how often you write versus read, how big n gets, and whether it must survive a restart.

Two rules before the table, from Pike: **measure before optimising**, and **n is usually small**. Below a few thousand items, a plain array and a linear scan are often the fastest and always the simplest choice. Reach further down this table only when a measurement or a real size says so.

## In memory

| you need | use | in TypeScript | cost | watch for |
|---|---|---|---|---|
| an ordered list, mostly appended and iterated | dynamic array | `T[]` | O(1) amortised push, O(n) search | `shift()`/`unshift()` are O(n); use a queue for FIFO at scale |
| lookup by key | hash map | `Map<K, V>` (not a plain object for dynamic keys) | O(1) average | object keys are strings only; `Map` keeps insertion order |
| membership, de-duplication | hash set | `Set<T>` | O(1) average | objects compare by reference; key by a stable id |
| first in, first out (work queue) | queue / ring buffer | array with a head index, or a small deque class | O(1) | unbounded queues hide backpressure problems; cap them |
| last in, first out (undo, DFS) | stack | `T[]` with `push`/`pop` | O(1) | |
| always take the smallest or largest next (priority, scheduling, timers) | binary heap | a small heap class | O(log n) push/pop, O(1) peek | sorting the whole array per insert is O(n log n) |
| sorted order with inserts and range queries | sorted array (small n), balanced tree / skip list (large n) | sorted array + binary search; a B-tree library if large | O(log n) search; O(n) insert for arrays | for durable data, use a database index instead |
| "most recently used" cache with a size cap | LRU (hash map + recency order) | `Map` (re-insert on access, delete the oldest key) | O(1) | cache only what is expensive to recompute; know how to rebuild it ([`single-source-of-truth`](principles/single-source-of-truth.md)) |
| prefix search, autocomplete | trie (or sorted array + binary search) | | O(length of key) | memory-heavy; sorted array is often enough |
| "are these in the same group?" with merges | union-find (disjoint sets) | | near O(1) | |
| relationships, dependencies, reachability | graph (adjacency list) | `Map<Node, Node[]>` | O(V + E) traversal | detect cycles; topological sort for build/dependency order |
| hierarchy (files, nested states, comments) | tree | nodes with `children[]` and an id map for lookup | | keep a parent pointer or id map if you navigate upward |
| a value that is one of several shapes | discriminated union | `type A = { kind: "x"; ... } \| { kind: "y"; ... }` | | switch exhaustively; see pstack `principle-type-system-discipline` |
| a mode that changes over time with rules | state machine / statechart | closed union of states + transition table + pure `step()` | | [`statecharts`](principles/statecharts.md); one authority for transitions |
| a fixed set of options | union of string literals or `as const` object | `type Role = "builder" \| "reviewer"` | | prefer over `enum` for erasable TypeScript |
| approximate membership over huge sets | Bloom filter | library | O(k) | false positives by design; only when memory forces it |
| count or rank in a sliding window | ring buffer, or a bucketed counter | | O(1) | |

## Durable

| you need | use | why |
|---|---|---|
| state that must survive a crash, queried in several ways | an embedded relational DB (SQLite) with indexes on the access patterns | transactions give [`crash-only-software`](principles/crash-only-software.md); indexes replace hand-built maps |
| a history of what happened, replay, audit, sync to other views | append-only event log (a table with a monotonic id, or a JSON-lines file) | immutable facts; current state and projections are derived ([`immutability`](principles/immutability.md), Kreps, *The Log*) |
| work items picked up by workers | a jobs table with `status`, `claimed_at`, and a lease timeout | survives restarts; a lease frees work from a dead worker |
| large blobs (agent transcripts, artifacts) | files on disk, with their path and hash in the DB | the DB stays small; the files are content-addressable |
| configuration a person edits | a small data file (JSON/TOML) with a schema, validated on load | [`rule-of-least-power`](principles/rule-of-least-power.md), [`fail-fast`](principles/fail-fast.md) |
| secrets | the OS keychain (macOS Keychain) | never in the repo, a config file, or a log |
| relationships across a big dataset | relational tables with foreign keys; a graph DB only when traversals dominate | joins are well understood; graph stores are a specialised tool |

## Choosing well, in four questions

1. **What is the key?** If you look things up by id, you need a map or an index. If you never look up, a list is enough.
2. **What order?** Insertion order: array or `Map`. Sorted: sorted array, heap (only the top matters) or index. None: set.
3. **How big, and how hot?** Small or cold: simplest structure. Big and hot: measure, then pick the complexity that fits.
4. **Must it survive a restart?** Then it belongs in the durable table, and the in-memory one is a cache of it.

When you cite this guide, name the structure and the access pattern it serves, for example: `data-dominates: pending prompts are a SQLite table indexed by (status, created_at), because the UI lists by status in creation order`.

## Sources

- Morin, *Open Data Structures* (CC BY 2.5, free PDF).
- Erickson, *Algorithms* (CC BY 4.0, free PDF).
- Pike 1989, *Notes on Programming in C* (rules 1 to 5).
- Kleppmann 2017, *Designing Data-Intensive Applications* (storage and derived data).
- Kreps 2013, *The Log*.
- Harel 1987, *Statecharts*.
