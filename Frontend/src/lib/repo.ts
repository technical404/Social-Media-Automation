// Data access for the local SQLite database (same SQL on both engines).
import { all, run, tx, uid, nowIso, type Stmt } from "./db";
import type { Proposal, PlanRequest } from "./planner";
import type { ContentPlanRequest, TopicProposal } from "./content-planner";
import { builtinEventsFor, eventCode } from "./global-calendar";

export type Calendar = {
  id: string;
  name: string;
  industry: string;
  region: string;
  theme: string;
  default_time: string;
  timezone: string;
  client_id: string | null;
  is_global: number;
  scope: string;
  created_at: string;
  updated_at: string;
  event_count?: number;
  next_date?: string | null;
};

export type EventRow = {
  id: string;
  calendar_id: string;
  client_id: string | null;
  name: string;
  short_description: string;
  detailed_description: string;
  category: string;
  industry: string;
  region: string;
  start_date: string;
  end_date: string;
  importance: string;
  event_kind: string;
  source_url: string;
  verification_status: string;
  campaign_topic: string;
  content_format: string;
  hashtags: string;
  image_prompt: string;
  video_prompt: string;
  platforms: string;
  time_override: string | null;
  event_status: string;
  approval_status: string;
  publish_status: string;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  event_code?: string | null;
  scope?: string;
  calendar_name?: string;
  default_time?: string;
  timezone?: string;
};

export type Provider = {
  id: string;
  name: string;
  provider_type: string;
  protocol: string;
  base_url: string;
  model_id: string;
  context_window: number | null;
  max_output: number;
  thinking_effort: string;
  image_input: number;
  timeout_ms: number;
  retry_count: number;
  enabled: number;
  is_default: number;
  fallback_priority: number;
  has_api_key: number;
  api_key_hint: string | null;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_ms: number | null;
  last_test_message: string | null;
};

export type ActivityRow = { id: string; action: string; entity_type: string; entity_id: string | null; summary: string; level: string; created_at: string };

export type GenerationRun = {
  id: string;
  calendar_id: string;
  kind: string;
  request: string;
  provider_name: string | null;
  model: string | null;
  proposals: string;
  rejected: string;
  status: string;
  created_at: string;
};

// ---------- activity ----------
export function activityStmt(action: string, summary: string, opts: { entity_type?: string; entity_id?: string | null; level?: string } = {}): Stmt {
  return {
    sql: "INSERT INTO activity_logs(id, action, entity_type, entity_id, summary, level) VALUES (?,?,?,?,?,?)",
    params: [uid(), action, opts.entity_type ?? "", opts.entity_id ?? null, summary, opts.level ?? "info"],
  };
}
export async function logActivity(action: string, summary: string, opts: Parameters<typeof activityStmt>[2] = {}) {
  const s = activityStmt(action, summary, opts);
  await run(s.sql, s.params);
}
export const listActivity = (limit = 200) =>
  all<ActivityRow>("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?", [limit]);

// ---------- settings ----------
export async function getSettings(): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM app_settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export async function setSetting(key: string, value: string) {
  await run(
    "INSERT INTO app_settings(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, value, nowIso()],
  );
}

// ---------- calendars ----------
export const listCalendars = () =>
  all<Calendar>(
    `SELECT c.*, (SELECT COUNT(*) FROM events e WHERE e.calendar_id = c.id) AS event_count,
            (SELECT MIN(start_date) FROM events e WHERE e.calendar_id = c.id AND e.start_date >= date('now')) AS next_date
     FROM calendars c WHERE c.client_id IS NULL AND c.is_global = 0 ORDER BY c.created_at DESC`,
  );
export const listCalendarsByClient = (clientId: string) =>
  all<Calendar>(
    `SELECT c.*, (SELECT COUNT(*) FROM events e WHERE e.calendar_id = c.id) AS event_count,
            (SELECT MIN(start_date) FROM events e WHERE e.calendar_id = c.id AND e.start_date >= date('now')) AS next_date
     FROM calendars c WHERE c.client_id = ? AND c.is_global = 0 ORDER BY c.created_at DESC`,
    [clientId],
  );
