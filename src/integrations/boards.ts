import type { Engine, IntakeBoard } from "../workflow/engine.js";
import type { Row, Store } from "../workflow/store.js";

export const READY = "Ready for agent";

/** The boards you watch; a board saved before several were possible counts as the first. */
export function boards(engine: Engine): IntakeBoard[] {
  const n = engine.settings().notion;
  if (n.boards) return n.boards;
  return n.intakeBoard ? [{ url: n.intakeBoard, name: n.intakeBoardName, server: n.intakeServer, status: n.intakeStatus || READY, columns: n.columns }] : [];
}

export function saveBoards(engine: Engine, list: IntakeBoard[]) {
  const { intakeBoard: _b, intakeBoardName: _n, intakeServer: _s, intakeStatus: _t, columns: _c, ...rest } = engine.settings().notion;
  engine.updateSettings({ notion: { ...rest, boards: list } });
}

export const boardLabel = (b: IntakeBoard) => b.name ?? b.url;

/** Finds a board by its name or link, ignoring case and emoji. */
export function findWatched(engine: Engine, nameOrUrl: string): IntakeBoard | undefined {
  const norm = (s: string) =>
    s
      .replace(/[^\p{L}\p{N}\s/:.-]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  return boards(engine).find((b) => b.url === nameOrUrl || (b.name && norm(b.name) === norm(nameOrUrl)));
}

/** The board a card came from, recorded on its intake item when it was queued. */
export function boardOfCard(store: Store, engine: Engine, pageId: string): IntakeBoard | undefined {
  const r = store.db.prepare("SELECT json_extract(meta, '$.board') AS board FROM intake WHERE source = 'notion' AND source_id = ? ORDER BY received_at DESC LIMIT 1").get(pageId) as Row | undefined;
  const all = boards(engine);
  return all.find((b) => b.url === r?.board) ?? (all.length === 1 ? all[0] : undefined);
}

export function rememberColumn(engine: Engine, url: string, milestone: keyof NonNullable<IntakeBoard["columns"]>, column: string) {
  saveBoards(
    engine,
    boards(engine).map((b) => (b.url === url ? { ...b, columns: { ...b.columns, [milestone]: column } } : b)),
  );
}
