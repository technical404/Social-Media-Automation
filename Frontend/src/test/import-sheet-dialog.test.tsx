import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportSheetDialog } from "@/components/import-sheet-dialog";
import * as repo from "@/lib/repo";

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return {
    ...actual,
    createEvent: vi.fn(async () => "event-1"),
    logActivity: vi.fn(async () => undefined),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// jsdom's File predates Blob.arrayBuffer in some versions.
if (typeof File !== "undefined" && typeof File.prototype.arrayBuffer !== "function") {
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value(this: File) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

describe("ImportSheetDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews a sheet, allows edits, and imports the edited row only after pressing Import", async () => {
    const onImported = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ImportSheetDialog
        open
        onOpenChange={onOpenChange}
        calendarId="cal-1"
        calendarName="Global Calendar"
        scope="GLOBAL"
        existingEvents={[]}
        onImported={onImported}
      />,
    );

    const csv = [
      "Topic,Date,Content type,Platform,Time,Description",
      "World AIDS Day,2026-12-01,Carousel,instagram,10:00,Caption idea",
    ].join("\n");
    const file = new File([csv], "plan.csv", { type: "text/csv" });

    fireEvent.change(screen.getByLabelText("Spreadsheet"), { target: { files: [file] } });

    const topic = await screen.findByDisplayValue("World AIDS Day", {}, { timeout: 5000 });
    expect(repo.createEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show row details" }));
    const description = await screen.findByDisplayValue("Caption idea");
    fireEvent.change(description, { target: { value: "Edited caption" } });

    fireEvent.change(topic, { target: { value: "Edited topic" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Content type" }), { target: { value: "Reel" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Platforms" }), { target: { value: "instagram, linkedin" } });

    expect(screen.getByText("1 ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Import 1 event/i }));

    await waitFor(() => expect(repo.createEvent).toHaveBeenCalledTimes(1));
    expect(repo.createEvent).toHaveBeenCalledWith(
      "cal-1",
      expect.objectContaining({
        name: "Edited topic",
        start_date: "2026-12-01",
        end_date: "2026-12-01",
        content_format: "Reel",
        platforms: ["instagram", "linkedin"],
        short_description: "Edited caption",
        event_kind: "custom",
        scope: "GLOBAL",
      }),
    );
    expect(repo.logActivity).toHaveBeenCalledWith("import.sheet", expect.stringContaining("Imported 1 event"), { level: "success" });
    expect(onImported).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 15000);
});