export async function getCalendar(id: string): Promise<Calendar | null> {
  return (await all<Calendar>("SELECT * FROM calendars WHERE id = ?", [id]))[0] ?? null;
}
export async function createCalendar(c: Pick<Calendar, "name" | "industry" | "region" | "theme" | "default_time" | "timezone"> & { client_id?: string | null; scope?: string }) {
  const id = uid();
  await tx([
    {
      sql: "INSERT INTO calendars(id, name, industry, region, theme, default_time, timezone, client_id, scope) VALUES (?,?,?,?,?,?,?,?,?)",
      params: [id, c.name, c.industry, c.region, c.theme, c.default_time, c.timezone, c.client_id ?? null, c.scope ?? "GLOBAL"],
    },
    activityStmt("calendar.created", `Created calendar "${c.name}"`, { entity_type: "calendar", entity_id: id, level: "success" }),
  ]);
  return id;
}
export async function updateCalendar(id: string, patch: Partial<Pick<Calendar, "name" | "industry" | "region" | "theme" | "default_time" | "timezone">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  await run(
    `UPDATE calendars SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    [...keys.map((k) => patch[k] as string), nowIso(), id],
  );
}
export async function deleteCalendar(id: string, name: string) {
  await tx([
    { sql: "DELETE FROM calendars WHERE id = ?", params: [id] },
    activityStmt("calendar.deleted", `Deleted calendar "${name}" and its events`, { entity_type: "calendar", entity_id: id, level: "warning" }),
  ]);
}

/** True for a client calendar: it references global events and stores its own state separately. */
export async function isReferenceCalendar(calendarId?: string | null): Promise<boolean> {
  if (!calendarId) return false;
  const cal = await getCalendar(calendarId);
  return !!cal && !cal.is_global && !!cal.client_id;
}

type StateRow = { event_id: string; time_override: string | null; approval_status: string | null; publish_status: string | null; category: string | null; hidden: number };

/** Insert-or-update one per-client override row. Called only for client (reference) calendars. */
async function upsertState(calendarId: string, eventId: string, patch: Partial<Omit<StateRow, "event_id">>) {
  const exists = (await all<{ n: number }>("SELECT COUNT(*) AS n FROM client_event_state WHERE calendar_id = ? AND event_id = ?", [calendarId, eventId]))[0]?.n;
  if (!exists) await run("INSERT INTO client_event_state(calendar_id, event_id) VALUES (?,?)", [calendarId, eventId]);
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  await run(
    `UPDATE client_event_state SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE calendar_id = ? AND event_id = ?`,
    [...keys.map((k) => patch[k] ?? null), nowIso(), calendarId, eventId],
  );
}

export async function snapshotSchedule(calId: string) {
  const cal = await getCalendar(calId);
  if (!cal) return;
  if (cal.client_id && !cal.is_global) {
    const states = await all<StateRow>("SELECT event_id, time_override, approval_status, publish_status, category, hidden FROM client_event_state WHERE calendar_id = ?", [calId]);
    await setSetting(`schedule_undo:${calId}`, JSON.stringify({ mode: "client", default_time: cal.default_time, timezone: cal.timezone, states, at: nowIso() }));
    return;
  }
  const rows = await all<{ id: string; time_override: string | null; publish_status: string; start_date: string }>(
    "SELECT id, time_override, publish_status, start_date FROM events WHERE calendar_id = ?",
    [calId],
  );
  await setSetting(
    `schedule_undo:${calId}`,
    JSON.stringify({ mode: "global", default_time: cal.default_time, timezone: cal.timezone, events: rows, at: nowIso() }),
  );
}

export async function undoLastSchedule(calId: string): Promise<boolean> {
  const raw = (await getSettings())[`schedule_undo:${calId}`];
  if (!raw) return false;
  const snap = JSON.parse(raw) as
    | { mode: "client"; default_time: string; timezone: string; states: StateRow[] }
    | { mode: "global"; default_time: string; timezone: string; events: { id: string; time_override: string | null; publish_status: string }[] };
  await snapshotSchedule(calId);
  if (snap.mode === "client") {
    const stmts: Stmt[] = [
      { sql: "DELETE FROM client_event_state WHERE calendar_id = ?", params: [calId] },
      { sql: "UPDATE calendars SET default_time = ?, timezone = ?, updated_at = ? WHERE id = ?", params: [snap.default_time, snap.timezone, nowIso(), calId] },
      ...snap.states.map((s) => ({
        sql: "INSERT INTO client_event_state(calendar_id, event_id, time_override, approval_status, publish_status, category, hidden) VALUES (?,?,?,?,?,?,?)",
        params: [calId, s.event_id, s.time_override, s.approval_status, s.publish_status, s.category, s.hidden],
      })),
      activityStmt("schedule.undo", `Restored previous schedule (default ${snap.default_time})`, { entity_type: "calendar", entity_id: calId }),
    ];
    await tx(stmts);
    return true;
  }
  const stmts: Stmt[] = [
    { sql: "UPDATE calendars SET default_time = ?, timezone = ?, updated_at = ? WHERE id = ?", params: [snap.default_time, snap.timezone, nowIso(), calId] },
  ];
  for (const e of snap.events) {
    stmts.push({
      sql: "UPDATE events SET time_override = ?, publish_status = ?, updated_at = ? WHERE id = ? AND calendar_id = ?",
      params: [e.time_override, e.publish_status, nowIso(), e.id, calId],
    });
  }
  stmts.push(activityStmt("schedule.undo", `Restored previous schedule (default ${snap.default_time})`, { entity_type: "calendar", entity_id: calId }));
  await tx(stmts);
  return true;
}

/** Set the calendar's default time. Optionally also clear every per-date override. */
export async function applyDefaultTime(calId: string, time: string, resetOverrides: boolean) {
  await snapshotSchedule(calId);
  if (await isReferenceCalendar(calId)) {
    const stmts: Stmt[] = [{ sql: "UPDATE calendars SET default_time = ?, updated_at = ? WHERE id = ?", params: [time, nowIso(), calId] }];
    if (resetOverrides) stmts.push({ sql: "DELETE FROM client_event_state WHERE calendar_id = ? AND time_override IS NOT NULL", params: [calId] });
    stmts.push(activityStmt("schedule.default_time", `Default posting time set to ${time}${resetOverrides ? " (overrides cleared)" : ""}`, { entity_type: "calendar", entity_id: calId }));
    await tx(stmts);
    return;
  }
  const stmts: Stmt[] = [{ sql: "UPDATE calendars SET default_time = ?, updated_at = ? WHERE id = ?", params: [time, nowIso(), calId] }];
  if (resetOverrides) stmts.push({ sql: "UPDATE events SET time_override = NULL, updated_at = ? WHERE calendar_id = ?", params: [nowIso(), calId] });
  stmts.push(activityStmt("schedule.default_time", `Default posting time set to ${time}${resetOverrides ? " (overrides cleared)" : ""}`, { entity_type: "calendar", entity_id: calId }));
  await tx(stmts);
}

// ---------- events ----------
const EVENT_SELECT = `SELECT e.*, c.name AS calendar_name, c.default_time AS default_time, c.timezone AS timezone
  FROM events e JOIN calendars c ON c.id = e.calendar_id`;

export const listEvents = (calendarId: string | null) =>
  calendarId
    ? all<EventRow>(`${EVENT_SELECT} WHERE e.calendar_id = ? AND e.client_id IS NULL ORDER BY e.start_date, e.name`, [calendarId])
    : all<EventRow>(`${EVENT_SELECT} WHERE e.client_id IS NULL ORDER BY e.start_date, e.name`);

export const searchEvents = (q: string) =>
  all<EventRow>(`${EVENT_SELECT} WHERE e.client_id IS NULL AND (e.name LIKE ? OR e.short_description LIKE ?) ORDER BY e.start_date LIMIT 20`, [`%${q}%`, `%${q}%`]);

export type EventInput = Pick<
  EventRow,
  "name" | "short_description" | "detailed_description" | "category" | "start_date" | "end_date" | "importance" | "event_kind" | "source_url" | "verification_status" | "campaign_topic" | "content_format"
> & { time_override: string | null; hashtags: string[]; platforms: string[]; scope?: string };

export async function createEvent(calendarId: string, ev: EventInput) {
  const id = uid();
  const scope = ev.scope ?? "GLOBAL";
  await tx([
    {
      sql: `INSERT INTO events(id, calendar_id, name, short_description, detailed_description, category, start_date, end_date, importance, event_kind, source_url, verification_status, campaign_topic, content_format, hashtags, platforms, time_override, scope, event_code, approval_status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_review')`,
      params: [id, calendarId, ev.name, ev.short_description, ev.detailed_description, ev.category, ev.start_date, ev.end_date, ev.importance, ev.event_kind, ev.source_url, ev.verification_status, ev.campaign_topic, ev.content_format, JSON.stringify(ev.hashtags), JSON.stringify(ev.platforms), ev.time_override, scope, eventCode(scope, ev.name, ev.start_date)],
    },
    activityStmt("event.created", `Added "${ev.name}" on ${ev.start_date}`, { entity_type: "event", entity_id: id }),
  ]);
  return id;
}

