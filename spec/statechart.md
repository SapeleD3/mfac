# One task's life

The engine enforces this chart: `src/workflow/statechart.ts` is the code copy of [`Factory.tla`](Factory.tla), and
CI model-checks the spec with TLC at `Cap = 3` on every PR (`npm run tlc` does the same locally).

| Rule | Invariant |
| --- | --- |
| Research rule | No task reaches the research gate, planning, building or done without a statechart and a passing TLC check |
| Coverage rule | You only see a plan once an independent review has traced every requirement in the original Slack message or Jira ticket into it |
| Build rule | Building only starts on approved research and an approved plan |
| PR rule | You only see code once review is clean and the change is confirmed to solve the problem |
| Gates rule | Done only after research, plan and PR are all approved |
| Caps | At most 3 send-backs per gate, and 3 rounds per automatic loop (research check, requirements review, review findings, confirm); then Needs you, also capped at 3 |
| Ends or parked | Every task ends as Ignored, Replied, Done or Dropped, or waits in Parked because you put it there |

Beyond the original design, the model adds three moves that only a person makes, so fairness never
forces them: dismissing a drafted reply, overruling triage (an ignored item or a draft becomes a task),
and stopping a running stage (it goes to Needs you, whose cap still applies). TLC checks every rule with
them in: 15,689,700 distinct states, no errors.

```mermaid
stateDiagram-v2
    [*] --> Inbox: Slack message or Jira ticket arrives
    Inbox --> Triage: intake run picks it up
    Triage --> Ignored: FYI or noise
    Triage --> ReplyDrafted: needs an answer from you
    ReplyDrafted --> Replied: you press Send
    ReplyDrafted --> Ignored: you dismiss the draft
    ReplyDrafted --> Queued: you turn it into a task
    Ignored --> Queued: you overrule triage
    Triage --> Queued: needs work
    Queued --> Researching: slot frees, Opus coordinator starts

    Researching --> ResearchCheck: statechart and TLA+ model written
    ResearchCheck --> Researching: requirements, statechart or TLC check fails (max 3 retries)
    ResearchCheck --> ResearchGate: TLC passes, doc published to Notion
    ResearchCheck --> NeedsYou: TLC still failing after 3

    ResearchGate --> Planning: you approve (comments in Notion)
    ResearchGate --> Researching: you send back (max 3)
    ResearchGate --> Dropped: you drop

    Planning --> RequirementsReview: plan and tickets written
    RequirementsReview --> Planning: gaps against the original ask (max 3)
    RequirementsReview --> PlanGate: every requirement traced, tickets on your Notion board
    RequirementsReview --> NeedsYou: gaps remain after 3
    PlanGate --> Building: you approve
    PlanGate --> Planning: you send back (max 3)
    PlanGate --> Researching: you send back to research
    PlanGate --> Dropped: you drop

    state "Build loop, no human gate" as Loop {
        Building --> Reviewing: branch ready
        state Reviewing {
            [*] --> CodeReview
            [*] --> SecurityReview
            CodeReview --> Compiled
            SecurityReview --> Compiled
        }
        Reviewing --> Building: findings compiled (max 3)
        Reviewing --> Confirming: review clean
        Confirming --> Building: doesn't solve the problem (max 3)
    }
    Reviewing --> NeedsYou: findings remain after 3
    Confirming --> NeedsYou: still not solved after 3
    Confirming --> PRGate: confirmed, PR opened

    PRGate --> Done: you approve
    PRGate --> Building: you send back (max 3)
    PRGate --> Planning: you send back to plan
    PRGate --> Dropped: you drop

    NeedsYou --> Researching: you restart research (max 3)
    NeedsYou --> Building: you retry the build (max 3)
    NeedsYou --> Dropped: you drop

    Researching --> NeedsYou: you stop it
    Planning --> NeedsYou: you stop it
    RequirementsReview --> NeedsYou: you stop it
    Loop --> NeedsYou: you stop it

    Queued --> Parked: you park it
    ResearchGate --> Parked: you park it
    PlanGate --> Parked: you park it
    PRGate --> Parked: you park it
    NeedsYou --> Parked: you park it
    Parked --> Queued: you unpark (back where it was)
    Parked --> Dropped: you drop

    Ignored --> [*]
    Replied --> [*]
    Done --> [*]: result written back to Slack or Jira
    Dropped --> [*]
```
