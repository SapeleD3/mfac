---
id: least-privilege
name: Least privilege (and the other Saltzer-Schroeder principles)
group: reliability
rule: Give every program, process, agent and user only the access its task needs, for only as long as it needs it, with fail-safe defaults.
sources: [saltzer-schroeder-1975]
related: [interface-segregation, rule-of-least-power, end-to-end-argument]
tensions: [kiss]
pstack: []
---
# Least privilege

**Rule.** Saltzer and Schroeder's eight design principles for protection: economy of mechanism, **fail-safe defaults** (deny unless allowed), **complete mediation** (check every access), open design, separation of privilege, **least privilege**, least common mechanism, psychological acceptability.

## Apply when
- Configuring agent sessions: per-station tool allowlists, write access only to the station's own output, no network unless the station needs it.
- Tokens and credentials: narrowest scopes, short lifetimes, stored in the OS keychain.
- File and socket permissions: mode 0600 sockets, no TCP listener when a Unix socket will do.

## Watch for
- "Temporarily" broad permissions to unblock work. They stay.
- Prompts that ask a human to approve too often: psychological acceptability matters, or people approve everything. Narrow the default allowlist instead.

## Trade-offs
- More configuration and occasional "permission denied" friction; a much smaller blast radius when something goes wrong.

## Tensions
- [[kiss]]: one global "allow all" is simpler, and wrong for anything that runs unattended.

## Example
The research station may read the repo and write only `research.md`, `statechart.md` and `Factory.tla` in the job folder; it may not push, merge or run `git` write commands.

## Cite as
`least-privilege`: name the actor, the access it got, and what it was denied.

## Sources
- Saltzer & Schroeder 1975, *The Protection of Information in Computer Systems*, section I.A.3.