/** Any edit to content or dates sends the event back to review. */
export async function updateEvent(id: string, ev: EventInput) {
  await tx([
    {
      sql: `UPDATE events SET name=?, short_description=?, detailed_description=?, category=?, start_date=?, end_date=?, importance=?, event_kind=?, source_url=?, verification_status=?, campaign_topic=?, content_format=?, hashtags=?, platforms=?, time_override=?,
            approval_status='pending_review', approved_at=NULL, publish_status = CASE WHEN publish_status = 'scheduled' THEN 'not_scheduled' ELSE publish_status END, updated_at=? WHERE id=?`,
      params: [ev.name, ev.short_description, ev.detailed_description, ev.category, ev.start_date, ev.end_date, ev.importance, ev.event_kind, ev.source_url, ev.verification_status, ev.campaign_topic, ev.content_format, JSON.stringify(ev.hashtags), JSON.stringify(ev.platforms), ev.time_override, nowIso(), id],
    },
    activityStmt("event.edited", `Edited "${ev.name}" — needs review again`, { entity_type: "event", entity_id: id, level: "warning" }),
  ]);
}

const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

export async function setTimeForEvents(ids: string[], time: string | null, calendarId?: string | null) {
  if (!ids.length) return;
  if (await isReferenceCalendar(calendarId)) {
    await snapshotSchedule(calendarId!);
    for (const id of ids) await upsertState(calendarId!, id, { time_override: time });
    await logActivity("schedule.override", time ? `Set ${ids.length} event(s) to ${time}` : `Reset ${ids.length} event(s) to the default time`);
    return;
  }
  const cal = await all<{ calendar_id: string }>(`SELECT DISTINCT calendar_id FROM events WHERE id IN (${ph(ids.length)})`, ids);
  for (const c of cal) await snapshotSchedule(c.calendar_id);
  await tx([
    { sql: `UPDATE events SET time_override = ?, updated_at = ? WHERE id IN (${ph(ids.length)})`, params: [time, nowIso(), ...ids] },
    activityStmt("schedule.override", time ? `Set ${ids.length} event(s) to ${time}` : `Reset ${ids.length} event(s) to the default time`),
  ]);
}

export async function setTimeForDates(calendarId: string, dates: string[], time: string) {
  if (!dates.length) return 0;
  if (await isReferenceCalendar(calendarId)) {
    const rows = await listClientCalendarEvents(calendarId);
    const ids = rows.filter((e) => dates.includes(e.start_date)).map((e) => e.id);
    await setTimeForEvents(ids, time, calendarId);
    return ids.length;
  }
  const r = await all<{ id: string }>(`SELECT id FROM events WHERE calendar_id = ? AND start_date IN (${ph(dates.length)})`, [calendarId, ...dates]);
  await setTimeForEvents(r.map((x) => x.id), time);
  return r.length;
}

export async function setCategoryForEvents(ids: string[], category: string, calendarId?: string | null) {
  if (await isReferenceCalendar(calendarId)) {
    for (const id of ids) await upsertState(calendarId!, id, { category, approval_status: "pending_review", publish_status: "not_scheduled" });
    await logActivity("event.bulk_category", `Changed category of ${ids.length} event(s) to ${category} — needs review again`, { level: "warning" });
    return;
  }
  await tx([
    { sql: `UPDATE events SET category = ?, approval_status = 'pending_review', approved_at = NULL, publish_status = CASE WHEN publish_status = 'scheduled' THEN 'not_scheduled' ELSE publish_status END, updated_at = ? WHERE id IN (${ph(ids.length)})`, params: [category, nowIso(), ...ids] },
    activityStmt("event.bulk_category", `Changed category of ${ids.length} event(s) to ${category} — needs review again`, { level: "warning" }),
  ]);
}

export async function approveEvents(ids: string[], calendarId?: string | null) {
  if (await isReferenceCalendar(calendarId)) {
    for (const id of ids) await upsertState(calendarId!, id, { approval_status: "approved" });
    await logActivity("event.approved", `Approved ${ids.length} event(s)`, { level: "success" });
    return;
  }
  await tx([
    { sql: `UPDATE events SET approval_status = 'approved', approved_at = ?, updated_at = ? WHERE id IN (${ph(ids.length)})`, params: [nowIso(), nowIso(), ...ids] },
    activityStmt("event.approved", `Approved ${ids.length} event(s)`, { level: "success" }),
  ]);
}

/** Only approved events can be scheduled — unapproved ones are skipped by the SQL itself. */
export async function scheduleEvents(ids: string[], calendarId?: string | null): Promise<{ scheduled: number; skipped: number }> {
  if (!ids.length) return { scheduled: 0, skipped: 0 };
  if (await isReferenceCalendar(calendarId)) {
    const rows = await listClientCalendarEvents(calendarId!);
    const byId = new Map(rows.map((e) => [e.id, e]));
    const ok = ids.filter((id) => byId.get(id)?.approval_status === "approved" && byId.get(id)?.publish_status === "not_scheduled");
    if (ok.length) {
      await snapshotSchedule(calendarId!);
      for (const id of ok) await upsertState(calendarId!, id, { publish_status: "scheduled" });
      await logActivity("schedule.saved", `Scheduled ${ok.length} approved event(s)`, { level: "success" });
    }
    return { scheduled: ok.length, skipped: ids.length - ok.length };
  }
  const ok = await all<{ id: string }>(`SELECT id FROM events WHERE approval_status = 'approved' AND publish_status = 'not_scheduled' AND id IN (${ph(ids.length)})`, ids);
  if (ok.length) {
    const cals = await all<{ calendar_id: string }>(`SELECT DISTINCT calendar_id FROM events WHERE id IN (${ph(ok.length)})`, ok.map((x) => x.id));
    for (const c of cals) await snapshotSchedule(c.calendar_id);
    await tx([
      { sql: `UPDATE events SET publish_status = 'scheduled', updated_at = ? WHERE approval_status = 'approved' AND id IN (${ph(ok.length)})`, params: [nowIso(), ...ok.map((x) => x.id)] },
      activityStmt("schedule.saved", `Scheduled ${ok.length} approved event(s)`, { level: "success" }),
    ]);
  }
  return { scheduled: ok.length, skipped: ids.length - ok.length };
}

