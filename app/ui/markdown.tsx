import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { openUrl } from "./bridge";

let mermaidReady: Promise<typeof import("mermaid").default> | undefined;
const loadMermaid = () =>
  (mermaidReady ??= import("mermaid").then(({ default: m }) => {
    m.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict", fontFamily: "inherit" });
    return m;
  }));

let seq = 0;

const LABELLED = /^(\s*(?:note\s+(?:left|right)\s+of\s+\S+|\S+\s*-->\s*\S+))\s*:\s*(.*)$/;

/** Agents write labels and notes in prose; mermaid ends a state label at a second colon or a semicolon. */
export function mendStatechart(src: string): string {
  if (!/^\s*stateDiagram/m.test(src)) return src;
  return src
    .split("\n")
    .map((line) => {
      const m = line.match(LABELLED);
      return m ? `${m[1]} : ${m[2]!.replace(/\s*:\s*/g, " - ").replace(/;/g, ",")}` : line;
    })
    .join("\n");
}

/** Agent-written markdown, sanitised; mermaid blocks are drawn, and links open in the browser instead of replacing the app. */
export function Markdown({ text, class: cls = "", breaks = false }: { text: string; class?: string; breaks?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks }) as string), [text, breaks]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const blocks = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
    if (!blocks.length) return;
    let gone = false;
    void loadMermaid().then(async (m) => {
      for (const code of blocks) {
        if (gone) return;
        const pre = code.parentElement!;
        try {
          const src = code.textContent ?? "";
          const { svg } = await m.render(`mmd-${++seq}`, src).catch(() => m.render(`mmd-${++seq}`, mendStatechart(src)));
          const fig = document.createElement("div");
          fig.className = "mermaid-fig";
          fig.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"] });
          pre.replaceWith(fig);
        } catch {
          pre.classList.add("mermaid-failed");
          pre.title = "This diagram didn't parse, so it's shown as text";
        }
      }
    });
    return () => void (gone = true);
  }, [html]);
  const click = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    e.preventDefault();
    if (/^https?:\/\//.test(href)) void openUrl(href);
  };
  return <div ref={ref} class={`md ${cls}`} onClick={click} dangerouslySetInnerHTML={{ __html: html }} />;
}

const BUILDER = /^##\s+For the builder\b.*$/im;

export function splitDoc(text: string): { lead: string; rest: string; label: string } {
  const body = text.replace(/^\s*#\s[^\n]*\n/, "").replace(/^VERDICT:.*$/gm, "");
  const builder = BUILDER.exec(body);
  if (builder) return { lead: body.slice(0, builder.index).trim(), rest: body.slice(builder.index + builder[0].length).trim(), label: "For the builder" };
  // Docs written before the person/builder split: show up to the first section's end, fold the rest.
  const second = [...body.matchAll(/^##\s/gm)][1];
  if (!second?.index) return { lead: body.trim(), rest: "", label: "" };
  return { lead: body.slice(0, second.index).trim(), rest: body.slice(second.index).trim(), label: "The full write-up" };
}

export function Doc({ text, class: cls = "doc-body small-md" }: { text: string; class?: string }) {
  const { lead, rest, label } = useMemo(() => splitDoc(text), [text]);
  return (
    <>
      <Markdown text={lead} class={cls} />
      {rest && (
        <details class="for-builder">
          <summary>{label}</summary>
          <Markdown text={rest} class={cls} />
        </details>
      )}
    </>
  );
}
