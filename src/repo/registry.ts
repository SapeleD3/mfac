import { existsSync, statSync } from "node:fs";
import type { Engine } from "../workflow/engine.js";
import type { Row, Store } from "../workflow/store.js";
import { tryGit } from "./git.js";

export interface Repo {
  name: string;
  path: string;
  base: string;
  setup: string;
  about: string;
  isDefault: boolean;
}

export class Repos {
  constructor(
    private store: Store,
    private engine: Engine,
  ) {}

  list(): Repo[] {
    const def = this.engine.settings().defaultRepo;
    return (this.store.db.prepare("SELECT name, path, base, setup, about FROM repos ORDER BY name").all() as Row[]).map((r) => ({
      name: String(r.name),
      path: String(r.path),
      base: String(r.base),
      setup: String(r.setup ?? ""),
      about: String(r.about ?? ""),
      isDefault: r.name === def,
    }));
  }

  add(p: { path: string; name?: string; setup?: string; base?: string; about?: string }): Repo {
    const path = p.path?.trim().replace(/\/+$/, "");
    if (!path || !existsSync(path) || !statSync(path).isDirectory()) throw new Error(`${p.path} isn't a folder`);
    const name = p.name?.trim() || path.split("/").pop()!;
    this.store.db
      .prepare(
        `INSERT INTO repos (name, path, base, setup, about) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET path = excluded.path, base = excluded.base, setup = excluded.setup, about = CASE WHEN excluded.about = '' THEN repos.about ELSE excluded.about END`,
      )
      .run(name, path, p.base ?? "main", p.setup ?? "", p.about?.trim() ?? "");
    if (!this.engine.settings().defaultRepo) this.engine.updateSettings({ defaultRepo: name });
    return this.get(name)!;
  }

  update(name: string, patch: { about?: string; setup?: string; base?: string; isDefault?: boolean }): Repo {
    const r = this.get(name);
    if (!r) throw new Error(`no repo ${name}`);
    this.store.db.prepare("UPDATE repos SET about = ?, setup = ?, base = ? WHERE name = ?").run(patch.about?.trim() ?? r.about, patch.setup ?? r.setup, patch.base ?? r.base, name);
    if (patch.isDefault) this.engine.updateSettings({ defaultRepo: name });
    else if (patch.isDefault === false && r.isDefault) this.engine.updateSettings({ defaultRepo: undefined });
    return this.get(name)!;
  }

  remove(name: string) {
    if (!this.get(name)) throw new Error(`no repo ${name}`);
    this.store.db.prepare("DELETE FROM repos WHERE name = ?").run(name);
    if (this.engine.settings().defaultRepo === name) this.engine.updateSettings({ defaultRepo: this.list()[0]?.name });
    return { removed: name };
  }

  get(name: string): Repo | undefined {
    return this.list().find((r) => r.name === name);
  }

  /** A name or path the model gave, or a folder you picked; unknown names resolve to nothing so a guess never invents a path. */
  resolve(nameOrPath?: string | null): string | undefined {
    if (!nameOrPath) return undefined;
    return this.list().find((r) => r.name === nameOrPath || r.path === nameOrPath.replace(/\/+$/, ""))?.path;
  }

  mentionedIn(text: string): string | undefined {
    const hits = this.list().filter((r) => new RegExp(`(^|[^\\w-])${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`, "i").test(text));
    return hits.length === 1 ? hits[0]!.path : undefined;
  }

  defaultPath(): string | undefined {
    return this.list().find((r) => r.isDefault)?.path;
  }

  forPrompt(): string[] {
    return this.list().map((r) => `- ${r.name}${r.isDefault ? " (default)" : ""}: ${r.about || "no description"} [${r.path}]`);
  }
}

export const isGitRepo = (path: string) => tryGit(path, ["rev-parse", "--is-inside-work-tree"]).ok;
