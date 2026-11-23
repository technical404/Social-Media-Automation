// Picks the storage engine once per page load: the Python backend when it answers, otherwise SQLite in the browser.
import type { Driver, SqlValue, Row, Stmt } from "./types";
import { createPythonDriver, probeBackend, type BackendHealth } from "./python";

let driverPromise: Promise<Driver> | null = null;
let lastHealth: BackendHealth | null = null;

export function getDb(): Promise<Driver> {
  if (typeof window === "undefined") return Promise.reject(new Error("Local database is only available in the app window."));
  if (!driverPromise) {
    driverPromise = (async () => {
      const health = await probeBackend();
      lastHealth = health;
      if (health?.ok) return createPythonDriver(health);
      const { openBrowserDriver } = await import("./browser");
      return openBrowserDriver();
    })();
    driverPromise.catch(() => (driverPromise = null));
  }
  return driverPromise;
}

export function backendHealthAtStart() {
  return lastHealth;
}

export async function all<T = Row>(sql: string, params?: SqlValue[]) {
  return (await getDb()).all<T>(sql, params);
}
export async function run(sql: string, params?: SqlValue[]) {
  return (await getDb()).run(sql, params);
}
export async function tx(stmts: Stmt[]) {
  return (await getDb()).tx(stmts);
}

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export type { Driver, Row, SqlValue, Stmt };
