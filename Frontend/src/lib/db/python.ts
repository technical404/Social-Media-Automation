// Talks to the local Python backend started by `python main.py` (SQLite file on disk).
import type { Driver } from "./types";

export const BACKEND_URL = (import.meta.env["VITE_LOCAL_BACKEND_URL"] as string | undefined) ?? "http://127.0.0.1:8765";

export type BackendHealth = {
  ok: boolean;
  version: string;
  db_path: string;
  schema: string;
  worker: { running: boolean; heartbeat_at: string | null };
};

export async function probeBackend(timeoutMs = 900): Promise<BackendHealth | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as BackendHealth;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

let token: string | null = null;

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!token) {
    const r = await fetch(`${BACKEND_URL}/api/session`);
    if (!r.ok) throw new Error("The local backend refused this page. Open the app from the address printed by main.py.");
    token = ((await r.json()) as { token: string }).token;
  }
  const headers = new Headers(init.headers);
  headers.set("X-SocialAI-Token", token);
  if (init.body && !(init.body instanceof Uint8Array) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `Local backend error (HTTP ${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await backendFetch(path, { method: "POST", body: JSON.stringify(body) });
  return (await res.json()) as T;
}

export function createPythonDriver(health: BackendHealth): Driver {
  return {
    mode: "python",
    location: `SQLite file on this PC: ${health.db_path}`,
    async all(sql, params = []) {
      return (await post<{ rows: never[] }>("/api/db/query", { sql, params })).rows;
    },
    async run(sql, params = []) {
      return { changes: (await post<{ changes: number }>("/api/db/query", { sql, params })).changes };
    },
    async tx(stmts) {
      await post("/api/db/batch", { statements: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
    },
    async exportBytes() {
      const res = await backendFetch("/api/backup/download");
      return new Uint8Array(await res.arrayBuffer());
    },
    async restoreBytes(bytes) {
      await backendFetch("/api/backup/restore", {
        method: "POST",
        body: bytes as unknown as BodyInit,
        headers: { "Content-Type": "application/octet-stream" },
      });
    },
    async integrity() {
      return (await post<{ result: string }>("/api/integrity", {})).result;
    },
  };
}
