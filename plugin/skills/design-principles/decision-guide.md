# Decision guide

Find the decision you are making, read the principles it points to (first one first), and note the tension the last column warns about. If no row fits, scan the index in [SKILL.md](SKILL.md) by group.

## Boundaries and modules

| decision | read | rule of thumb |
|---|---|---|
| Where should this module boundary go? | [`information-hiding`](principles/information-hiding.md), [`cohesion-and-coupling`](principles/cohesion-and-coupling.md), [`conways-law`](principles/conways-law.md) | Draw it around a decision likely to change, not around steps of a flowchart. |
| Should I split this file or class? | [`single-responsibility`](principles/single-responsibility.md), [`cohesion-and-coupling`](principles/cohesion-and-coupling.md), [`deep-modules`](principles/deep-modules.md) | Split only if you can name two actors or two secrets. Otherwise keep it deep. |
| Should I add a wrapper or helper layer? | [`deep-modules`](principles/deep-modules.md), [`kiss`](principles/kiss.md) | A layer must hide more than it exposes. One-caller pass-throughs fail that test. |
| This interface is getting big. Split it? | [`interface-segregation`](principles/interface-segregation.md), [`deep-modules`](principles/deep-modules.md) | Split per client role, not per method. |
| Code reaches through several objects. | [`law-of-demeter`](principles/law-of-demeter.md), [`tell-dont-ask`](principles/tell-dont-ask.md) | Move the behaviour to the data's owner instead of adding forwarders. |
| Who should own this shared code? | [`conways-law`](principles/conways-law.md), [`single-responsibility`](principles/single-responsibility.md) | Unowned shared code decays; give it one owner or duplicate it. |

## Abstraction and reuse

| decision | read | rule of thumb |
|---|---|---|
| These two blocks look alike. Extract a helper? | [`dry`](principles/dry.md), [`wrong-abstraction`](principles/wrong-abstraction.md) | Same fact, same reason to change: extract. Different reasons: keep both, wait for the third. |
| A helper keeps growing flags. | [`wrong-abstraction`](principles/wrong-abstraction.md), [`simple-not-easy`](principles/simple-not-easy.md) | Inline it into callers and look again. |
| Should I add an extension point, plug-in, or option? | [`yagni`](principles/yagni.md), [`open-closed`](principles/open-closed.md), [`kiss`](principles/kiss.md) | Only along an axis of change you have already seen twice. |
| Inheritance or composition? | [`composition-over-inheritance`](principles/composition-over-inheritance.md), [`liskov-substitution`](principles/liskov-substitution.md) | Inherit only for true, contract-honouring is-a. |
| I'm writing a second implementation (adapter, fake). | [`liskov-substitution`](principles/liskov-substitution.md), [`design-by-contract`](principles/design-by-contract.md) | Honour the whole contract, including in test fakes. |
| Should I build this for a future need? | [`yagni`](principles/yagni.md), [`galls-law`](principles/galls-law.md) | No, unless it is a one-way door (data format, public API, security). |

## Architecture

| decision | read | rule of thumb |
|---|---|---|
| How do I keep the core independent of Slack, Jira, tmux, the DB? | [`hexagonal-architecture`](principles/hexagonal-architecture.md), [`dependency-inversion`](principles/dependency-inversion.md), [`clean-architecture`](principles/clean-architecture.md) | The core defines ports in its own language; adapters translate at the edge. |
| Where does this logic go: core or edge? | [`functional-core-imperative-shell`](principles/functional-core-imperative-shell.md), [`separation-of-concerns`](principles/separation-of-concerns.md), [`clean-architecture`](principles/clean-architecture.md) | Decisions are pure and inside; I/O, time and mutation are outside. |
| Two parts of the system use the same word differently. | [`domain-driven-design`](principles/domain-driven-design.md), [`conways-law`](principles/conways-law.md) | Draw a bounded context and translate at the boundary (anticorruption layer). |
| Behaviour depends on history, modes, retries or caps. | [`statecharts`](principles/statecharts.md), [`design-by-contract`](principles/design-by-contract.md), [`single-source-of-truth`](principles/single-source-of-truth.md) | One explicit machine decides transitions; check its invariants. |
| New service, or a module in the existing process? | [`conways-law`](principles/conways-law.md), [`kiss`](principles/kiss.md), [`galls-law`](principles/galls-law.md) | One owner and one machine means one process. Split when ownership or scaling demands it. |
| How should this daemon or service be built and configured? | [`twelve-factor-app`](principles/twelve-factor-app.md), [`crash-only-software`](principles/crash-only-software.md), [`least-privilege`](principles/least-privilege.md) | Config outside code, state in one store, safe to kill at any time. |
| How to plan milestones for a big feature? | [`galls-law`](principles/galls-law.md), [`yagni`](principles/yagni.md) | Every milestone leaves a working end-to-end system. |

## Data and state

