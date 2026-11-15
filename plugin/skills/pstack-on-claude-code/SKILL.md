---
name: pstack-on-claude-code
description: Read before running any pstack skill (statechart, create-formal-verification-skill, poteto-mode, arena, the principle-* skills and the rest). pstack was written for Cursor; this maps its Cursor names to Claude Code.
---

# pstack on Claude Code

The factory installs Lauren Tan's original pstack (github.com/cursor/plugins, folder `pstack`) unchanged.
Its skills are written for Cursor. When one names a Cursor tool, path or setting, use the Claude Code
equivalent below and keep everything else in the skill as written.

| pstack says (Cursor) | Do this in Claude Code |
| --- | --- |
| the Task tool, spawn a subagent | the Agent tool |
| `generalPurpose` subagent | `subagent_type: "general-purpose"` |
| a named agent such as `poteto-agent` or `comment-sicko` | `subagent_type` with that name (the factory links pstack's agents) |
| `is_background: true` | `run_in_background: true` |
| `AskQuestion` | `AskUserQuestion`. In a factory session nobody is watching: write the question to the stage output and stop, and the coordinator routes it to Needs you |
| model slugs such as `claude-opus-5-5-high-fast` | the Agent tool's `model`: `opus`, `sonnet` or `haiku`. Models from other vendors (`gemini-*`) aren't available: drop that seat and say so, as the skill allows |
| `~/.cursor/rules/pstack-models.mdc` | doesn't exist here: use the skill's stated defaults |
| `.cursor/skills/<name>/` in a project | `.claude/skills/<name>/` in the same project |
| `~/.cursor/skills/` (personal skills) | don't write personal skills; put them in the project's `.claude/skills/` and mention it in the stage output |
| `~/.cursor/projects/*/agent-transcripts/` | this session's transcript under `~/.claude/projects/` only, never other projects' |
| Cursor's built-in `create-skill` | write the `SKILL.md` directly (name and description frontmatter, then the body) |
| Cursor rules (`.mdc`) | the project's `CLAUDE.md` |
| the todo tool | `TodoWrite` |
