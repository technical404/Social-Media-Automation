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
    expect(accepted.map((p) => p.name)).toEqual(["A", "B"]);
    expect(rejected).toEqual(expect.arrayContaining([expect.objectContaining({ item: "AI answer", reason: expect.stringMatching(/cut the answer off/i) })]));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/2 complete events recovered/i), expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onProposed).toHaveBeenCalledWith(`${year}-01-01`);
  });
});
