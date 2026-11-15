---
description: Hand this conversation and folder to the factory as a task, or as more context for the task this chat already started
argument-hint: what the factory should do, e.g. "Build this out" or "research: which queue should we use"
allowed-tools: Bash(factory chat:*), Bash(factory show:*), Bash(factory ls:*)
---

The person wants the factory to take over from this conversation: $ARGUMENTS

The factory runs the work on its own (research, a TLC-checked statechart, review gates in Notion, then a
plan, the build and a PR), so everything it needs must be in what you hand over. Do this:

1. Decide the kind. It is research only when the ask is for an answer, findings, a comparison or a
   recommendation rather than a change to the code (for example "research …", "find out …", "which …
   should we use"). Otherwise it is a change.

2. Write the handoff brief from this whole conversation, in Markdown, self-contained for someone who
   hasn't seen it:
   - Goal: what to build or find out, in the person's words where they gave them.
   - Decisions made so far, and why.
   - Constraints and conventions the person stated (tools, style, what not to do).
   - Where things are: the files, functions and commands that matter, as paths from this folder.
   - What is already done in this chat, and what was tried and didn't work.
   - Open questions the person hasn't settled.
   Quote the person's own words for anything that decides scope. Never include secrets or tokens.

3. Hand it over with one command, from this folder (use `--research` only for research-only work):

   ```sh
   factory chat "<short imperative title>" --chat "${CLAUDE_SESSION_ID}" --repo "$PWD" [--research] <<'BRIEF'
   <the brief>
   BRIEF
   ```

   The factory also gets this chat's transcript, so its stages can read anything the brief leaves out.
   If this chat already started a factory task, the brief becomes new context for that task instead
   (or a follow-up task, if it finished). Add `--to F-012` to send it to a specific task, or `--new`
   when the person asks for a separate task.

4. Tell the person in one or two sentences what happened, using the command's output: the task id,
   whether it's new, added to an existing task or a follow-up, and that they can watch it in the
   Factory app or with `factory show <id>`. Then stop; don't start the work yourself.