export async function unscheduleEvents(ids: string[], calendarId?: string | null) {
  if (await isReferenceCalendar(calendarId)) {
    for (const id of ids) await upsertState(calendarId!, id, { publish_status: "not_scheduled" });
    await logActivity("schedule.removed", `Unscheduled ${ids.length} event(s)`);
    return;
  }
  await tx([
    { sql: `UPDATE events SET publish_status = 'not_scheduled', updated_at = ? WHERE publish_status = 'scheduled' AND id IN (${ph(ids.length)})`, params: [nowIso(), ...ids] },
    activityStmt("schedule.removed", `Unscheduled ${ids.length} event(s)`),
  ]);
}

export async function deleteEvents(ids: string[], calendarId?: string | null) {
  if (!ids.length) return;
  if (await isReferenceCalendar(calendarId)) {
    // Client-specific events belong to the client, so deleting them removes the
    // row. Shared Global Calendar events can only be hidden for this client.
    const owned = await all<{ id: string }>(`SELECT id FROM events WHERE client_id IS NOT NULL AND id IN (${ph(ids.length)})`, ids);
    const ownedIds = new Set(owned.map((r) => r.id));
    const hiddenIds = ids.filter((id) => !ownedIds.has(id));
    const parts: string[] = [];
    if (ownedIds.size) {
      await run(`DELETE FROM events WHERE id IN (${ph(ownedIds.size)})`, [...ownedIds]);
      parts.push(`deleted ${ownedIds.size} client event(s)`);
    }
    if (hiddenIds.length) {
      for (const id of hiddenIds) await upsertState(calendarId!, id, { hidden: 1 });
      parts.push(`hid ${hiddenIds.length} global event(s)`);
    }
    await logActivity("event.removed_from_client", `Removed ${parts.join(" and ")} from this client's calendar`, { level: "warning" });
    return;
  }
  await tx([
    { sql: `DELETE FROM events WHERE id IN (${ph(ids.length)})`, params: ids },
    activityStmt("event.deleted", `Deleted ${ids.length} event(s)`, { level: "warning" }),
  ]);
}

// ---------- AI generation runs (preview state) ----------
export async function saveRun(
  calendarId: string,
  req: PlanRequest | ContentPlanRequest,
  meta: { provider: string; model: string },
  accepted: unknown[],
  rejected: unknown[],
  kind: "events" | "topics" = "events",
) {
  const id = uid();
  await tx([
    { sql: "UPDATE event_generation_runs SET status = 'discarded' WHERE calendar_id = ? AND kind = ? AND status = 'preview'", params: [calendarId, kind] },
    {
      sql: "INSERT INTO event_generation_runs(id, calendar_id, kind, request, provider_name, model, proposals, rejected) VALUES (?,?,?,?,?,?,?,?)",
      params: [id, calendarId, kind, JSON.stringify(req), meta.provider, meta.model, JSON.stringify(accepted), JSON.stringify(rejected)],
    },
    activityStmt("ai.proposed", `AI proposed ${accepted.length} ${kind === "topics" ? "content topic(s)" : "event(s)"} (${rejected.length} rejected by validation) via ${meta.provider}`, { entity_type: "calendar", entity_id: calendarId }),
  ]);
  return id;
}
export async function getPreviewRun(calendarId: string, kind: "events" | "topics" = "events"): Promise<GenerationRun | null> {
  return (await all<GenerationRun>("SELECT * FROM event_generation_runs WHERE calendar_id = ? AND kind = ? AND status = 'preview' ORDER BY created_at DESC LIMIT 1", [calendarId, kind]))[0] ?? null;
}
export async function updateRunProposals(runId: string, proposals: unknown[]) {
  await run("UPDATE event_generation_runs SET proposals = ? WHERE id = ?", [JSON.stringify(proposals), runId]);
}
export async function discardRun(runId: string) {
  await tx([
    { sql: "UPDATE event_generation_runs SET status = 'discarded' WHERE id = ?", params: [runId] },
    activityStmt("ai.events_discarded", "Discarded an AI event proposal"),
  ]);
}
/** Explicit human approval: only selected proposals become saved, approved events. */
export async function commitRun(run_: GenerationRun, cal: Calendar, proposals: Proposal[], clientId?: string | null) {
  const picked = proposals.filter((p) => p.selected);
  const targetClientId = clientId || null;
  const client = targetClientId ? await getClient(targetClientId) : null;
  if (targetClientId && !client) throw new Error("The selected client no longer exists. Ask the AI again.");
  const request = JSON.parse(run_.request) as PlanRequest;
  // Client calendars only reference the Global Calendar, so a client-owned event must live in
  // the master calendar too. Otherwise approving from a client calendar stores the event in a
  // place no client view reads.
  const target = client && !cal.is_global ? (await getGlobalCalendar()) ?? cal : cal;
  const scope = client ? client.scope || "GLOBAL" : cal.scope ?? "GLOBAL";
  const industry = client ? client.industry || request.industry : cal.industry;
  const region = client ? request.region : cal.region;
  const now = nowIso();
  const stmts: Stmt[] = picked.map((p) => ({
    sql: `INSERT OR IGNORE INTO events(
            id, calendar_id, client_id, name, short_description, detailed_description,
            category, industry, region, start_date, end_date, importance, event_kind,
            source_url, verification_status, campaign_topic, content_format, hashtags,
            image_prompt, video_prompt, scope, event_code, approval_status, approved_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    params: [
      uid(), target.id, targetClientId, p.name, p.short_description, p.detailed_description,
      p.category, industry, region, p.start_date, p.end_date, p.importance, p.event_kind,
      p.source_url, p.source_url ? "source_provided" : "unverified", p.campaign_topic, p.content_format, JSON.stringify(p.hashtags),
      p.image_prompt, p.video_prompt, scope, client ? null : eventCode(scope, p.name, p.start_date), "approved", now,
    ],
  }));
  stmts.push({ sql: "UPDATE event_generation_runs SET status = 'committed', committed_at = ?, proposals = ? WHERE id = ?", params: [now, JSON.stringify(proposals), run_.id] });
  stmts.push(activityStmt("ai.events_committed", `Approved and saved ${picked.length} AI event(s) to "${target.name}"${client ? ` for ${client.name}` : ""}`, { entity_type: "calendar", entity_id: target.id, level: "success" }));
  await tx(stmts);
  return picked.length;
}

/** Explicit human approval of a topic plan: each selected topic becomes a scheduled draft post. */
export async function commitTopicRun(run_: GenerationRun, cal: Calendar, topics: TopicProposal[], clientId?: string | null) {
  const picked = topics.filter((t) => t.selected);
  const targetClientId = clientId || null;
  if (!targetClientId) throw new Error("Choose a client before saving a content calendar.");
  const client = await getClient(targetClientId);
  if (!client) throw new Error("The selected client no longer exists. Ask the AI again.");
  const time = (client.default_time || cal.default_time || "10:00").slice(0, 5);
  const now = nowIso();
  const stmts: Stmt[] = picked.map((t) => ({
    sql: `INSERT INTO posts(id,campaign_id,client_id,platform,body,hashtags,status,scheduled_at,topic,pillar,content_format)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    params: [uid(), null, targetClientId, t.platform, t.caption || t.brief || t.topic, JSON.stringify(t.hashtags), "draft", `${t.date}T${time}`, t.topic, t.pillar, t.format],
  }));
  stmts.push({ sql: "UPDATE event_generation_runs SET status = 'committed', committed_at = ?, proposals = ? WHERE id = ?", params: [now, JSON.stringify(topics), run_.id] });
  stmts.push(activityStmt("ai.content_committed", `Approved and saved ${picked.length} content topic(s) as draft posts for ${client.name}`, { entity_type: "client", entity_id: client.id, level: "success" }));
  await tx(stmts);
  return picked.length;
}

