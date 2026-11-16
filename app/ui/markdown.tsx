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

/** Agent-written markdown, sanitised; mermaid blocks are drawn, and links open in the browser instead of replacing the app. */
export function Markdown({ text, class: cls = "" }: { text: string; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }) as string), [text]);
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
          const { svg } = await m.render(`mmd-${++seq}`, code.textContent ?? "");
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
