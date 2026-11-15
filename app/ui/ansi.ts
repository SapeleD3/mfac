/* Turns a tmux capture with escapes (capture-pane -e) into safe HTML: SGR colours and weight only. */
const BASIC = ["#1d1f24", "#e06c6c", "#6cc28a", "#e8b04a", "#6aa8ff", "#c79bf2", "#5fc4c4", "#c9d1d9"];
const BRIGHT = ["#6b707c", "#ff8a7a", "#8fe0a8", "#f2c46b", "#8fb5ff", "#d9b3ff", "#7fd1d1", "#ffffff"];

function c256(n: number): string {
  if (n < 8) return BASIC[n]!;
  if (n < 16) return BRIGHT[n - 8]!;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const f = (x: number) => (x ? 55 + x * 40 : 0);
  return `rgb(${f(Math.floor(i / 36))},${f(Math.floor(i / 6) % 6)},${f(i % 6)})`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ansiToHtml(input: string): string {
  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false;
  let dim = false;
  let out = "";
  let open = false;
  const style = () => {
    if (open) out += "</span>";
    const css = [fg && `color:${fg}`, bg && `background:${bg}`, bold && "font-weight:700", dim && "opacity:.6"].filter(Boolean).join(";");
    open = !!css;
    if (css) out += `<span style="${css}">`;
  };
  const parts = input.split(/\x1b\[([0-9;]*)m/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      out += esc(parts[i]!.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, ""));
      continue;
    }
    const codes = (parts[i] || "0").split(";").map(Number);
    for (let j = 0; j < codes.length; j++) {
      const c = codes[j]!;
      if (c === 0) (fg = bg = undefined), (bold = dim = false);
      else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 22) bold = dim = false;
      else if (c >= 30 && c <= 37) fg = BASIC[c - 30];
      else if (c >= 90 && c <= 97) fg = BRIGHT[c - 90];
      else if (c === 39) fg = undefined;
      else if (c >= 40 && c <= 47) bg = BASIC[c - 40];
      else if (c >= 100 && c <= 107) bg = BRIGHT[c - 100];
      else if (c === 49) bg = undefined;
      else if ((c === 38 || c === 48) && codes[j + 1] === 5) {
        const col = c256(codes[j + 2] ?? 0);
        c === 38 ? (fg = col) : (bg = col);
        j += 2;
      } else if ((c === 38 || c === 48) && codes[j + 1] === 2) {
        const col = `rgb(${codes[j + 2] ?? 0},${codes[j + 3] ?? 0},${codes[j + 4] ?? 0})`;
        c === 38 ? (fg = col) : (bg = col);
        j += 4;
      }
    }
    style();
  }
  if (open) out += "</span>";
  return out;
}
