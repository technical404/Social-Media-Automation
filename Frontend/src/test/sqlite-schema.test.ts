import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { MIGRATIONS } from "@/lib/db/migrations";
import { migrate, sqlAll, sqlRun } from "@/lib/db/sqljs-core";

async function freshDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  migrate(db, MIGRATIONS);
  db.run("INSERT INTO calendars(id, name, default_time) VALUES ('c1','Med','09:00')");
  return db;
}

describe("local SQLite schema", () => {
  it("applies migrations once and records them", async () => {
    const db = await freshDb();
    expect(migrate(db, MIGRATIONS)).toEqual([]);
    expect(sqlAll(db, "SELECT version FROM schema_migrations").length).toBe(MIGRATIONS.length);
  });
  it("blocks two events with the same name on the same date in one calendar", async () => {
    const db = await freshDb();
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e1','c1','World Health Day','2027-04-07','2027-04-07')");
    expect(() => db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e2','c1','world health day','2027-04-07','2027-04-07')")).toThrow(/UNIQUE/);
    // a different event on the same day is fine (multiple events per day)
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e3','c1','Nurses Day','2027-04-07','2027-04-07')");
  });
  it("rejects an end date before the start date", async () => {
    const db = await freshDb();
    expect(() => db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e1','c1','X','2027-04-07','2027-04-01')")).toThrow(/CHECK/);
  });
  it("deleting a calendar deletes its events", async () => {
    const db = await freshDb();
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e1','c1','X','2027-04-07','2027-04-07')");
    sqlRun(db, "DELETE FROM calendars WHERE id = 'c1'");
    expect(sqlAll(db, "SELECT * FROM events").length).toBe(0);
  });
  it("links a client's calendar through calendars.client_id", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO calendars(id, name, client_id) VALUES ('cc1','Acme calendar','cl1')");
    const rows = sqlAll<{ client_id: string }>(db, "SELECT client_id FROM calendars WHERE id = 'cc1'");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.client_id).toBe("cl1");
    // planner calendars (client_id NULL) are distinct from client calendars
    const owned = sqlAll(db, "SELECT id FROM calendars WHERE client_id IS NOT NULL");
    expect(owned.length).toBe(1);
  });
  it("removing a client's calendars cascades to their events", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO calendars(id, name, client_id) VALUES ('cc1','Acme calendar','cl1')");
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e1','cc1','X','2027-04-07','2027-04-07')");
    // mirrors repo.deleteClient: drop the client's calendars, then the client.
    // the seeded planner calendar 'c1' (client_id NULL) is untouched.
    sqlRun(db, "DELETE FROM calendars WHERE client_id = 'cl1'");
    sqlRun(db, "DELETE FROM clients WHERE id = 'cl1'");
    expect(sqlAll(db, "SELECT * FROM calendars").length).toBe(1);
    expect(sqlAll(db, "SELECT * FROM events").length).toBe(0);
    expect(sqlAll(db, "SELECT * FROM clients").length).toBe(0);
  });

  it("marks a calendar as global and defaults the rest to non-global", async () => {
    const db = await freshDb();
    db.run("INSERT INTO calendars(id, name, is_global, scope) VALUES ('g1','Global Calendar',1,'GLOBAL')");
    const rows = sqlAll<{ id: string; is_global: number; scope: string }>(db, "SELECT id, is_global, scope FROM calendars ORDER BY id");
    expect(rows.find((r) => r.id === "g1")).toMatchObject({ is_global: 1, scope: "GLOBAL" });
    expect(rows.find((r) => r.id === "c1")).toMatchObject({ is_global: 0, scope: "GLOBAL" });
  });

  it("keeps one row per observance code per year (a code repeats next year)", async () => {
    const db = await freshDb();
    const ins = (id: string, date: string) =>
      `INSERT INTO events(id, calendar_id, name, start_date, end_date, event_code) VALUES ('${id}','c1','India Independence Day','${date}','${date}','IN-INDIA-INDEPENDENCE-DAY-0815')`;
    db.run(ins("e1", "2026-08-15"));
    // same code + same year is refused, even with a different id
    expect(() => db.run(ins("e2", "2026-08-15"))).toThrow(/UNIQUE/);
    // the same code in another year is a new row
    db.run(ins("e3", "2027-08-15"));
    expect(sqlAll(db, "SELECT * FROM events WHERE event_code IS NOT NULL").length).toBe(2);
  });

  it("stores per-client state keyed by calendar and event", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO calendars(id, name, client_id, scope) VALUES ('cc1','Acme calendar','cl1','IN')");
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e1','c1','X','2027-04-07','2027-04-07')");
    db.run("INSERT INTO client_event_state(calendar_id, event_id, time_override, approval_status) VALUES ('cc1','e1','18:30','approved')");
    const rows = sqlAll<{ time_override: string; approval_status: string }>(db, "SELECT time_override, approval_status FROM client_event_state WHERE calendar_id = 'cc1' AND event_id = 'e1'");
    expect(rows[0]).toMatchObject({ time_override: "18:30", approval_status: "approved" });
  });

  it("lets a client own an event with the same name and date as a global one", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e1','c1','World Health Day','2027-04-07','2027-04-07')");
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date, client_id) VALUES ('e2','c1','World Health Day','2027-04-07','2027-04-07','cl1')");
    const rows = sqlAll<{ id: string; client_id: string | null }>(db, "SELECT id, client_id FROM events ORDER BY id");
    expect(rows).toEqual([{ id: "e1", client_id: null }, { id: "e2", client_id: "cl1" }]);
    // the same client cannot have two identical copies
    expect(() => db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date, client_id) VALUES ('e3','c1','world health day','2027-04-07','2027-04-07','cl1')")).toThrow(/UNIQUE/);
    expect(sqlAll(db, "SELECT * FROM events WHERE client_id = 'cl1'").length).toBe(1);
  });

  it("removing a client deletes its client-specific events", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date, client_id) VALUES ('e1','c1','Client only','2027-04-07','2027-04-07','cl1')");
    sqlRun(db, "DELETE FROM clients WHERE id = 'cl1'");
    expect(sqlAll(db, "SELECT * FROM events").length).toBe(0);
  });

  it("removing a client calendar drops its per-client state", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO calendars(id, name, client_id) VALUES ('cc1','Acme calendar','cl1')");
    db.run("INSERT INTO events(id, calendar_id, name, start_date, end_date) VALUES ('e1','c1','X','2027-04-07','2027-04-07')");
    db.run("INSERT INTO client_event_state(calendar_id, event_id, time_override) VALUES ('cc1','e1','18:30')");
    sqlRun(db, "DELETE FROM calendars WHERE id = 'cc1'");
    expect(sqlAll(db, "SELECT * FROM client_event_state").length).toBe(0);
  });

  it("stores topic fields and client ownership on posts", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO posts(id, client_id, platform, body, status, scheduled_at, topic, pillar, content_format) VALUES ('p1','cl1','instagram','Caption','draft','2027-02-01T10:00','Diabetes care','Education','Carousel')");
    const rows = sqlAll<{ client_id: string; topic: string; pillar: string; content_format: string }>(db, "SELECT client_id, topic, pillar, content_format FROM posts WHERE id = 'p1'");
    expect(rows[0]).toEqual({ client_id: "cl1", topic: "Diabetes care", pillar: "Education", content_format: "Carousel" });
    sqlRun(db, "DELETE FROM clients WHERE id = 'cl1'");
    expect(sqlAll(db, "SELECT * FROM posts").length).toBe(0);
  });

  it("defaults post topic fields and the generation-run kind", async () => {
    const db = await freshDb();
    db.run("INSERT INTO posts(id, body) VALUES ('p1','Hello')");
    const post = sqlAll<{ client_id: string | null; topic: string; pillar: string; content_format: string }>(db, "SELECT client_id, topic, pillar, content_format FROM posts WHERE id = 'p1'");
    expect(post[0]).toEqual({ client_id: null, topic: "", pillar: "", content_format: "" });
    db.run("INSERT INTO event_generation_runs(id, calendar_id, request, proposals, rejected) VALUES ('r1','c1','{}','[]','[]')");
    const run = sqlAll<{ kind: string }>(db, "SELECT kind FROM event_generation_runs WHERE id = 'r1'");
    expect(run[0]?.kind).toBe("events");
    db.run("INSERT INTO event_generation_runs(id, calendar_id, kind, request, proposals, rejected) VALUES ('r2','c1','topics','{}','[]','[]')");
    expect(sqlAll<{ kind: string }>(db, "SELECT kind FROM event_generation_runs WHERE id = 'r2'")[0]?.kind).toBe("topics");
  });

  it("stores a client theme and social handles, and removes handles with the client", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name, theme) VALUES ('cl1','Acme','Preventive health')");
    db.run("INSERT INTO client_social_handles(id, client_id, platform, handle, display_name) VALUES ('h1','cl1','instagram','@acme','Acme care')");
    db.run("INSERT INTO client_social_handles(id, client_id, platform, handle) VALUES ('h2','cl1','facebook','acme.page')");

    const client = sqlAll<{ theme: string }>(db, "SELECT theme FROM clients WHERE id = 'cl1'");
    expect(client[0]?.theme).toBe("Preventive health");
    const handles = sqlAll<{ platform: string; handle: string }>(db, "SELECT platform, handle FROM client_social_handles WHERE client_id = 'cl1' ORDER BY platform");
    expect(handles).toEqual([
      { platform: "facebook", handle: "acme.page" },
      { platform: "instagram", handle: "@acme" },
    ]);

    sqlRun(db, "DELETE FROM clients WHERE id = 'cl1'");
    expect(sqlAll(db, "SELECT * FROM client_social_handles").length).toBe(0);
  });

  it("keeps one OAuth app per platform scope and one connection per client and platform", async () => {
    const db = await freshDb();
    db.run("INSERT INTO clients(id, name) VALUES ('cl1','Acme')");
    db.run("INSERT INTO social_oauth_apps(id, platform, app_client_id) VALUES ('a1','facebook','workspace-app')");
    // one workspace app per platform
    expect(() => db.run("INSERT INTO social_oauth_apps(id, platform, app_client_id) VALUES ('a2','facebook','second-app')")).toThrow(/UNIQUE/);
    // a client-specific app may exist alongside the workspace app
    db.run("INSERT INTO social_oauth_apps(id, platform, client_id, app_client_id) VALUES ('a3','facebook','cl1','client-app')");
    expect(() => db.run("INSERT INTO social_oauth_apps(id, platform, client_id, app_client_id) VALUES ('a4','facebook','cl1','another-client-app')")).toThrow(/UNIQUE/);

    db.run("INSERT INTO social_connections(id, client_id, platform) VALUES ('s1','cl1','facebook')");
    expect(() => db.run("INSERT INTO social_connections(id, client_id, platform) VALUES ('s2','cl1','facebook')")).toThrow(/UNIQUE/);
    const conn = sqlAll<{ status: string; token_type: string }>(db, "SELECT status, token_type FROM social_connections WHERE id = 's1'");
    expect(conn[0]).toEqual({ status: "not_connected", token_type: "Bearer" });
    expect(() => db.run("INSERT INTO social_connections(id, client_id, platform, status) VALUES ('s3','cl1','linkedin','connected_fake')")).toThrow(/CHECK/);

    // removing the client removes its app and connection
    sqlRun(db, "DELETE FROM clients WHERE id = 'cl1'");
    expect(sqlAll(db, "SELECT * FROM social_connections").length).toBe(0);
    expect(sqlAll(db, "SELECT * FROM social_oauth_apps WHERE client_id IS NOT NULL").length).toBe(0);
    expect(sqlAll(db, "SELECT * FROM social_oauth_apps WHERE client_id IS NULL").length).toBe(1);
  });
});
