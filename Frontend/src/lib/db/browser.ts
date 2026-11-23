// SQLite inside the browser (sql.js / WebAssembly), saved to IndexedDB after every write.
import type { Database } from "sql.js";
import { MIGRATIONS } from "./migrations";
import { migrate, sqlAll, sqlRun, sqlTx } from "./sqljs-core";
import { idbGet, idbSet } from "./idb";
import type { Driver } from "./types";

const STORE = "socialai-studio";
const KEY = "sqlite";

export async function openBrowserDriver(): Promise<Driver> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await idbGet<Uint8Array>(STORE, KEY);
  let db: Database = saved ? new SQL.Database(saved) : new SQL.Database();
  migrate(db, MIGRATIONS);
  await idbSet(STORE, KEY, db.export());

  let pending: Promise<void> = Promise.resolve();
  const persist = () => {
    pending = pending.then(() => idbSet(STORE, KEY, db.export()));
    return pending;
  };

  return {
    mode: "browser",
    location: "This browser's private storage (SQLite in IndexedDB)",
    async all(sql, params) {
      return sqlAll(db, sql, params);
    },
    async run(sql, params) {
      const r = sqlRun(db, sql, params);
      await persist();
      return r;
    },
    async tx(stmts) {
      sqlTx(db, stmts);
      await persist();
    },
    async exportBytes() {
      return db.export();
    },
    async restoreBytes(bytes) {
      const next = new SQL.Database(bytes);
      const ok = sqlAll<{ integrity_check: string }>(next, "PRAGMA integrity_check")[0]?.integrity_check;
      if (ok !== "ok") throw new Error(`Backup file failed the integrity check: ${ok}`);
      migrate(next, MIGRATIONS);
      db.close();
      db = next;
      await persist();
    },
    async integrity() {
      return String(sqlAll<{ integrity_check: string }>(db, "PRAGMA integrity_check")[0]?.integrity_check ?? "unknown");
    },
  };
}