// ---------- providers ----------
export const listProviders = () => all<Provider>("SELECT * FROM ai_providers ORDER BY is_default DESC, fallback_priority, created_at");

export type ProviderInput = Omit<Provider, "id" | "has_api_key" | "api_key_hint" | "last_test_at" | "last_test_ok" | "last_test_ms" | "last_test_message">;

export async function saveProvider(id: string | null, p: ProviderInput): Promise<string> {
  const pid = id ?? uid();
  const cols = ["name", "provider_type", "protocol", "base_url", "model_id", "context_window", "max_output", "thinking_effort", "image_input", "timeout_ms", "retry_count", "enabled", "is_default", "fallback_priority"] as const;
  const vals = cols.map((c) => p[c] as string | number | null);
  const stmts: Stmt[] = [];
  if (p.is_default) stmts.push({ sql: "UPDATE ai_providers SET is_default = 0", params: [] });
  if (id) stmts.push({ sql: `UPDATE ai_providers SET ${cols.map((c) => `${c}=?`).join(",")}, updated_at=? WHERE id=?`, params: [...vals, nowIso(), id] });
  else stmts.push({ sql: `INSERT INTO ai_providers(id, ${cols.join(",")}) VALUES (?, ${ph(cols.length)})`, params: [pid, ...vals] });
  stmts.push(activityStmt(id ? "provider.updated" : "provider.created", `${id ? "Updated" : "Added"} AI provider "${p.name}"`, { entity_type: "provider", entity_id: pid }));
  if (!id) {
    stmts.push({
      sql: "INSERT INTO provider_comments(id, provider_id, kind, title, body) VALUES (?,?,?,?,?)",
      params: [
        uid(),
        pid,
        "system",
        "Comments",
        "This log is created automatically with the API. Fallback reasons (credits exhausted, expired key, rate limit, model gone) appear here with the exact provider error.",
      ],
    });
  }
  await tx(stmts);
  return pid;
}

export type ProviderComment = { id: string; provider_id: string; kind: string; title: string; body: string; created_at: string };

export const listProviderComments = (providerId: string) =>
  all<ProviderComment>("SELECT * FROM provider_comments WHERE provider_id = ? ORDER BY created_at DESC LIMIT 40", [providerId]);

export async function addProviderComment(providerId: string, kind: string, title: string, body: string) {
  await run("INSERT INTO provider_comments(id, provider_id, kind, title, body) VALUES (?,?,?,?,?)", [uid(), providerId, kind, title.slice(0, 120), body.slice(0, 2000)]);
}
export async function updateProviderComment(id: string, title: string, body: string) {
  await run("UPDATE provider_comments SET title = ?, body = ? WHERE id = ?", [title.slice(0, 120), body.slice(0, 2000), id]);
}

export async function setProviderModel(id: string, modelId: string) {
  await run("UPDATE ai_providers SET model_id = ?, updated_at = ? WHERE id = ?", [modelId, nowIso(), id]);
}
export async function setProviderKeyMeta(id: string, hint: string | null) {
  await run("UPDATE ai_providers SET has_api_key = ?, api_key_hint = ?, updated_at = ? WHERE id = ?", [hint ? 1 : 0, hint, nowIso(), id]);
}
export async function recordProviderTest(id: string, ok: boolean, ms: number, message: string) {
  await run("UPDATE ai_providers SET last_test_at = ?, last_test_ok = ?, last_test_ms = ?, last_test_message = ? WHERE id = ?", [nowIso(), ok ? 1 : 0, ms, message.slice(0, 300), id]);
}
export async function deleteProvider(id: string, name: string) {
  await tx([{ sql: "DELETE FROM ai_providers WHERE id = ?", params: [id] }, activityStmt("provider.deleted", `Removed AI provider "${name}"`, { level: "warning" })]);
}
const USER_TABLES = [
  "provider_comments",
  "provider_models_cache",
  "posts",
  "media_assets",
  "campaigns",
  "social_accounts",
  "brand_voices",
  "automation_rules",
  "ai_task_routes",
  "events",
  "event_generation_runs",
  "client_event_state",
  "client_social_handles",
  "calendars",
  "clients",
  "ai_request_logs",
  "activity_logs",
  "scheduler_jobs",
  "app_settings",
  "ai_providers",
];

// ---------- clients ----------
export type Client = { id: string; name: string; description: string; industry: string; theme: string; timezone: string; default_time: string; scope: string; created_at: string; updated_at: string };

export type ClientSocialHandle = {
  id: string;
  client_id: string;
  platform: string;
  handle: string;
  display_name: string;
  note: string;
  created_at: string;
  updated_at: string;
};

export const listClients = () => all<Client>("SELECT * FROM clients ORDER BY name");
export const getClient = (id: string) => all<Client>("SELECT * FROM clients WHERE id = ?", [id]).then((r) => r[0] ?? null);

