---
id: kiss
name: Keep it simple (KISS)
group: simplicity
rule: Choose the simplest design that meets today's real requirements; complexity must earn its place with a concrete need.
sources: [lampson-1983, raymond-2003, hickey-2011]
related: [yagni, simple-not-easy, galls-law, essential-vs-accidental-complexity, rule-of-least-power]
tensions: [open-closed, dependency-inversion, separation-of-concerns]
pstack: [principle-laziness-protocol, principle-subtract-before-you-add]
---
# Keep it simple (KISS)

**Rule.** Lampson: "Do one thing at a time, and do it well." "Make it fast, rather than general or powerful." Prefer a plain function to a framework, a file to a database, a loop to a pipeline of abstractions, until a real need says otherwise.

## Apply when
- Two designs both work; take the one with fewer moving parts, concepts and states.
- Reviewing a plan with layers, queues, caches or services that no requirement asks for.

## Watch for
- "Simple" meaning "familiar" or "quick to type". Simplicity is about how few things are intertwined, not effort ([[simple-not-easy]]).
- Simplistic designs that push complexity to every caller ([[deep-modules]]).

## Trade-offs
- Simple designs may need rework when requirements grow; that rework is usually cheaper than carrying unused complexity meanwhile.

## Tensions
- [[open-closed]], [[dependency-inversion]], [[separation-of-concerns]]: all add structure. Add it when change is proven or side effects need isolating, not by default.

## Example
A factory with one user and one machine stores state in one SQLite file and talks over one Unix socket. No message broker, no service mesh.

## Cite as
`kiss`: name what you left out and why it was not needed.

## Sources
- Lampson 1983, *Hints for Computer System Design* ("Keep it simple", "Do one thing well").
- Raymond 2003, *The Art of Unix Programming* (Rule of Simplicity).
- Hickey 2011, *Simple Made Easy*.
