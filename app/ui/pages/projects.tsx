import { useState } from "preact/hooks";
import { type Route, go } from "../app";
import { openUrl } from "../bridge";
import { Ic, Src, ago } from "../kit";
import { useCall } from "../store";
import type { Project, ProjectSummary, TimelineItem } from "../types";

const stateClass = (t: TimelineItem) => (t.state === "Done" ? "ok" : t.state === "Dropped" ? "" : t.column === "Needs you" || t.column === "PR ready" ? "warn" : t.column === "Running" ? "work" : "");

const month = (iso: string) => new Date(iso).toLocaleDateString([], { month: "long", year: "numeric" });

function ProjectCard({ p, on }: { p: ProjectSummary; on: boolean }) {
  return (
    <div class={`li ${on ? "on" : ""}`} style={{ gridTemplateColumns: "auto minmax(0,1fr)" }} onClick={() => go(`projects?p=${encodeURIComponent(p.path)}`)}>
      <Ic n="folders" s={16} />
      <div style={{ minWidth: 0 }}>
        <div class="li-t">
          {p.name}
          {p.isDefault && (
            <span class="chip" style={{ marginLeft: 6 }}>
              default
            </span>
          )}
        </div>
        <div class="li-s">
          <span>{p.counts.total} jobs</span>
          {p.counts.active > 0 && <span class="chip work">{p.counts.active} running</span>}
          {p.counts.waiting > 0 && <span class="chip warn">{p.counts.waiting} waiting on you</span>}
          {p.lastActivity && <span class="faint">{ago(p.lastActivity)}</span>}
        </div>
      </div>
    </div>
  );
}

function Item({ t, byId }: { t: TimelineItem; byId: Map<string, TimelineItem> }) {
  const link = (url: string, label: string, icon: string) => (
    <a href="#" onClick={(e) => (e.preventDefault(), e.stopPropagation(), openUrl(url))} title={url}>
      <Ic n={icon} s={13} /> {label}
    </a>
  );
  const ref = (id: string) => (
    <a href={`#task/${id}`} onClick={(e) => e.stopPropagation()} title={byId.get(id)?.title}>
      {id}
    </a>
  );
  return (
    <div class="li" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }} onClick={() => go(`task/${t.id}`)}>
      <span class={`chip ${stateClass(t)}`}>{t.state === "Done" ? "Done" : t.state === "Dropped" ? "Dropped" : t.column}</span>
      <div style={{ minWidth: 0 }}>
        <div class="li-t">
          {t.title}
          {t.kind === "research" && (
            <span class="chip" style={{ marginLeft: 6 }}>
              research
            </span>
          )}
        </div>
        {t.summary && (
          <div class="small dim" style={{ marginTop: 2 }}>
            {t.summary}
          </div>
        )}
        <div class="li-s">
          <span class="faint">{t.id}</span>
          <Src s={t.source} />
          {t.area && <span class="chip">{t.area}</span>}
          {t.parent && <span>continues {ref(t.parent)}</span>}
          {t.children.length > 0 && (
            <span>
              led to{" "}
              {t.children.map((c, i) => (
                <>
                  {i > 0 && ", "}
                  {ref(c)}
                </>
              ))}
            </span>
          )}
          {t.prUrl && link(t.prUrl, "pull request", "git-pull-request")}
          {t.sourceUrl && link(t.sourceUrl, "source", "external-link")}
          {t.files > 0 && <span class="faint">{t.files} files</span>}
        </div>
      </div>
      <span class="faint small">{ago(t.updatedAt)}</span>
    </div>
  );
}

function Timeline({ path }: { path: string }) {
  const { data: p, error } = useCall<Project>("projects.get", { path }, [path]);
  const [area, setArea] = useState<string>();
  if (error) return <div class="empty">{error}</div>;
  if (!p) return <div class="empty">Loading…</div>;
  const shown = p.tasks.filter((t) => !area || t.area === area);
  const byId = new Map(p.tasks.map((t) => [t.id, t]));
  const months: [string, TimelineItem[]][] = [];
  for (const t of shown) {
    const m = month(t.createdAt);
    const last = months[months.length - 1];
    if (last?.[0] === m) last[1].push(t);
    else months.push([m, [t]]);
  }
  return (
    <>
      <div class="main-h">
        <h2>{p.name}</h2>
        <span class="grow" />
        <span class="small dim">{p.about || p.path || "Tasks that didn't name a repo"}</span>
      </div>
      {p.areas.length > 1 && (
        <div class="seg" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          <button type="button" class={!area ? "on" : ""} onClick={() => setArea(undefined)}>
            All areas · {p.tasks.length}
          </button>
          {p.areas.map((a) => (
            <button type="button" key={a.name} class={area === a.name ? "on" : ""} onClick={() => setArea(a.name)}>
              {a.name} · {a.count}
            </button>
          ))}
        </div>
      )}
      {months.map(([m, ts]) => (
        <div key={m}>
          <div class="label" style={{ margin: "14px 0 6px" }}>
            {m} · {ts.length}
          </div>
          <div class="list">
            {ts.map((t) => (
              <Item key={t.id} t={t} byId={byId} />
            ))}
          </div>
        </div>
      ))}
      {shown.length === 0 && <div class="empty">No jobs here yet.</div>}
    </>
  );
}

export function Projects({ route }: { route: Route }) {
  const { data: list } = useCall<ProjectSummary[]>("projects.list");
  const picked = route.query.get("p") ?? list?.[0]?.path;
  return (
    <div class="pane-body">
      <main class="main" style={{ display: "grid", gridTemplateColumns: "260px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div>
          <div class="label" style={{ margin: "4px 0 6px" }}>
            Projects
          </div>
          <div class="list">
            {(list ?? []).map((p) => (
              <ProjectCard key={p.path} p={p} on={p.path === picked} />
            ))}
            {list?.length === 0 && <div class="empty">Add a repo in Settings and its jobs show up here.</div>}
          </div>
        </div>
        <div>{picked !== undefined ? <Timeline path={picked} /> : <div class="empty">Pick a project.</div>}</div>
      </main>
    </div>
  );
}
