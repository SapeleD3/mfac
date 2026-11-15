---
id: hyrums-law
name: Hyrum's law
group: reliability
rule: With enough users, every observable behaviour of an interface will be depended on by somebody, so design what is observable on purpose.
sources: [wright-hyrum, winters-swe-at-google-2020]
related: [information-hiding, least-astonishment, robustness-principle]
tensions: []
pstack: [principle-migrate-callers-then-delete-legacy-apis]
---
# Hyrum's law

**Rule.** "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody." Ordering, timing, error text, file names, default values: all become contract.

## Apply when
- Designing outputs other programs or agents read: CLI output, JSON shapes, file names in the job folder, error messages.
- Changing "internal" behaviour that is observable (ordering of a list, a log line format).

## Watch for
- Accidental guarantees: return sorted results only if you promise sorting; otherwise consider randomising order in tests.
- Treating it as a reason never to change. Change deliberately, and migrate callers (pstack `principle-migrate-callers-then-delete-legacy-apis`).

## Trade-offs
- Narrowing what is observable takes thought; it keeps future changes cheap.

## Tensions
- None strong.

## Example
Stations parse each other's output files. Fix the headings and file names as a documented format, and treat any change as a versioned change.

## Cite as
`hyrums-law`: name the observable behaviour you made explicit, or the change you migrated callers for.

## Sources
- Wright, *Hyrum's Law* (hyrumslaw.com).
- *Software Engineering at Google* (2020), ch. 1.
