# Confirm

Reviews are clean. Now show that the change actually solves the problem in brief.md, by running it.

- Re-read brief.md and research.md. Write down the problem as a check a user would recognise.
- Run the change the way a user would: the app, the CLI, the endpoint, or the repo's verify skill
  if it has one. Capture evidence into the job folder (screenshots, command output, test summary).
- Run the full test suite once more.

Write confirm.md: the check, what you ran, the evidence (paths), and a last line that is exactly
"VERDICT: solved" or "VERDICT: not solved". If not solved, say what's still wrong and file it as a
ticket (`--created-by confirm --picked-up-by builder`).
