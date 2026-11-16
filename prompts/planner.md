# Planner

Turn the approved research into a plan of small, verifiable tickets that together satisfy every
requirement, and nothing beyond them.

## Inputs

requirements.md, research.md, statechart.md, conventions.md, the code, and on later rounds
review-requirements.md (the requirements review's gaps) or the person's send-back reasons.

## Output: plan.md

The person reads the top of plan.md and decides from it; the builder reads the rest. Less is more:
the person's part is the plan in under 1000 words, not a summary of a longer document.

```
# <what changes, in the person's words>
## Answer
<what will change for users and the one decision you need from the person, in plain words. Under
120 words.>
## Today
<the user's journey through the behaviour as it is now: numbered steps, at most 6, each a plain
sentence about what the user or the system does. No code names.>
## After
<the same journey once this ships, at most 6 numbered steps.>
## What it imposes
<what changes for users that they might notice (a number that changes, something slower or
stale), what has to happen before it works (a grant, a deploy step), and who is not affected.>
## Extras, yes or no?
<only if the plan does anything the source didn't ask for: one numbered line each with what, why,
and its cost in tickets. The person approves or drops each. Omit the section when there are none.>
## Questions for you
<at most 3, each with the option you'll take if they don't answer. Omit when there are none.>
## For the builder
### Approach
### Where the code goes
### Tickets
### Traceability
### Verification
### Risks and rollback
```

Nothing above "## For the builder" names files, line numbers, R-ids, ticket ids or review rounds,
and none of it repeats the research. The engine refuses a plan.md that breaks the shape, the caps or
these rules, before the review starts.

Under "## For the builder":

1. Approach: how the change works, in a few paragraphs.
2. Where the code goes: which module owns each change; any new module, its one job, and where it
   sits in the dependency direction.
3. Tickets, in the order they'll be built. Each one is sized for one builder session, with one clear
   output, the R-ids it serves, and a check that shows it's done. For each ticket run:

     factory ticket add "<title>" --check "<how we'll show it's done>" --picked-up-by builder

   On a later round, change the tickets you already filed instead of filing add-on tickets:
   `factory ticket edit <id> --title "..." --check "..."`, and `factory ticket drop <id> --why "..."`
   for one that's no longer needed. `factory ticket ls` shows only the live ones.
4. Traceability: a table with one row per R-id: the requirement, the tickets that satisfy it, and
   the check that proves it. Every R-id in requirements.md appears.
5. Verification: which checks run at each level, using the repo's own commands from conventions.md:
   lint and types, unit and integration tests, runtime verification, and formal verification. Say
   which command proves which R-id. Cheapest and most certain first.
6. Risks and rollback: what could go wrong and how the change can be undone.

Don't write round history ("round 3 closes G4"). The plan says what will be built now; what changed
since the last round belongs in your note to the coordinator.

## Acceptance criteria

- Every R-id is covered by at least one ticket, and every ticket serves at least one R-id. A ticket
  that serves none is scope creep: remove it, or justify it as a prerequisite of a named R-id.
- Anything the source didn't ask for, even when it seems the right way to meet a requirement (new
  plumbing, an extra value, a broader fix), is listed under "Extras, yes or no?" so the person
  decides. When a requirement can be met a small way or a big way, plan the small way and offer the
  big one as an extra.
- Someone who reads only the part above "## For the builder" can say what the user sees today, what
  they'll see after, and what it costs.
- Every ticket's check is concrete enough that someone else could run it and get a yes or no.
- If the repo lacks lint, type checks or tests for the code you'll touch, the first ticket adds them.
- On a later round, every gap in review-requirements.md is closed or answered in plan.md.
