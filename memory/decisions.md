# Architecture decisions

- Product root for the UI is `Frontend/` (TanStack Start + Vite). Python backend is `Frontend/backend/`.
- Repository-root `main.py` only bootstraps Frontend/main.py so `python main.py` works from the folder the user opened.
- Vite still uses `@lovable.dev/vite-tanstack-config` as the bundler plugin (build would break without a full Vite rewrite). Cloud auth/telemetry stubs no longer call Lovable.
- Extra modules (studio, posts, campaigns, accounts, media, analytics, automation, brand) persist in SQLite via migration `002_content`.

## Clients (migration 004 + 005)
- A client's calendars ARE rows in the shared `calendars` table tagged with `calendars.client_id`
  (migration 005 adds the column). `client_id IS NULL` = standalone planner calendars.
- Rationale: `events.calendar_id` already references `calendars(id)` with cascade delete, so every
  scheduler feature (events, snapshot/undo, times, 3-month grid) works for clients unchanged.
  We reuse `<EventWorkspace>` in the client scheduler instead of a parallel implementation.
- `deleteClient` deletes the client's calendars first (events cascade), then the client row.
- TanStack flat-route gotcha: `clients.tsx` + `clients.$clientId.tsx` makes `clients.tsx` a layout
  (needs `<Outlet/>`). Use `clients.index.tsx` + `clients.$clientId.tsx` so they are siblings,
  mirroring `planner.index.tsx` / `planner.$calendarId.tsx`.

## Schedule always opens on live dates
- `initialScheduleDate(today, eventDates, focusDate)` in `lib/dates.ts` decides the first visible
  month: focus date → first event today-or-later → earliest event → **today**.
- Nothing is hard-coded to a year. `today` comes from `todayIn(tz)` (real clock, calendar time zone),
  so a fresh calendar shows the current month/year and the 3-month grid follows the events.
- The AI dialog's default planning year is `getFullYear() + (getMonth() >= 9 ? 1 : 0)`
  (Oct+ plans next year) — also derived from the clock, never fixed.

## Strict JSON from AI (P0, done)
- `parseModelJson(text, finishReason)` in `lib/planner.ts` accepts ONLY a single JSON value
  (one optional ```json fence). It never salvages prose. It returns
  `{ ok, reason: empty|truncated|not_json|malformed, detail }`.
- Truncation is detected deterministically by bracket/quote balance (`looksTruncated`), not by
  engine error text; `finishReason` (`length`/`max_tokens`) is also honoured.
- `finish_reason` is plumbed provider → backend `ai.run_text` → `/api/ai/run` → `AiResult.finishReason`
  (also OpenAI-compatible browser relay `ai.server.ts`).
- `GenerateDialog` retries once with a stricter nudge only for `not_json`/`malformed`
  (a cut-off answer is reported, not retried). Everything else shows a precise error.

## Master global calendar + client references (P1 done, migration 006; P2 planned)
- ONE global calendar holds every canonical event (built-in seed + AI + custom), auto-maintained.
- Client calendars **reference** global events (no copies): a client's list = global events filtered
  by the client's region tags, joined with per-client state (own time / schedule / approval / hidden).
  Client cannot edit a referenced event's name/date.
- Stable per-event `event_code` (e.g. `IN-INDIA-INDEPENDENCE-DAY-0815`, `US-US-INDEPENDENCE-DAY-0704`)
  so adding/updating a global event syncs every matching client automatically.
- `Event Planner` becomes the Global Calendar view (no new ad-hoc global calendars).
- Header top-right shows "what's on" from the global calendar.

### P1 as built
- `db/migrations/006_global_calendar.sql`: `calendars.is_global`, `calendars.scope`, `events.event_code`,
  `events.scope`, `clients.scope`, unique index `uq_events_code_year` on `(event_code, substr(start_date,1,4))`
  WHERE `event_code IS NOT NULL`, and table `client_event_state(calendar_id, event_id, …)` PK both,
  FKs with ON DELETE CASCADE.
- `lib/global-calendar.ts` (pure): `SCOPES`/`SCOPE_LABEL`, `scopeMatches`, `defaultScopeFor`,
  `eventCode(scope,name,date)`, `BUILTIN_OBSERVANCES` (28 fixed-date observances), `builtinEventsFor(year)`.
  Moving feasts (Easter, Diwali, Thanksgiving) stay out of the seed because their date moves yearly.
- `repo.ts`: `ensureGlobalCalendar()` (memoised promise; creates the master, adopts legacy standalone
  calendars, seeds this year + next), `seedGlobalObservances()`, `listGlobalEvents()`,
  `listClientCalendarEvents(calendarId)` (global rows in scope ⟕ `client_event_state`, merges
  time/approval/publish/category, drops `hidden`), `isReferenceCalendar`, `upsertState`.
- Every event write takes an optional `calendarId`: for a client (reference) calendar it writes
  `client_event_state` instead of the event row (`setTimeForEvents`, `setCategoryForEvents`,
  `approveEvents`, `scheduleEvents`, `unscheduleEvents`, `deleteEvents` = hide).
  `snapshotSchedule`/`undoLastSchedule`/`applyDefaultTime` branch on client vs global.
- `EventWorkspace` gets `globalCalendarId`; in reference mode the tile shows "From Global Calendar",
  hides content edit, and "Delete" means "remove from this client". Adding an event goes to the
  global calendar. Client page/created calendar carry a `scope` (region of events to show).
- `planner.index.tsx` is the Global Calendar view (single card + what's-on + "Add built-in
  observances"); `_app/calendar.tsx` now shows the global calendar only; header has a "What's on" popover.
- Backend test asserts the schema tuple now includes `006_global_calendar`.
- P2 still open: copy a calendar into another; AI generation scoped to a client; custom events always
  land in the global calendar, and a client event-add has a dropdown to pick any (custom or normal) date.

## Layout safety: nothing may paint over its neighbour
- Root cause of the old header bug: a flex item defaults to `min-width: auto`, so a long label
  refused to shrink, overflowed its clamped box and covered the next control. `truncate` alone
  does nothing without `min-w-0` on the same element.
- `styles.css` base layer now sets `:where(.flex,.inline-flex,.grid,.inline-grid) > * { min-width: 0 }`
  (zero specificity, so utilities still win; opt out with `min-w-intrinsic`), wraps long words,
  and caps media at 100%.
- Header rules: fixed controls are `shrink-0`; every truncating label carries `min-w-0 truncate`;
  status chips show icons below `2xl` and text only when there is room; the clock is a fixed
  `w-40` so it cannot reflow over its neighbours.
- `lib/layout-audit.ts` + `components/dev-layout-guard.tsx` (dev only, mounted behind
  `import.meta.env.DEV` in `__root.tsx`) audit the rendered page and report three classes of bug:
  `overlap` (flow siblings sharing pixels), `escape` (visible overflow spilling out),
  `clipped` (hidden/clip with no ellipsis). `auto`/`scroll` overflow is respected as intentional.
  Overlays (dialog/menu/popover/tooltip/toast) and `[data-layout-ignore]` are skipped.
  Disable with `?layout-guard=off` or `localStorage.setItem("dev-layout-guard","off")`.
- Verified clean at 959px on every route; widths ≥1024 were reasoned from the shrink rules, not
  measured (the automated browser cannot resize).
