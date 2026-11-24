import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerateDialog } from "@/components/generate-dialog";
import { runAi } from "@/lib/ai/client";
import * as repo from "@/lib/repo";
import { toast } from "sonner";

vi.mock("@/lib/ai/client", () => ({ runAi: vi.fn() }));

vi.mock("@/lib/repo", () => ({
  listProviders: vi.fn(async () => [{ id: "p1", name: "Test provider", enabled: 1, is_default: 1, fallback_priority: 0 }]),
  listClients: vi.fn(async () => [{ id: "c1", name: "Acme", description: "Hospital care for families", theme: "Health", industry: "Hospital", timezone: "Asia/Kolkata", default_time: "10:00", scope: "IN", created_at: "", updated_at: "" }]),
  getClient: vi.fn(async () => ({ id: "c1", name: "Acme", description: "Hospital care for families", theme: "Health", industry: "Hospital", timezone: "Asia/Kolkata", default_time: "10:00", scope: "IN", created_at: "", updated_at: "" })),
  listCalendarsByClient: vi.fn(async () => [{ id: "cc1", name: "Acme calendar", industry: "Hospital", region: "India", theme: "Health", default_time: "10:00", timezone: "Asia/Kolkata", client_id: "c1", is_global: 0, scope: "IN", created_at: "", updated_at: "" }]),
  listClientSocialHandles: vi.fn(async () => [{ id: "h1", client_id: "c1", platform: "instagram", handle: "@acme", display_name: "", note: "", created_at: "", updated_at: "" }]),
  listClientCalendarEvents: vi.fn(async () => []),
  listClientPosts: vi.fn(async () => []),
  listEvents: vi.fn(async () => []),
  saveRun: vi.fn(async () => "run-1"),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const calendar: repo.Calendar = {
  id: "cal-1",
  name: "Test calendar",
  industry: "Hospital",
  region: "Worldwide",
  theme: "Health and care",
  default_time: "10:00",
  timezone: "UTC",
  client_id: null,
  is_global: 0,
  scope: "CLIENT",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const now = new Date();
const year = now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderDialog() {
  const onOpenChange = vi.fn();
  const onProposed = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <GenerateDialog open onOpenChange={onOpenChange} calendar={calendar} selectedDates={[]} onProposed={onProposed} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onProposed };
}

function openWithKeyboard(element: HTMLElement) {
  element.focus();
  fireEvent.keyDown(element, { key: "Enter" });
}

describe("GenerateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runAi).mockResolvedValue({
      text: `{"events":[{"name":"A","start_date":"${year}-01-01","end_date":"${year}-01-01"},{"name":"B","start_date":"${year}-01-02","end_date":"${year}-01-02"},{"name":"C","start_date":"${year}-01-03`,
      ms: 1200,
      model: "test-model",
      providerName: "Test provider",
      providerId: "p1",
      finishReason: "length",
    });
  });

  it("keeps complete events when the provider cuts the answer off", async () => {
    const { onOpenChange, onProposed } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Get suggestions/i }));

    await waitFor(() => expect(repo.saveRun).toHaveBeenCalledTimes(1));
    const [, , , accepted, rejected] = vi.mocked(repo.saveRun).mock.calls[0]!;
    expect((accepted as { name: string }[]).map((p) => p.name)).toEqual(["A", "B"]);
    expect(rejected).toEqual(expect.arrayContaining([expect.objectContaining({ item: "AI answer", reason: expect.stringMatching(/cut the answer off/i) })]));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/2 complete events recovered/i), expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onProposed).toHaveBeenCalledWith(`${year}-01-01`);
  });

  it("saves a client-specific request when a client is selected", async () => {
    renderDialog();

    const trigger = screen.getByRole("combobox", { name: "Client" });
    openWithKeyboard(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Acme" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Get suggestions/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Get suggestions/i }));

    await waitFor(() => expect(repo.saveRun).toHaveBeenCalledTimes(1));
    const [, req] = vi.mocked(repo.saveRun).mock.calls[0]!;
    expect(req).toMatchObject({
      client_id: "c1",
      client_name: "Acme",
      industry: "Hospital",
      region: "India",
      theme: "Health",
      client_description: "Hospital care for families",
      use_client_profile: true,
    });
    expect(vi.mocked(runAi).mock.calls[0]?.[0]).toMatchObject({ system: expect.stringContaining("Hospital care for families") });
    expect(repo.listClientCalendarEvents).toHaveBeenCalledWith("cc1");
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/complete events recovered/i), expect.objectContaining({ description: expect.stringMatching(/for Acme/i) }));
  });

  it("saves a client-specific topic plan when the social topics mode is used", async () => {
    vi.mocked(runAi).mockResolvedValueOnce({
      text: JSON.stringify({ topics: [{ date: `${year}-02-01`, topic: "Diabetes care", pillar: "Education", platform: "instagram", format: "Carousel", brief: "A practical carousel", caption: "Small steps matter.", hashtags: ["#care"] }] }),
      ms: 900,
      model: "test-model",
      providerName: "Test provider",
      providerId: "p1",
      finishReason: "stop",
    });
    renderDialog();

    const topicsTab = screen.getByRole("tab", { name: "Social topics" });
    fireEvent.mouseDown(topicsTab);
    fireEvent.click(topicsTab);
    await waitFor(() => expect(screen.getByRole("button", { name: /Plan content/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Plan content/i }));

    await waitFor(() => expect(repo.saveRun).toHaveBeenCalledTimes(1));
    const [, req, , accepted, , kind] = vi.mocked(repo.saveRun).mock.calls[0]!;
    expect(req).toMatchObject({ client_id: "c1", client_name: "Acme", maxTopics: 12, platforms: ["instagram"], use_client_profile: true });
    expect((accepted as { topic: string }[]).map((t) => t.topic)).toEqual(["Diabetes care"]);
    expect(kind).toBe("topics");
    expect(repo.listClientPosts).toHaveBeenCalledWith("c1");
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/1 topics planned for Acme/i), expect.anything());
  });
});
