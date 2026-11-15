---
id: simple-not-easy
name: Simple, not easy
group: simplicity
rule: Prefer designs where concerns are not intertwined (simple) over designs that are merely familiar or quick to start (easy).
sources: [hickey-2011, moseley-marks-2006]
related: [kiss, essential-vs-accidental-complexity, immutability, separation-of-concerns]
tensions: [kiss]
pstack: [principle-minimize-reader-load]
---
# Simple, not easy

**Rule.** Hickey: *simple* means one fold, not interleaved with other things; *easy* means near at hand. Complexity comes from "complecting": braiding together state and time, value and identity, what and how, policy and mechanism. Choose the tools and shapes that keep them apart, even if they are less familiar.

## Apply when
- Choosing between a mutable shared object and a value passed along; between an ORM's magic and plain queries; between implicit ordering and an explicit state machine.
- A design is "easy to start" but you can already list things that will be tangled.

## Watch for
- Novelty for its own sake. Unfamiliar can be complex too; measure by how many things are braided, not by fashion.

## Trade-offs
- Simple tools can take longer to learn; they keep the cost of change flat over time.

## Tensions
- [[kiss]] is often read as "easy". When they disagree, prefer the untangled design if the code will live long; prefer the easy one for throwaways.

## Example
State held in a mutable object read by several async callers complects value with time. An append-only event list plus a pure `step()` function separates them.

## Cite as
`simple-not-easy`: name the two things you un-braided.

## Sources
- Hickey 2011, *Simple Made Easy* (Strange Loop).
- Moseley & Marks 2006, *Out of the Tar Pit* (state and control as the main sources of complexity).
