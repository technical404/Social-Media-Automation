// API keys never go into the SQLite database or backups.
// Python mode: stored by the backend (Windows DPAPI-encrypted file). Browser mode: separate IndexedDB store.
import { getDb } from "./db";
import { backendFetch } from "./db/python";
import { idbGet, idbSet } from "./db/idb";

const STORE = "socialai-secrets";

export function keyHint(key: string) {
  return key.length > 4 ? `••••${key.slice(-4)}` : "••••";
}

export async function saveKey(providerId: string, key: string): Promise<void> {
  const db = await getDb();
  if (db.mode === "python") {
    await backendFetch("/api/secrets", { method: "POST", body: JSON.stringify({ provider_id: providerId, api_key: key }) });
  } else {
    await idbSet(STORE, providerId, key || undefined);
  }
}

/** Browser mode only — the Python backend never returns keys. */
export async function readBrowserKey(providerId: string): Promise<string | null> {
  return (await idbGet<string>(STORE, providerId)) ?? null;
}
