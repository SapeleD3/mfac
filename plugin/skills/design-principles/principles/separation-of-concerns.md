---
id: separation-of-concerns
name: Separation of concerns
group: modularity
rule: Study and build one aspect of a problem at a time, so each part of the code answers to one kind of question.
sources: [dijkstra-1974, parnas-1972]
related: [information-hiding, single-responsibility, functional-core-imperative-shell, hexagonal-architecture]
tensions: [deep-modules, kiss]
pstack: [principle-boundary-discipline]
---
# Separation of concerns

**Rule.** Dijkstra: be "occupied only with one aspect" while knowing the others exist. In code: keep concerns such as domain rules, persistence, transport, presentation, and policy (retries, auth, logging) in different places, so changing one does not mean reading the others.

## Apply when
- A function mixes I/O with decisions (reads the DB, decides, formats HTML, sends email).
- A bug fix in one concern (say, formatting) risks breaking another (say, billing rules).
- Choosing folder or package structure.

## Watch for
- Splitting by technical layer only (controllers/, services/, repositories/) when the real concerns are features. A feature split often separates concerns better.
- Separating things that always change together. That doubles the edit, not halves it ([[cohesion-and-coupling]]).

## Trade-offs
- More files and seams; easier testing and change. The seam is worth it when each side changes for different reasons or at different rates.

## Tensions
- [[deep-modules]]: a deep module may legitimately contain several sub-concerns behind one interface. Separate inside it, not across its interface.
- [[kiss]]: a 30-line script does not need layers.

## Example
```ts
// Mixed: decision, I/O and formatting in one place.
async function remind(id: string) { const t = await db.get(id); if (t.due < Date.now()) await slack.post(`*${t.title}* is late`); }
// Separated: the decision is pure; I/O and formatting are at the edge.
const isLate = (t: Task, now: number) => t.due < now;
const lateMessage = (t: Task) => `*${t.title}* is late`;
```

## Cite as
`separation-of-concerns`: name the two concerns you separated and where each now lives.

## Sources
- Dijkstra 1974, EWD447 *On the role of scientific thought* (origin of the phrase).
- Parnas 1972 (modules as units of separately changeable concerns).
