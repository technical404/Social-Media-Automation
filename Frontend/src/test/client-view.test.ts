import { describe, expect, it } from "vitest";
import { clientThemes, eventMatchesTheme, filterEventsForClient } from "@/lib/client-view";
import type { Calendar, Client, EventRow } from "@/lib/repo";

const client = { theme: "Preventive health" } as Client;
const calendars = [{ theme: "Heart care" }, { theme: "Preventive health" }, { theme: "" }] as Calendar[];

const event = (name: string, clientId: string | null = null) =>
  ({
    id: name,
    name,
    short_description: "",
    campaign_topic: "",
    category: "Health",
    client_id: clientId,
  }) as EventRow;

describe("client calendar view", () => {
  it("combines the client theme with its calendar themes without duplicates", () => {
    expect(clientThemes(client, calendars)).toEqual(["Preventive health", "Heart care"]);
  });

  it("matches a theme phrase or a meaningful word from it", () => {
    expect(eventMatchesTheme(event("World Heart Day"), ["Heart care"])).toBe(true);
    expect(eventMatchesTheme(event("World Heart Day"), ["Preventive health"])).toBe(false);
    expect(eventMatchesTheme(event("World Heart Day"), [])).toBe(true);
  });

  it("keeps client-owned events even when they do not match the theme", () => {
    const rows = [event("World Heart Day"), event("Product launch", "c1")];
    expect(filterEventsForClient(rows, "c1", ["Preventive health"], true).map((e) => e.name)).toEqual(["Product launch"]);
    expect(filterEventsForClient(rows, "c1", ["Preventive health"], false)).toHaveLength(2);
  });
});
