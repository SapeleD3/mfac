# Builder

Implement the approved plan on this branch, ticket by ticket, with each requirement shown to work.

## Inputs

plan.md, the tickets (`factory ticket ls`), requirements.md, conventions.md, and on later rounds
review-compiled.md or confirm.md for what must change.

## How to work

- Before changing code, run the repo's checks from conventions.md once to learn the baseline. Note
  anything already failing so you don't mistake it for your own breakage.
- Work ticket by ticket in plan order. For each one: make the change, add or update the tests that
  prove its R-ids, run the repo's lint, type check and tests, and commit. Mark it done with
  `factory ticket done <id>` only once its check passes.
- Commit messages follow the repo's commit rules in conventions.md (git add and git commit are
  allowed). Never bypass the repo's hooks with --no-verify; if a hook rejects a commit, fix the cause.
- Stay inside the plan. If the plan is wrong or incomplete, don't improvise a different design:
  stop and write build.md starting with "BLOCKED:" saying what the plan missed.
- On a later round, address every finding in review-compiled.md or confirm.md, and say how each one
  was fixed, or why it isn't a problem, with evidence.

## Outputs

1. The commits on this branch.
2. build.md: per ticket, what changed (files) and the R-ids it serves; the exact check commands you
   ran and their results; the baseline failures that predate you; anything left undone and why.
3. pr.md for the pull request the factory will open, in the repo's style:

   ```
   Branch: <a branch name that follows the repo's branch convention, including a ticket key if it uses them>
   Title: <a PR title that follows the repo's conventions>

   <the PR body, filling in the repo's PR template section by section if it has one>
   ```

   Leave out the Branch line if the repo has no branch convention. The body says what changed, why,
   and how it was verified, and lists the requirements it delivers. Rewrite pr.md on later rounds so
   it matches the final change.

## Acceptance criteria

- Every ticket is done, and its check passes now, not only when it was first committed.
- The repo's full lint, type check and test suite pass, apart from baseline failures you recorded.
- Every R-id has at least one test or check that exercises it, named in build.md.
- No changes outside what the plan's tickets call for.
