---
id: robustness-principle
name: Robustness principle, and its limits
group: reliability
rule: Be conservative in what you send; be liberal in what you accept only where interoperability truly requires it, and never silently.
sources: [postel-rfc-761, rfc-9413, king-2019]
related: [fail-fast, design-by-contract, hyrums-law]
tensions: [fail-fast, design-by-contract]
pstack: [principle-boundary-discipline]
---
# Robustness principle, and its limits

**Rule.** Postel (RFC 761): "be conservative in what you do, be liberal in what you accept from others." RFC 9413 (2023) records the long-term cost: tolerance of bad input becomes a de facto protocol, implementations ossify, and bugs hide. Modern reading: send strictly; accept tolerantly only at external boundaries you do not control; log or reject what is malformed; never tolerate inside your own system.

## Apply when
- Parsing input from third parties (webhooks, Slack, Jira, model output): parse into a strict internal type at the boundary, accept harmless variation (extra fields, case, whitespace), reject the rest with a clear error.
- Emitting data: always emit the canonical, strict form.

## Watch for
- Tolerance between your own components. That hides bugs; use [[fail-fast]] and [[design-by-contract]] instead.
- Tolerating something once. Callers will depend on it ([[hyrums-law]]).

## Trade-offs
- Tolerance improves interop today and erodes the protocol over time. Strictness breaks bad senders early.

## Tensions
- [[fail-fast]], [[design-by-contract]]: strict inside, carefully tolerant at the outer edge.

## Example
An agent's output file must start with a known heading. Accept leading whitespace and a BOM; reject a missing heading with a message the coordinator can act on, instead of guessing.

## Cite as
`robustness-principle`: name what you tolerate, where, and what you reject.

## Sources
- Postel 1980, RFC 761, section 2.10.
- Thomson & Schinazi 2023, RFC 9413, *Maintaining Robust Protocols*.
- King 2019, *Parse, don't validate* (turn tolerant input into a strict type once, at the edge).
