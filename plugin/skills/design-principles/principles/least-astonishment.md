---
id: least-astonishment
name: Principle of least astonishment
group: simplicity
rule: A component should behave the way most of its users expect; follow the conventions of the platform, the language and the surrounding code.
sources: [raymond-2003]
related: [command-query-separation, kiss, hyrums-law]
tensions: []
pstack: [principle-experience-first]
---
# Principle of least astonishment

**Rule.** Raymond's Rule of Least Surprise: "in interface design, always do the least surprising thing." Applies to UIs, CLIs, APIs and code: names that say what happens, defaults that are safe, conventions that match neighbours.

## Apply when
- Naming functions, flags and commands (`--dry-run` should not write; `get` should not mutate).
- Choosing defaults: destructive actions off by default, exit codes non-zero on failure.
- Adding to an existing codebase: match its patterns, even if you would choose differently fresh.

## Watch for
- Surprise is relative to the audience. Follow the users' conventions (macOS users, TypeScript developers), not yours.

## Trade-offs
- Conformity can block a better idea; deviate only when the gain is clear, and make the deviation obvious.

## Tensions
- None strong.

## Example
A CLI `factory stop` that also deletes worktrees would astonish. Make `stop` stop, and add `factory clean` for deletion.

## Cite as
`least-astonishment`: name the convention you followed.

## Sources
- Raymond 2003, *The Art of Unix Programming*, ch. 1 (Rule of Least Surprise) and ch. 11.
