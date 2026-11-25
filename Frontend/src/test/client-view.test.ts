import { describe, expect, it } from "vitest";
import { clientThemes, eventMatchesClientCategory, eventMatchesTheme, filterEventsForClient } from "@/lib/client-view";
import type { Calendar, Client, EventRow } from "@/lib/repo";

const client = { id: "c1", theme: "Preventive health", industry: "Healthcare" } as Client;
const calendars = [{ theme: "Heart care" }, { theme: "Preventive health" }, { theme: "" }] as Calendar[];

const event = (name: string, clientId: string | null = null, industry = "Healthcare") =>
  ({
    id: name,
    name,
    short_description: "",
    campaign_topic: "",
    category: "Health",
    industry,
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

  it("routes shared events by the client category", () => {
    expect(eventMatchesClientCategory(event("World Heart Day"), "Healthcare")).toBe(true);
    expect(eventMatchesClientCategory(event("World Heart Day"), "beauty & personal care")).toBe(false);
    expect(eventMatchesClientCategory(event("World Heart Day", null, ""), "Healthcare")).toBe(false);
  });

  it("keeps client-owned events and only category-matched shared events", () => {
    const rows = [
      event("World Heart Day"),
      event("Finance summit", null, "Finance & banking"),
      event("Product launch", "c1", "Beauty & personal care"),
      event("Uncategorised", null, ""),
    ];

    expect(filterEventsForClient(rows, client, ["Preventive health"], true).map((e) => e.name)).toEqual(["Product launch"]);
    expect(filterEventsForClient(rows, client, [], false).map((e) => e.name)).toEqual(["World Heart Day", "Product launch"]);
  });

  it("shows only client-owned events when the client has no category", () => {
    const rows = [event("World Heart Day"), event("Product launch", "c1")];
    expect(filterEventsForClient(rows, { ...client, industry: "" }, [], false).map((e) => e.name)).toEqual(["Product launch"]);
  });
});
