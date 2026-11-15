---
id: deep-modules
name: Deep modules
group: modularity
rule: A module's interface should be much simpler than its implementation; prefer few, powerful operations over many thin ones.
sources: [ousterhout-2018, ousterhout-cs190, parnas-1972]
related: [information-hiding, cohesion-and-coupling, interface-segregation, simple-not-easy]
tensions: [single-responsibility, interface-segregation]
pstack: [principle-minimize-reader-load, principle-subtract-before-you-add]
---
# Deep modules

**Rule.** The value of a module is the complexity it hides minus the complexity of its interface. Make interfaces small and implementations do real work. "Pull complexity downwards": the module author suffers so its many callers don't.

## Apply when
- Designing a public function, class, CLI command or API.
- You see pass-through methods (a method that only calls another with the same signature) or wrapper classes with one caller.
- Callers repeat the same three-call dance every time; fold it into one call with good defaults.

## Watch for
- "Classitis": many tiny classes each with a tiny interface. Each adds an interface to learn and hides almost nothing.
- Configuration parameters that push decisions to the caller ("you decide the retry count"). Choose a sensible default inside.
- Going too deep: one function that does unrelated things behind a flag soup is not deep, it is tangled ([[simple-not-easy]]).

## Trade-offs
- Deep modules are harder to write and review once; they save time on every use.
- A general-purpose interface ("somewhat general-purpose", in Ousterhout's words) is often both simpler and deeper than a special-purpose one, but do not generalise beyond today's known uses.

## Tensions
- [[single-responsibility]] read literally ("one tiny reason per class") pushes toward shallow classes. Resolve it by defining the responsibility at the level of the secret the module hides.
- [[interface-segregation]]: split an interface when clients really use disjoint parts, not as a default.

## Example
```ts
// Shallow: callers must know the order and every flag.
const f = openFile(p); const r = reader(f, { buffer: 8192 }); const t = decode(r, "utf8");
// Deep: one call, the common case is the default.
const text = readFileSync(p, "utf8");
```

## Cite as
`deep-modules`: "deep-modules: `runner.start(task)` hides worktree, tmux, settings and hook setup behind one call".

## Sources
- Ousterhout 2018, *A Philosophy of Software Design*, ch. 4 "Modules Should Be Deep", ch. 8 "Pull Complexity Downwards".
- Ousterhout, Stanford CS 190 lecture notes, "Modular Design".
