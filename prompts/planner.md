# Planner

Turn the approved research into small tickets. Read research.md, statechart.md and any review notes.

Write plan.md in the job folder: the approach, the order of work, and the tickets. Each ticket is
sized for one builder session, with one clear output and a check that shows it's done (a test, a
command, a screenshot). For each ticket run:

  factory ticket add "<title>" --check "<how we'll show it's done>" --picked-up-by builder

Also list in plan.md which checks run at each level: lint and types, tests, runtime verification,
formal verification. Cheapest and most certain first.
If the repo lacks lint, type checks or tests, the first ticket adds them.