| decision | read | rule of thumb |
|---|---|---|
| What data structure should I use? | [`data-dominates`](principles/data-dominates.md) | See [data-structures.md](data-structures.md) by access pattern. |
| Should I store this value or compute it? | [`essential-vs-accidental-complexity`](principles/essential-vs-accidental-complexity.md), [`single-source-of-truth`](principles/single-source-of-truth.md) | Compute it unless measurement says otherwise; if you cache it, say how to rebuild it. |
| The same state lives in two places. | [`single-source-of-truth`](principles/single-source-of-truth.md), [`dry`](principles/dry.md) | Name the owner per field; the rest are projections. |
| Shared state is mutated by several callers. | [`immutability`](principles/immutability.md), [`simple-not-easy`](principles/simple-not-easy.md) | Pass values, confine mutation to one owner. See pstack principle-separate-before-serializing-shared-state. |
| Config: code, data file, or environment? | [`rule-of-least-power`](principles/rule-of-least-power.md), [`twelve-factor-app`](principles/twelve-factor-app.md) | The weakest format that works, validated on load. |
| Can impossible combinations of fields occur? | [`statecharts`](principles/statecharts.md), [`design-by-contract`](principles/design-by-contract.md) | Make them unrepresentable (pstack principle-type-system-discipline). |

## Errors, input and reliability

| decision | read | rule of thumb |
|---|---|---|
| How should this error surface? | [`fail-fast`](principles/fail-fast.md), [`design-by-contract`](principles/design-by-contract.md) | Stop early with a precise message; translate it for people at the edge. |
| How tolerant should this parser be? | [`robustness-principle`](principles/robustness-principle.md), [`fail-fast`](principles/fail-fast.md) | Strict inside; tolerant only at external edges, and never silently. |
| Where should verification or retries live? | [`end-to-end-argument`](principles/end-to-end-argument.md), [`crash-only-software`](principles/crash-only-software.md) | At the endpoint that can actually guarantee it. Pair with pstack principle-make-operations-idempotent. |
| What happens if this process dies mid-way? | [`crash-only-software`](principles/crash-only-software.md), [`single-source-of-truth`](principles/single-source-of-truth.md) | Durable state in a transactional store; startup reconciles. |
| What access should this agent, token or process get? | [`least-privilege`](principles/least-privilege.md), [`interface-segregation`](principles/interface-segregation.md), [`rule-of-least-power`](principles/rule-of-least-power.md) | Deny by default; allow the minimum for the task. |

## Interfaces people and programs see

| decision | read | rule of thumb |
|---|---|---|
| Naming a command, flag, function or default. | [`least-astonishment`](principles/least-astonishment.md), [`command-query-separation`](principles/command-query-separation.md) | Do what the name says; queries never change state. |
| Designing output other programs or stations will parse. | [`hyrums-law`](principles/hyrums-law.md), [`unix-philosophy`](principles/unix-philosophy.md), [`rule-of-least-power`](principles/rule-of-least-power.md) | Fix the format on purpose; offer a structured mode. |
| Changing behaviour others may rely on. | [`hyrums-law`](principles/hyrums-law.md), [`chestertons-fence`](principles/chestertons-fence.md) | Find who depends on it and migrate them in the same change. |
| Removing code that looks pointless. | [`chestertons-fence`](principles/chestertons-fence.md) | Check `git log -S` and the PR that added it first, then delete with confidence. |

## Simplicity checks before you finish

| decision | read | rule of thumb |
|---|---|---|
| Is this design simpler than the alternatives? | [`kiss`](principles/kiss.md), [`simple-not-easy`](principles/simple-not-easy.md), [`essential-vs-accidental-complexity`](principles/essential-vs-accidental-complexity.md) | Count intertwined concerns and stored state, not lines. |
| Is every layer earning its place? | [`deep-modules`](principles/deep-modules.md), [`yagni`](principles/yagni.md) | Remove pass-throughs and speculative options. |

## When principles disagree

These pairs pull against each other most often. Pick deliberately and say which way you went in "Design principles applied".

| tension | usually resolve by |
|---|---|
| [`dry`](principles/dry.md) vs [`wrong-abstraction`](principles/wrong-abstraction.md) | Same knowledge and same reason to change: DRY. Look-alike code serving different actors: duplicate. |
| [`deep-modules`](principles/deep-modules.md) vs [`single-responsibility`](principles/single-responsibility.md) | Define the responsibility as the secret the module hides; keep it deep. |
| [`open-closed`](principles/open-closed.md) vs [`yagni`](principles/yagni.md) | Open only along an axis of change you have seen; closed sets use exhaustive matching. |
| [`kiss`](principles/kiss.md) vs [`hexagonal-architecture`](principles/hexagonal-architecture.md) | Ports for volatile, slow or side-effecting dependencies only; plain calls for the rest. |
| [`fail-fast`](principles/fail-fast.md) vs [`robustness-principle`](principles/robustness-principle.md) | Strict between your own parts; carefully tolerant at external edges, with logging. |
| [`tell-dont-ask`](principles/tell-dont-ask.md) vs [`functional-core-imperative-shell`](principles/functional-core-imperative-shell.md) | Co-locate the data type and its pure functions in one module. |
| [`chestertons-fence`](principles/chestertons-fence.md) vs [`kiss`](principles/kiss.md) | Investigate briefly, then delete. |
