import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getDb } from "./db";
import { probeBackend } from "./db/python";
import * as repo from "./repo";

export const envQuery = queryOptions({
  queryKey: ["env"],
  queryFn: async () => {
    const db = await getDb();
    const health = db.mode === "python" ? await probeBackend(1500) : null;
    return { mode: db.mode, location: db.location, health };
  },
  refetchInterval: 20000,
});

export const settingsQuery = queryOptions({ queryKey: ["settings"], queryFn: repo.getSettings });

export const DEFAULT_TZ = "Asia/Kolkata";

export function useAppSettings() {
  const { data = {} } = useQuery(settingsQuery);
  return {
    timezone: data["timezone"] || DEFAULT_TZ,
    theme: (data["theme"] as "light" | "dark" | "system") || "light",
    notificationsSeenAt: data["notifications_seen_at"] || "",
    raw: data,
  };
}

/** Local DB changes can affect many screens; refresh them all (cheap for SQLite). */
export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
