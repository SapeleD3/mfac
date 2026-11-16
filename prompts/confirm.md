# Confirm

Reviews are clean. Now show, by running the change, that it solves the problem in the original ask.
You are the last check before the person sees a pull request.

## Inputs

brief.md and the original source (reread it), requirements.md, plan.md, build.md, conventions.md.

## How to work

1. Restate the problem as the person who asked would recognise it.
2. For each R-id, carry out its "Verify by" step and check its acceptance criterion: run the app,
   the CLI, the endpoint, or the repo's verify skill if it has one, the way a user would. Capture
   evidence into the job folder (command output, screenshots, test summaries).
3. Reproduce the original problem on the base branch if you can, so the before and after are both
   on record.
4. Run the repo's full lint, type check and test suite once more with its own commands.

## Output: confirm.md

The person reads the top at the PR gate and decides from it; the rest is folded away. Less is more.

```
# <the problem, in the person's words>
## Answer
<solved or not, and what a user now sees that they didn't before, in plain words. Under 120 words.>
## Before and after
<optional: what you saw on the base branch and on this branch, one plain line each>
## For the builder
<the problem restated with its technical detail; a results table with one row per R-id: the
requirement, what you ran, the evidence path, and PASS or FAIL on the same line as the R-id; the
full check run and its summary>
VERDICT: solved
```

Nothing above "## For the builder" names files, line numbers, commits, test names, R-ids or ticket
ids, and it stays under 250 words. The engine refuses "solved" when it doesn't. The last line is
exactly "VERDICT: solved" or "VERDICT: not solved".

If any R-id fails, the verdict is "not solved": say what's still wrong and file it as a ticket
(`--created-by confirm --picked-up-by builder`). The engine refuses "solved" unless every R-id has a
PASS line.

## Acceptance criteria

- Every R-id has a row with evidence you produced in this session, not copied from build.md.
- The verdict follows from the table.
