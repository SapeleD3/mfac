---
id: twelve-factor-app
name: The twelve-factor app
group: architecture
rule: Build services that keep config in the environment, treat backing services as attached resources, run as stateless disposable processes, and keep dev and prod alike.
sources: [wiggins-2011]
related: [crash-only-software, least-privilege, single-source-of-truth]
tensions: [kiss]
pstack: []
---
# The twelve-factor app

**Rule.** Heroku's methodology for deployable services: (1) one codebase, many deploys; (2) explicitly declared dependencies; (3) config in the environment; (4) backing services as attached resources; (5) strictly separate build, release, run; (6) stateless processes; (7) port binding; (8) scale out via processes; (9) disposability: fast start, graceful stop; (10) dev/prod parity; (11) logs as event streams; (12) admin tasks as one-off processes.

## Apply when
- Designing any long-running service or daemon, including on-device ones.
- Reviewing config handling: secrets or environment-specific values in code are a factor-3 violation.

## Watch for
- Taking factors literally off the cloud. For an on-device app: "port binding" may be a Unix socket; "stateless processes" means state lives in one store (a SQLite file), not in memory; "config in the environment" can be a config file in a known place plus env overrides.
- Secrets in plain environment variables on shared machines; prefer the OS keychain.

## Trade-offs
- Discipline about state and config; easy restarts, easy testing, and no "works on my machine".

## Tensions
- [[kiss]]: a single-user local tool needs factors 2, 3, 6, 9, 11 most; the scaling factors matter less.

## Example
`FACTORY_HOME` and `FACTORY_SOCKET` override paths (factor 3); all state is in `factory.db`, so the daemon can be killed and restarted at any time (factors 6 and 9).

## Cite as
`twelve-factor-app`: name the factor(s) you applied.

## Sources
- Wiggins et al. 2011, *The Twelve-Factor App* (12factor.net).