export async function saveClient(id: string | null, c: { name: string; description: string; industry: string; theme?: string; timezone: string; default_time: string; scope: string }): Promise<string> {
  const pid = id ?? uid();
  const now = nowIso();
  const theme = c.theme ?? "";
  if (id) {
    await run("UPDATE clients SET name=?, description=?, industry=?, theme=?, timezone=?, default_time=?, scope=?, updated_at=? WHERE id=?", [c.name, c.description, c.industry, theme, c.timezone, c.default_time, c.scope, now, pid]);
  } else {
    await run("INSERT INTO clients(id,name,description,industry,theme,timezone,default_time,scope,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [pid, c.name, c.description, c.industry, theme, c.timezone, c.default_time, c.scope, now, now]);
  }
  await logActivity(id ? "client.updated" : "client.created", `${id ? "Updated" : "Created"} client "${c.name}"`, { entity_type: "client", entity_id: pid });
  return pid;
}

export const listAllClientSocialHandles = () =>
  all<ClientSocialHandle>("SELECT * FROM client_social_handles ORDER BY client_id, platform, handle");

export const listClientSocialHandles = (clientId: string) =>
  all<ClientSocialHandle>("SELECT * FROM client_social_handles WHERE client_id = ? ORDER BY platform, handle", [clientId]);

/**
 * Replace a client's full set of handles in one transaction. Empty handles are
 * dropped so an unfinished editor row never blocks saving the client.
 */
export async function replaceClientSocialHandles(clientId: string, handles: { platform: string; handle: string; display_name?: string; note?: string }[]) {
  const clean = handles
    .map((h) => ({
      platform: h.platform.trim().toLowerCase(),
      handle: h.handle.trim(),
      display_name: (h.display_name ?? "").trim(),
      note: (h.note ?? "").trim(),
    }))
    .filter((h) => h.platform && h.handle)
    .filter((h, i, list) => list.findIndex((x) => x.platform === h.platform && x.handle.toLowerCase() === h.handle.toLowerCase()) === i);
  const now = nowIso();
  const stmts: Stmt[] = [{ sql: "DELETE FROM client_social_handles WHERE client_id = ?", params: [clientId] }];
  for (const h of clean) {
    stmts.push({
      sql: "INSERT INTO client_social_handles(id,client_id,platform,handle,display_name,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      params: [uid(), clientId, h.platform, h.handle, h.display_name, h.note, now, now],
    });
  }
  await tx(stmts);
}

/** Delete a client and every calendar (and their events) that belongs to it. */
export async function deleteClient(id: string, name: string) {
  await tx([
    { sql: "DELETE FROM calendars WHERE client_id = ?", params: [id] },
    { sql: "DELETE FROM client_social_handles WHERE client_id = ?", params: [id] },
    { sql: "DELETE FROM clients WHERE id = ?", params: [id] },
    activityStmt("client.deleted", `Deleted client "${name}" and its calendars`, { level: "warning" }),
  ]);
}

/** Create a calendar owned by a client. It references the Global Calendar (no copies). */
export async function createClientCalendar(clientId: string, c: { name: string; industry: string; region: string; theme: string; default_time: string; timezone: string; scope: string }) {
  const id = await createCalendar({ ...c, client_id: clientId, scope: c.scope });
  await logActivity("calendar.linked", `"${c.name}" now follows the Global Calendar (${c.scope})`, { entity_type: "calendar", entity_id: id });
  return id;
}

/** Number of calendars per client, for the Clients list. */
export const countCalendarsByClient = () =>
  all<{ client_id: string; n: number }>("SELECT client_id, COUNT(*) AS n FROM calendars WHERE client_id IS NOT NULL GROUP BY client_id");

// ---------- the one Global Calendar ----------
export const GLOBAL_CALENDAR_NAME = "Global Calendar";

export const getGlobalCalendar = () =>
  all<Calendar>("SELECT * FROM calendars WHERE is_global = 1 ORDER BY created_at LIMIT 1").then((r) => r[0] ?? null);

let ensurePromise: Promise<Calendar> | null = null;

/** The single master calendar. Creates it, folds in any older standalone calendars, seeds built-ins. */
export async function ensureGlobalCalendar(): Promise<Calendar> {
  if (!ensurePromise) {
    ensurePromise = doEnsureGlobal().catch((e) => {
      ensurePromise = null;
      throw e;
    });
  }
  return ensurePromise;
}

async function doEnsureGlobal(): Promise<Calendar> {
  let g = await getGlobalCalendar();
  if (!g) {
    const id = uid();
    const s = await getSettings();
    await run("INSERT INTO calendars(id, name, industry, region, theme, default_time, timezone, is_global, scope) VALUES (?,?,?,?,?,?,?,1,'GLOBAL')", [
      id,
      GLOBAL_CALENDAR_NAME,
      "",
      "Worldwide",
      "",
      s["default_time"] ?? "10:00",
      s["timezone"] ?? "Asia/Kolkata",
    ]);
    await logActivity("calendar.global_created", "Created the Global Calendar (master list of observances)", { entity_type: "calendar", entity_id: id, level: "success" });
    g = (await getCalendar(id))!;
  }
  await adoptLegacyCalendars(g.id);
  await seedGlobalObservances();
  return (await getCalendar(g.id))!;
}

/** Fold older standalone (non-global, non-client) calendars into the global one, then drop them. */
async function adoptLegacyCalendars(globalId: string) {
  const legacy = await all<{ id: string }>("SELECT id FROM calendars WHERE client_id IS NULL AND is_global = 0 AND id != ?", [globalId]);
  if (!legacy.length) return;
  const stmts: Stmt[] = [];
  for (const c of legacy) {
    stmts.push({ sql: "UPDATE OR IGNORE events SET calendar_id = ? WHERE calendar_id = ?", params: [globalId, c.id] });
    stmts.push({ sql: "DELETE FROM events WHERE calendar_id = ?", params: [c.id] });
    stmts.push({ sql: "DELETE FROM calendars WHERE id = ?", params: [c.id] });
  }
  await tx(stmts);
}

/** Keep the Global Calendar stocked with the built-in fixed observances for this year and the next. */
export async function seedGlobalObservances(): Promise<number> {
  const g = await getGlobalCalendar();
  if (!g) return 0;
  const year = new Date().getFullYear();
  const rows = [...builtinEventsFor(year), ...builtinEventsFor(year + 1)];
  const before = (await all<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE calendar_id = ? AND event_code IS NOT NULL", [g.id]))[0]?.n ?? 0;
  const stmts: Stmt[] = rows.map((e) => ({
    sql: `INSERT OR IGNORE INTO events(id, calendar_id, name, short_description, category, start_date, end_date, importance, event_kind, scope, event_code, approval_status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    params: [uid(), g.id, e.name, e.short_description, e.category, e.start_date, e.end_date, "medium", e.event_kind, e.scope, e.event_code, "approved"],
  }));
  await tx(stmts);
  const after = (await all<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE calendar_id = ? AND event_code IS NOT NULL", [g.id]))[0]?.n ?? 0;
  return after - before;
}

export const listGlobalEvents = () => all<EventRow>(`${EVENT_SELECT} WHERE c.is_global = 1 AND e.client_id IS NULL ORDER BY e.start_date, e.name`);

/**
 * A client's view of the Global Calendar: shared events in its scope plus events
 * that belong to this client. Theme filtering happens in the UI so the same rows
 * can be shown with an explicit "show all themes" switch.
 */
export async function listClientVisibleEvents(clientId: string): Promise<EventRow[]> {
  const client = await getClient(clientId);
  if (!client) return [];
  return all<EventRow>(
    `${EVENT_SELECT} WHERE (c.is_global = 1 AND e.client_id IS NULL AND (e.scope = 'GLOBAL' OR e.scope = ?))
       OR e.client_id = ?
     ORDER BY e.start_date, e.name`,
    [client.scope ?? "GLOBAL", clientId],
  );
}

/** What a client calendar shows: global events in scope plus this client's own events. */
export async function listClientCalendarEvents(calendarId: string): Promise<EventRow[]> {
  const cal = await getCalendar(calendarId);
  if (!cal) return [];
  const rows = await all<EventRow>(
    `${EVENT_SELECT} WHERE (c.is_global = 1 AND e.client_id IS NULL AND (e.scope = 'GLOBAL' OR e.scope = ?))
       OR e.client_id = ?
     ORDER BY e.start_date, e.name`,
    [cal.scope ?? "GLOBAL", cal.client_id],
  );
  const states = await all<StateRow>("SELECT event_id, time_override, approval_status, publish_status, category, hidden FROM client_event_state WHERE calendar_id = ?", [calendarId]);
  const byId = new Map(states.map((s) => [s.event_id, s]));
  const out: EventRow[] = [];
  for (const r of rows) {
    const s = byId.get(r.id);
    if (s?.hidden) continue;
    out.push({
      ...r,
      calendar_id: cal.id,
      calendar_name: cal.name,
      default_time: cal.default_time,
      timezone: cal.timezone,
      time_override: s?.time_override ?? r.time_override ?? null,
      approval_status: s?.approval_status ?? r.approval_status,
      publish_status: s?.publish_status ?? r.publish_status,
      category: s?.category ?? r.category,
    });
  }
  return out;
}

/** Wipe all app data. Schema/migrations stay. Caller must also clear API keys. */
export async function factoryResetAllData(): Promise<string[]> {
  const existing = await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
  const have = new Set(existing.map((r) => r.name));
  const stmts: Stmt[] = USER_TABLES.filter((t) => t !== "activity_logs" && have.has(t)).map((t) => ({ sql: `DELETE FROM ${t}`, params: [] }));
  if (have.has("activity_logs")) stmts.push({ sql: "DELETE FROM activity_logs", params: [] });
  stmts.push(activityStmt("app.factory_reset", "All local data, schedules, accounts and provider records were deleted", { level: "warning" }));
  await tx(stmts);
  return USER_TABLES.filter((t) => have.has(t));
}

export async function logAiRequest(r: { provider_id: string | null; provider_name: string; task: string; model: string; ok: boolean; latency_ms: number; error?: string }) {
  await run("INSERT INTO ai_request_logs(id, provider_id, provider_name, task, model, ok, latency_ms, error) VALUES (?,?,?,?,?,?,?,?)", [uid(), r.provider_id, r.provider_name, r.task, r.model, r.ok ? 1 : 0, r.latency_ms, r.error ?? null]);
}

// ---------- dashboard ----------
export type DashboardStats = {
  calendars: number;
  events: number;
  upcoming30: number;
  pending: number;
  approved: number;
  scheduled: number;
  published: number;
  failed: number;
  providers: number;
  providersHealthy: number;
  aiCalls7d: number;
  aiFail7d: number;
};
export async function dashboardStats(): Promise<DashboardStats> {
  const r = (
    await all<DashboardStats>(`SELECT
      (SELECT COUNT(*) FROM calendars) AS calendars,
      (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM events WHERE start_date BETWEEN date('now') AND date('now','+30 day')) AS upcoming30,
      (SELECT COUNT(*) FROM events WHERE approval_status = 'pending_review') AS pending,
      (SELECT COUNT(*) FROM events WHERE approval_status = 'approved') AS approved,
      (SELECT COUNT(*) FROM events WHERE publish_status = 'scheduled') AS scheduled,
      (SELECT COUNT(*) FROM events WHERE publish_status = 'published') AS published,
      (SELECT COUNT(*) FROM events WHERE publish_status = 'failed') AS failed,
      (SELECT COUNT(*) FROM ai_providers WHERE enabled = 1) AS providers,
      (SELECT COUNT(*) FROM ai_providers WHERE enabled = 1 AND last_test_ok = 1) AS providersHealthy,
      (SELECT COUNT(*) FROM ai_request_logs WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 day')) AS aiCalls7d,
      (SELECT COUNT(*) FROM ai_request_logs WHERE ok = 0 AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 day')) AS aiFail7d`)
  )[0]!;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as DashboardStats;
}
export const upcomingEvents = (limit = 8) =>
  all<EventRow>(`${EVENT_SELECT} WHERE e.client_id IS NULL AND e.start_date >= date('now') ORDER BY e.start_date, e.name LIMIT ?`, [limit]);

// ---------- legacy import ----------
type LegacyExport = {
  event_calendars: { id: string; name: string; industry: string | null; default_time: string; timezone: string }[];
  calendar_events: { id: string; calendar_id: string; event_date: string; event_time: string; title: string; description: string | null; category: string | null }[];
  ai_providers: { id: string; name: string; protocol: string; base_url: string; model_id: string; context_window: number | null; max_output: number | null; thinking_effort: string; image_input: boolean; timeout_ms: number | null; enabled: boolean }[];
};
export async function importLegacy(data: LegacyExport): Promise<{ calendars: number; events: number; providers: number }> {
  const stmts: Stmt[] = [];
  for (const c of data.event_calendars ?? [])
    stmts.push({ sql: "INSERT OR IGNORE INTO calendars(id, name, industry, default_time, timezone) VALUES (?,?,?,?,?)", params: [c.id, c.name, c.industry ?? "", c.default_time.slice(0, 5), c.timezone] });
  const calTime = new Map((data.event_calendars ?? []).map((c) => [c.id, c.default_time.slice(0, 5)]));
  for (const e of data.calendar_events ?? []) {
    const t = e.event_time.slice(0, 5);
    stmts.push({
      sql: "INSERT OR IGNORE INTO events(id, calendar_id, name, short_description, category, start_date, end_date, time_override, approval_status) VALUES (?,?,?,?,?,?,?,?, 'pending_review')",
      params: [e.id, e.calendar_id, e.title, e.description ?? "", e.category ?? "Other", e.event_date, e.event_date, t === calTime.get(e.calendar_id) ? null : t],
    });
  }
  for (const p of data.ai_providers ?? []) {
    const proto = p.protocol === "anthropic" || p.protocol === "gemini" || p.protocol === "ollama" ? p.protocol : "openai";
    stmts.push({
      sql: "INSERT OR IGNORE INTO ai_providers(id, name, provider_type, protocol, base_url, model_id, context_window, max_output, thinking_effort, image_input, timeout_ms, enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      params: [p.id, p.name, p.protocol, proto, p.base_url, p.model_id, p.context_window, p.max_output ?? 4096, p.thinking_effort, p.image_input ? 1 : 0, p.timeout_ms ?? 90000, p.enabled ? 1 : 0],
    });
  }
  const counts = { calendars: data.event_calendars?.length ?? 0, events: data.calendar_events?.length ?? 0, providers: data.ai_providers?.length ?? 0 };
  stmts.push(activityStmt("import.legacy", `Imported old cloud data: ${counts.calendars} calendar(s), ${counts.events} event(s), ${counts.providers} provider(s) (keys not included; events need review)`, { level: "success" }));
  await tx(stmts);
  return counts;
}

export type Campaign = { id: string; name: string; objective: string; audience: string; start_date: string | null; end_date: string | null; status: string; notes: string; platforms: string };
export type PostRow = {
  id: string;
  body: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  fail_reason: string | null;
  campaign_id: string | null;
  client_id: string | null;
  topic: string;
  pillar: string;
  content_format: string;
  hashtags: string;
};
export type SocialAccount = { id: string; platform: string; display_name: string; handle: string; status: string; note: string };
export type MediaAsset = { id: string; filename: string; mime: string; bytes: number; tags: string; folder: string };
export type BrandVoice = { id: string; name: string; industry: string; audience: string; tone: string; language: string; guidelines: string };
export type AutomationRule = { id: string; name: string; enabled: number; schedule: string; action: string; last_run_at: string | null; last_status: string | null; last_message: string | null };

export const listCampaigns = () => all<Campaign>("SELECT * FROM campaigns ORDER BY updated_at DESC");
export async function saveCampaign(c: Partial<Campaign> & { name: string }) {
  const id = c.id ?? uid();
  await run(
    `INSERT INTO campaigns(id,name,objective,audience,start_date,end_date,status,notes,platforms) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, objective=excluded.objective, audience=excluded.audience, start_date=excluded.start_date, end_date=excluded.end_date, status=excluded.status, notes=excluded.notes, platforms=excluded.platforms, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [id, c.name, c.objective ?? "", c.audience ?? "", c.start_date ?? null, c.end_date ?? null, c.status ?? "draft", c.notes ?? "", c.platforms ?? "[]"],
  );
  await logActivity("campaign.save", `Campaign "${c.name}" saved`);
  return id;
}

export const listPosts = (status?: string) =>
  status ? all<PostRow>("SELECT * FROM posts WHERE status = ? ORDER BY updated_at DESC", [status]) : all<PostRow>("SELECT * FROM posts ORDER BY updated_at DESC");

export const listClientPosts = (clientId: string) =>
  all<PostRow>("SELECT * FROM posts WHERE client_id = ? ORDER BY scheduled_at, created_at", [clientId]);

export async function savePost(p: Partial<PostRow> & { body: string }) {
  const id = p.id ?? uid();
  await run(
    `INSERT INTO posts(id,campaign_id,client_id,platform,body,hashtags,status,scheduled_at,topic,pillar,content_format,fail_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET body=excluded.body, platform=excluded.platform, hashtags=excluded.hashtags, status=excluded.status, scheduled_at=excluded.scheduled_at, campaign_id=excluded.campaign_id, client_id=excluded.client_id, topic=excluded.topic, pillar=excluded.pillar, content_format=excluded.content_format, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [id, p.campaign_id ?? null, p.client_id ?? null, p.platform ?? "", p.body, p.hashtags ?? "", p.status ?? "draft", p.scheduled_at ?? null, p.topic ?? "", p.pillar ?? "", p.content_format ?? "", p.fail_reason ?? null],
  );
  await logActivity("post.save", `Post ${id.slice(0, 8)} saved as ${p.status ?? "draft"}`);
  return id;
}

export const listAccounts = () => all<SocialAccount>("SELECT * FROM social_accounts ORDER BY platform, display_name");
export async function saveAccount(a: Partial<SocialAccount> & { platform: string; display_name: string }) {
  const id = a.id ?? uid();
  await run(
    `INSERT INTO social_accounts(id,platform,display_name,handle,status,note) VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, handle=excluded.handle, status=excluded.status, note=excluded.note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [id, a.platform, a.display_name, a.handle ?? "", a.status ?? "not_connected", a.note ?? ""],
  );
  return id;
}

export const listMedia = () => all<MediaAsset>("SELECT * FROM media_assets ORDER BY created_at DESC");
export async function addMediaMeta(filename: string, mime: string, bytes: number) {
  const id = uid();
  await run("INSERT INTO media_assets(id,filename,mime,bytes) VALUES (?,?,?,?)", [id, filename, mime, bytes]);
  await logActivity("media.add", `Recorded ${filename} (${bytes} bytes)`);
  return id;
}

export const listBrandVoices = () => all<BrandVoice>("SELECT * FROM brand_voices ORDER BY name");
export async function saveBrandVoice(b: Partial<BrandVoice> & { name: string }) {
  const id = b.id ?? uid();
  await run(
    `INSERT INTO brand_voices(id,name,industry,audience,tone,language,guidelines) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, industry=excluded.industry, audience=excluded.audience, tone=excluded.tone, language=excluded.language, guidelines=excluded.guidelines, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [id, b.name, b.industry ?? "", b.audience ?? "", b.tone ?? "", b.language ?? "en", b.guidelines ?? ""],
  );
  return id;
}

export const listAutomations = () => all<AutomationRule>("SELECT * FROM automation_rules ORDER BY name");
export async function saveAutomation(r: Partial<AutomationRule> & { name: string; action: string }) {
  const id = r.id ?? uid();
  await run(
    `INSERT INTO automation_rules(id,name,enabled,schedule,action) VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, enabled=excluded.enabled, schedule=excluded.schedule, action=excluded.action`,
    [id, r.name, r.enabled ?? 0, r.schedule ?? "manual", r.action],
  );
  return id;
}
export async function runAutomation(id: string) {
  await run("UPDATE automation_rules SET last_run_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_status=?, last_message=? WHERE id=?", [
    "ok",
    "Manual run recorded. Publishing still requires official OAuth credentials.",
    id,
  ]);
  await logActivity("automation.run", `Automation ${id.slice(0, 8)} executed (local record only)`);
}
