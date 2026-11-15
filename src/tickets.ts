import { randomUUID } from "node:crypto";
import type { Engine } from "./engine.js";
import type { PluginFactory } from "./factoryd.js";
import { type Row, type Store, now, opt, parseJson } from "./store.js";

export const TICKET_STATUSES = ["Backlog", "In progress", "In review", "Blocked", "Done"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface Ticket {
  id: string;
  taskId: string;
  title: string;
  createdBy: string;
  pickedUpBy?: string;
  status: TicketStatus;
  tags: string[];
  check: string;
  links: Record<string, string>;
  notionPageId?: string;
  createdAt: string;
  updatedAt: string;
}

const toTicket = (r: Row): Ticket => ({
  id: String(r.id),
  taskId: String(r.task_id),
  title: String(r.title),
  createdBy: String(r.created_by),
  pickedUpBy: opt(r.picked_up_by),
  status: r.status as TicketStatus,
  tags: parseJson(r.tags, []),
  check: String(r.check_text ?? ""),
  links: parseJson(r.links, {}),
  notionPageId: opt(r.notion_page_id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export class Tickets {
  constructor(
    private store: Store,
    private engine: Engine,
  ) {}

  list(taskId?: string): Ticket[] {
    const rows = taskId ? this.store.db.prepare("SELECT * FROM tickets WHERE task_id = ? ORDER BY created_at").all(taskId) : this.store.db.prepare("SELECT * FROM tickets ORDER BY created_at").all();
    return (rows as Row[]).map(toTicket);
  }

  get(id: string): Ticket | undefined {
    const r = this.store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as Row | undefined;
    return r ? toTicket(r) : undefined;
  }

  add(input: { taskId: string; title: string; createdBy: string; pickedUpBy?: string; check?: string; tags?: string[] }): Ticket {
    const task = this.engine.get(input.taskId);
    if (!task) throw new Error(`no task ${input.taskId}`);
    if (!input.title?.trim()) throw new Error("a ticket needs a title");
    const n = this.list(input.taskId).length + 1;
    const id = `${input.taskId}-T${n}`;
    const t = now();
    this.store.db
      .prepare("INSERT INTO tickets (id, task_id, title, created_by, picked_up_by, status, tags, check_text, links, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Backlog', ?, ?, '{}', ?, ?)")
      .run(id, input.taskId, input.title.trim(), input.createdBy, input.pickedUpBy ?? null, JSON.stringify(input.tags ?? task.tags), input.check ?? "", t, t);
    const ticket = this.get(id)!;
    this.engine.emit("ticket", { ticket });
    return ticket;
  }

  update(id: string, patch: Partial<Pick<Ticket, "status" | "pickedUpBy" | "title" | "check" | "notionPageId" | "links">>): Ticket {
    const cur = this.get(id);
    if (!cur) throw new Error(`no ticket ${id}`);
    if (patch.status && !(TICKET_STATUSES as readonly string[]).includes(patch.status)) throw new Error(`status must be one of ${TICKET_STATUSES.join(", ")}`);
    const next = { ...cur, ...patch };
    this.store.db
      .prepare("UPDATE tickets SET title = ?, status = ?, picked_up_by = ?, check_text = ?, links = ?, notion_page_id = ?, updated_at = ? WHERE id = ?")
      .run(next.title, next.status, next.pickedUpBy ?? null, next.check, JSON.stringify(next.links), next.notionPageId ?? null, now(), id);
    const ticket = this.get(id)!;
    this.engine.emit("ticket", { ticket });
    return ticket;
  }
}

export const ticketsPart: PluginFactory = ({ engine, store }) => {
  const tickets = new Tickets(store, engine);
  return {
    name: "tickets",
    api: {
      "ticket.list": (p: { task?: string }) => tickets.list(p.task),
      "ticket.add": (p: { task: string; title: string; createdBy?: string; pickedUpBy?: string; check?: string; tags?: string[] }) =>
        tickets.add({ taskId: p.task, title: p.title, createdBy: p.createdBy ?? "you", pickedUpBy: p.pickedUpBy, check: p.check, tags: p.tags }),
      "ticket.update": (p: { id: string; patch: Parameters<Tickets["update"]>[1] }) => tickets.update(p.id, p.patch),
    },
  };
};

export const newId = () => randomUUID().slice(0, 8);
