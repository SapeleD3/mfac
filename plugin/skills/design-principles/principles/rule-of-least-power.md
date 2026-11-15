---
id: rule-of-least-power
name: Rule of least power
group: simplicity
rule: Choose the least powerful language, format or mechanism that does the job, because less powerful things are easier to analyse, reuse and secure.
sources: [w3c-least-power-2006]
related: [kiss, least-privilege, data-dominates]
tensions: []
pstack: [principle-encode-lessons-in-structure]
---
# Rule of least power

**Rule.** Berners-Lee and Mendelsohn: declarative data (JSON, a table, a regex, a state table) can be inspected, validated and transformed by other tools; a Turing-complete script cannot. Use the weakest thing that works.

## Apply when
- Configuration: prefer a data file with a schema over a config written in code.
- Rules: a lookup table or state table over nested conditionals; an allowlist over custom permission code.
- Agent instructions: structured output files with fixed headings over free prose the next stage must interpret.

## Watch for
- Data formats that slowly gain conditionals, loops and templating. At that point either accept a real language or simplify the need.

## Trade-offs
- Less power means some needs cannot be expressed; in return you get static checks, diffs that mean something, and safety.

## Tensions
- None strong; it is [[kiss]] applied to languages and formats.

## Example
Per-station tool permissions as a JSON allowlist the engine checks, rather than a JavaScript hook that decides at runtime.

## Cite as
`rule-of-least-power`: name the weaker mechanism you chose and what it lets you check.

## Sources
- W3C TAG 2006, *The Rule of Least Power*.
