// Engine-agnostic helpers around a sql.js Database (used in the browser and in unit tests).
import type { Database } from "sql.js";
import type { Migration } from "./migrations";
import type { Row, SqlValue, Stmt } from "./types";

export function sqlAll<T = Row>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const st = db.prepare(sql);
  try {
    st.bind(params);
    const out: T[] = [];
    while (st.step()) out.push(st.getAsObject() as T);
    return out;
  } finally {
    st.free();
  }
}

export function sqlRun(db: Database, sql: string, params: SqlValue[] = []): { changes: number } {
  db.run(sql, params);
  return { changes: db.getRowsModified() };
}

export function sqlTx(db: Database, stmts: Stmt[]) {
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.run(s.sql, s.params ?? []);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Apply pending migrations in order; returns versions applied now. */
export function migrate(db: Database, migrations: Migration[]): string[] {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  const done = new Set(sqlAll<{ version: string }>(db, "SELECT version FROM schema_migrations").map((r) => r.version));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql.replace(/PRAGMA\s+foreign_keys\s*=\s*ON\s*;/gi, ""));
      db.run("INSERT INTO schema_migrations(version) VALUES (?)", [m.version]);
      db.exec("COMMIT");
      applied.push(m.version);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${m.version} failed: ${(e as Error).message}`);
    }
  }
  return applied;
}
