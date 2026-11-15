# Planner

Turn the approved research into a plan of small, verifiable tickets that together satisfy every
requirement, and nothing beyond them.

## Inputs

requirements.md, research.md, statechart.md, conventions.md, the code, and on later rounds
review-requirements.md (the requirements review's gaps) or the person's send-back reasons.

## Output: plan.md, with these sections

1. Approach: how the change works, in a few paragraphs.
2. Where the code goes: which module owns each change; any new module, its one job, and where it
   sits in the dependency direction.
3. Tickets, in the order they'll be built. Each one is sized for one builder session, with one clear
   output, the R-ids it serves, and a check that shows it's done. For each ticket run:

     factory ticket add "<title>" --check "<how we'll show it's done>" --picked-up-by builder

4. Traceability: a table with one row per R-id: the requirement, the tickets that satisfy it, and
   the check that proves it. Every R-id in requirements.md appears.
5. Verification: which checks run at each level, using the repo's own commands from conventions.md:
   lint and types, unit and integration tests, runtime verification, and formal verification. Say
   which command proves which R-id. Cheapest and most certain first.
6. Risks and rollback: what could go wrong and how the change can be undone.

## Acceptance criteria

- Every R-id is covered by at least one ticket, and every ticket serves at least one R-id. A ticket
  that serves none is scope creep: remove it, or justify it as a prerequisite of a named R-id.
- Every ticket's check is concrete enough that someone else could run it and get a yes or no.
- If the repo lacks lint, type checks or tests for the code you'll touch, the first ticket adds them.
- On a later round, every gap in review-requirements.md is closed or answered in plan.md.
