---
id: chestertons-fence
name: Chesterton's fence
group: simplicity
rule: Before removing or changing something whose purpose you do not know, find out why it is there.
sources: [chesterton-1929]
related: [hyrums-law, kiss]
tensions: [kiss]
pstack: [principle-subtract-before-you-add, principle-attack-the-premise]
---
# Chesterton's fence

**Rule.** Do not take down a fence until you know why it was put up. In code: read the commit, the PR discussion and the tests that introduced a strange check before deleting it. Then delete it confidently, or keep it and write down why.

## Apply when
- Simplifying or deleting code you did not write: odd guards, sleeps, retries, special cases.
- A cleanup PR removes "unused" config or flags.

## Watch for
- Using it as a reason never to delete. The goal is a quick investigation (`git log -S`, `git blame`), then action.

## Trade-offs
- A few minutes of archaeology; avoids reintroducing an old bug.

## Tensions
- [[kiss]] and pstack's `principle-subtract-before-you-add` push to delete; this principle says delete *after* you know what the fence held back.

## Example
A `sleep(500)` before reading a tmux pane looks pointless. `git log -S "sleep(500)"` shows it waited for the shell prompt; replace it with a readiness check rather than deleting it.

## Cite as
`chestertons-fence`: name the thing you investigated and what you found.

## Sources
- Chesterton 1929, *The Thing* (the fence parable).
