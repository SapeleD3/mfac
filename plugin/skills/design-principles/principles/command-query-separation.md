---
id: command-query-separation
name: Command-query separation
group: collaboration
rule: A function either changes state (a command) or returns an answer (a query), not both.
sources: [meyer-1997]
related: [functional-core-imperative-shell, least-astonishment, immutability]
tensions: [kiss]
pstack: [principle-make-operations-idempotent]
---
# Command-query separation

**Rule.** Meyer: asking a question should not change the answer. Queries are safe to call any number of times, in any order, from logs or debuggers; commands are the only places state moves.

## Apply when
- A "getter" lazily creates, caches with side effects, or advances an iterator.
- Designing an API where callers might call a read twice (retries, React renders, polling).

## Watch for
- Pragmatic exceptions that are well known and named: `stack.pop()`, `queue.take()`, `INSERT ... RETURNING id`, atomic `compareAndSet`. Atomicity sometimes needs command and result together; name these clearly.

## Trade-offs
- Can cost an extra call (command, then query); buys predictability and safe retries.

## Tensions
- [[kiss]]: combined "upsert and return" is fine when it is atomic and named for what it does.

## Example
```ts
// Query with a hidden write: calling it in a log line changes behaviour.
function nextTask() { const t = queue[0]; queue.shift(); return t; }
// Split, or name the command honestly.
function peekTask() { return queue[0]; }
function takeTask() { return queue.shift(); }
```

## Cite as
`command-query-separation`: name the query you made side-effect free.

## Sources
- Meyer 1997, *Object-Oriented Software Construction*, 2nd ed. (CQS, and design by contract).
