---
id: wrong-abstraction
name: Prefer duplication over the wrong abstraction
group: simplicity
rule: Wait until duplication shows a stable shared concept (often the third occurrence) before abstracting, and inline an abstraction that callers keep bending with flags.
sources: [metz-2016, hunt-thomas-1999]
related: [dry, yagni, simple-not-easy]
tensions: [dry]
pstack: [principle-subtract-before-you-add, principle-redesign-from-first-principles]
---
# Prefer duplication over the wrong abstraction

**Rule.** Metz: "duplication is far cheaper than the wrong abstraction." When a shared function grows parameters and conditionals so each caller can get its own behaviour, it encodes several concepts as one. Inline it back into the callers, then look again.

## Apply when
- A helper has boolean flags or mode parameters that only one caller uses.
- You are about to extract a helper from two look-alike blocks that change for different reasons.
- The "rule of three": abstract on the third real occurrence, when the common shape is clear.

## Watch for
- Using this to excuse copy-pasted *knowledge* (a rule, a constant, a schema). That is still a [[dry]] violation.

## Trade-offs
- Temporary duplication costs some consistency work; the wrong abstraction costs every future change.

## Tensions
- [[dry]]: DRY is about one fact in one place; this principle is about not inventing a shared fact that does not exist.

## Example
```ts
// Bent abstraction: each flag serves one caller.
render(task, { compact: true, forSlack: false, hideRound: true });
// Inline it: two small, honest functions.
renderCard(task); renderSlackLine(task);
```

## Cite as
`wrong-abstraction`: name the abstraction you declined or inlined, and why the cases differ.

## Sources
- Metz 2016, *The Wrong Abstraction*.
- Hunt & Thomas 1999 (DRY, for the contrast).
