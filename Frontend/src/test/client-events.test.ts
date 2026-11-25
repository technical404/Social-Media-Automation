import initSqlJs from "sql.js";
import { MIGRATIONS } from "@/lib/db/migrations";
import { migrate, sqlAll, sqlRun, sqlTx } from "@/lib/db/sqljs-core";
import type { Proposal } from "@/lib/planner";
import * as repo from "@/lib/repo";

const h = vi.hoisted(() => ({
  db: null as { run(sql: string): unknown; exec(sql: string): unknown[] } | null,
  n: 0,
}));

vi.mock("@/lib/db", async () => {
  const { sqlAll, sqlRun, sqlTx } = await import("@/lib/db/sqljs-core");
  const db = () => h.db as unknown as Parameters<typeof sqlAll>[0];
  return {
    all: async (sql: string, params?: (string | number | null)[]) => (h.db ? sqlAll(db(), sql, params) : []),
    run: async (sql: string, params?: (string | number | null)[]) => (h.db ? sqlRun(db(), sql, params) : { changes: 0 }),
    tx: async (stmts: { sql: string; params?: (string | number | null)[] }[]) => {
      if (h.db) sqlTx(db(), stmts);
    },
    uid: () => `id-${++h.n}`,
    nowIso: () => "2026-11-25T00:00:00.000Z",
  };
});

const proposal = {
  key: "p1",
  selected: true,
  name: "Client-only AI event",
  short_description: "",
  detailed_description: "",
  category: "Awareness",
  start_date: "2026-12-01",
  end_date: "2026-12-01",
  importance: "medium",
  event_kind: "ai_suggestion",
  source_url: "",
  campaign_topic: "",
  content_format: "",
  hashtags: [],
  image_prompt: "",
  video_prompt: "",
} as unknown as Proposal;

async function freshDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  migrate(db, MIGRATIONS);
  db.run("INSERT INTO calendars(id, name, is_global) VALUES ('g1', 'Global Calendar', 1)");
  db.run("INSERT INTO clients(id, name, industry, theme, scope) VALUES ('cl1', 'test2', 'Beauty', '', 'GLOBAL')");
  db.run("INSERT INTO calendars(id, name, client_id) VALUES ('cc1', 'test2 calendar', 'cl1')");
  h.db = db as unknown as NonNullable<typeof h.db>;
  return db;
}

describe("client-owned AI events", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("shows a client-owned event even when it is stored on the client calendar", async () => {
    h.db!.run("INSERT INTO events(id, calendar_id, client_id, name, start_date, end_date) VALUES ('e1', 'cc1', 'cl1', 'Client event', '2026-12-01', '2026-12-01')");
    h.db!.run("INSERT INTO events(id, calendar_id, name, start_date, end_date, scope, industry) VALUES ('e2', 'g1', 'Shared event', '2026-12-02', '2026-12-02', 'GLOBAL', 'Beauty')");
    h.db!.run("INSERT INTO events(id, calendar_id, name, start_date, end_date, scope, industry) VALUES ('e3', 'g1', 'Other category', '2026-12-03', '2026-12-03', 'GLOBAL', 'Finance & banking')");
    h.db!.run("INSERT INTO events(id, calendar_id, name, start_date, end_date, scope) VALUES ('e4', 'g1', 'Uncategorised', '2026-12-04', '2026-12-04', 'GLOBAL')");

    const rows = await repo.listClientCalendarEvents("cc1");
    expect(rows.map((r) => r.id).sort()).toEqual(["e1", "e2"]);

    const globalView = await repo.listClientVisibleEvents("cl1");
    expect(globalView.map((r) => r.id).sort()).toEqual(["e1", "e2"]);
  });

  it("approves AI events into the Global Calendar when started from a client calendar", async () => {
    const cal = await repo.getCalendar("cc1");
    const run = {
      id: "r1",
      calendar_id: "cc1",
      kind: "events",
      request: JSON.stringify({ client_id: "cl1", client_name: "test2", industry: "Beauty", region: "", use_client_profile: true }),
    } as unknown as repo.GenerationRun;

    const saved = await repo.commitRun(run, cal!, [proposal], "cl1");
    expect(saved).toBe(1);

    const rows = sqlAll<{ calendar_id: string; client_id: string }>(h.db as unknown as Parameters<typeof sqlAll>[0], "SELECT calendar_id, client_id FROM events");
    expect(rows).toEqual([{ calendar_id: "g1", client_id: "cl1" }]);

    const visible = await repo.listClientCalendarEvents("cc1");
    expect(visible.map((r) => r.name)).toEqual(["Client-only AI event"]);
  });
});
