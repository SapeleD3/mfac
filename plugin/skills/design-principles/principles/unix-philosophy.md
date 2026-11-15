---
id: unix-philosophy
name: Unix philosophy
group: simplicity
rule: Write programs that do one thing well, work together through simple, text-based interfaces, and can be composed by others.
sources: [raymond-2003, pike-1989]
related: [kiss, deep-modules, rule-of-least-power, separation-of-concerns]
tensions: [deep-modules]
pstack: [principle-build-the-lever]
---
# Unix philosophy

**Rule.** McIlroy's summary: "Write programs that do one thing and do it well. Write programs to work together. Write programs to handle text streams, because that is a universal interface." Raymond expands this into 17 rules (modularity, clarity, composition, separation, silence, repair, ...).

## Apply when
- Building CLIs and scripts: read stdin or files, write stdout, exit non-zero on failure, keep output parseable (offer `--json`).
- Wiring stations or tools together: files and plain formats as the interface between steps.
- "If it can be a script, it is one."

## Watch for
- "One thing" read as "tiny". A good Unix tool (`grep`, `git`) hides a lot behind one purpose ([[deep-modules]]).
- Text streams where structure matters: use JSON lines, not ad hoc column parsing.

## Trade-offs
- Composable small tools are flexible; end-to-end error handling across a pipeline needs care ([[end-to-end-argument]]).

## Tensions
- [[deep-modules]]: compatible when "one thing" is a whole purpose.

## Example
`factory tasks --json | jq '.[] | select(.state=="review")'` beats a bespoke filter flag for every question.

## Cite as
`unix-philosophy`: name the composable interface you exposed.

## Sources
- Raymond 2003, *The Art of Unix Programming*, ch. 1.
- Pike 1989, *Notes on Programming in C* (Pike's rules on simplicity and data).
