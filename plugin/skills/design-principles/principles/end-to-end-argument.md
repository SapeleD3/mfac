---
id: end-to-end-argument
name: End-to-end argument
group: architecture
rule: Put a function (reliability, security, deduplication, verification) at the endpoints that can actually guarantee it; lower layers may only add it as a performance optimisation.
sources: [saltzer-reed-clark-1984, lampson-1983, sre-book-2016]
related: [fail-fast, crash-only-software]
tensions: [robustness-principle]
pstack: [principle-prove-it-works, principle-make-operations-idempotent]
---
# End-to-end argument

**Rule.** Saltzer, Reed and Clark: "The function in question can completely and correctly be implemented only with the knowledge and help of the application standing at the endpoints." Their example: a reliable network does not make file transfer reliable; only an end-to-end checksum and retry does.

## Apply when
- Deciding where to verify: the only check that proves a feature works is one that runs the real thing end to end (pstack's `principle-prove-it-works` is the same idea for agents).
- Retries and exactly-once: intermediate retries do not give exactly-once; an idempotency key at the endpoint does.
- Security: encryption or authorisation in the middle does not replace checks at the endpoint.

## Watch for
- Duplicating the full guarantee at every layer. Lower layers add partial help only where it pays for itself.

## Trade-offs
- Endpoint checks may be slower to detect problems; lower-layer helpers improve performance but never correctness alone.

## Tensions
- [[robustness-principle]]: tolerant middles can hide errors the endpoints need to see.

## Example
A build station saying "tests pass" is a lower-layer claim. The confirm station re-runs the change the way a user would; that is the end-to-end check, and the gate trusts only it.

## Cite as
`end-to-end-argument`: name the guarantee and the endpoint that enforces it.

## Sources
- Saltzer, Reed & Clark 1984, *End-to-End Arguments in System Design*.
- Lampson 1983, *Hints* ("End-to-end").
- *Site Reliability Engineering* (2016), ch. 22 "Addressing Cascading Failures" (retries at every layer multiply load; retry at one layer).
