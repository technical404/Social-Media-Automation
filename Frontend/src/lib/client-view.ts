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

/** Shared events are routed to a client by matching the client's industry/category. */
export function eventMatchesClientCategory(event: Pick<EventRow, "industry">, category: string): boolean {
  const wanted = category.trim().toLowerCase();
  return wanted.length > 0 && event.industry.trim().toLowerCase() === wanted;
}

/** Client-owned events always show; shared events must match the client category and, optionally, its theme. */
export function filterEventsForClient(
  events: EventRow[],
  client: Pick<Client, "id" | "industry"> | null,
  themes: string[],
  themeOnly: boolean,
): EventRow[] {
  if (!client) return events;
  return events.filter((event) => {
    if (event.client_id === client.id) return true;
    if (!eventMatchesClientCategory(event, client.industry)) return false;
    return !themeOnly || !themes.length || eventMatchesTheme(event, themes);
  });
}
