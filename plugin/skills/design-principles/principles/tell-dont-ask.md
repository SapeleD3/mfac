---
id: tell-dont-ask
name: Tell, don't ask
group: collaboration
rule: Put behaviour next to the data it uses; tell an object what to do instead of pulling its state out and deciding for it.
sources: [hunt-thomas-1999, lieberherr-holland-1989]
related: [law-of-demeter, information-hiding, functional-core-imperative-shell]
tensions: [functional-core-imperative-shell, separation-of-concerns]
pstack: [principle-model-the-domain]
---
# Tell, don't ask

**Rule.** If code reads several fields from an object and then decides what that object should do, the decision belongs inside the object (or the module that owns that data).

## Apply when
- Feature envy: a function uses another module's data more than its own.
- The same "if state is X and round < cap then ..." check appears in several callers.

## Watch for
- Taking it into rendering or reporting code. Views legitimately ask for data.
- Fighting a functional style: in a functional core, data is plain and functions are separate by design. There, apply the spirit (keep the decision in one module next to the data's type), not the object form.

## Trade-offs
- Rules live in one place; the owning module grows. Watch that it keeps one responsibility.

## Tensions
- [[functional-core-imperative-shell]] and [[separation-of-concerns]] keep data and behaviour separate on purpose; resolve by co-locating the type and its functions in one module.

## Example
```ts
// Asking, then deciding outside.
if (t.state === "review" && t.round < CAP) t.state = "build";
// Telling the owner of the rules.
machine = step(machine, { type: "reviews_done", findings: true });
```

## Cite as
`tell-dont-ask`: name the decision you moved and where it lives now.

## Sources
- Hunt & Thomas 1999, *The Pragmatic Programmer* (popularised the phrase, with the Law of Demeter).
- Lieberherr & Holland 1989.
