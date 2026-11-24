import type { Calendar, Client, EventRow } from "./repo";

export const ALL_CLIENTS = "__all_clients__";

/** The client's own theme plus any theme set on its calendars. */
export function clientThemes(client: Client | null | undefined, calendars: Calendar[] = []): string[] {
  const values = [client?.theme ?? "", ...calendars.map((c) => c.theme)].map((t) => t.trim()).filter(Boolean);
  return [...new Set(values)];
}

const tokens = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

/** A global event belongs to a themed client view when its text mentions the theme. */
export function eventMatchesTheme(
  event: Pick<EventRow, "name" | "short_description" | "campaign_topic">,
  themes: string[],
): boolean {
  if (!themes.length) return true;
  const haystack = [event.name, event.short_description, event.campaign_topic].join(" ").toLowerCase();
  return themes.some((theme) => {
    const phrase = theme.trim().toLowerCase();
    if (!phrase) return true;
    if (haystack.includes(phrase)) return true;
    return tokens(phrase).some((token) => haystack.includes(token));
  });
}

/** Client-owned events always show; shared events must match the theme when filtering. */
export function filterEventsForClient(events: EventRow[], clientId: string | null, themes: string[], themeOnly: boolean): EventRow[] {
  if (!clientId || !themeOnly || !themes.length) return events;
  return events.filter((e) => e.client_id === clientId || eventMatchesTheme(e, themes));
}
