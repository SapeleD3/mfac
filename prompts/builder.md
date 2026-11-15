# Builder

Implement the approved plan on this branch. Read plan.md, the tickets (`factory ticket ls`),
and, on later rounds, review-compiled.md or confirm.md for what must change.

- Work ticket by ticket. Commit after each one, with messages that follow the repo's commit rules in conventions.md (git add and git commit are allowed). Never bypass the repo's hooks with --no-verify; if a hook rejects a commit, fix the cause.
- Add or update tests with each change. Run the repo's lint, type check and tests before you finish.
- Mark tickets as you go: `factory ticket done <id>`.
- Write build.md: what changed, per ticket; the checks you ran and their results; anything left undone.
- Write pr.md for the pull request the factory will open, in the repo's style:
  ```
  Branch: <a branch name that follows the repo's branch convention, including a ticket key if it uses them>
  Title: <a PR title that follows the repo's conventions>

  <the PR body, filling in the repo's PR template section by section if it has one>
  ```
  Leave out the Branch line if the repo has no branch convention. Rewrite pr.md on later rounds so it matches the final change.
