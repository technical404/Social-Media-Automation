import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventFormDialog } from "@/components/event-form-dialog";
import * as repo from "@/lib/repo";

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return {
    ...actual,
    createEvent: vi.fn(async () => "event-1"),
    updateEvent: vi.fn(async () => undefined),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const eventRow: repo.EventRow = {
  id: "ev-1",
  calendar_id: "cal-1",
  client_id: null,
  name: "Existing event",
  short_description: "",
  detailed_description: "",
  category: "Other",
  industry: "",
  region: "",
  start_date: "2026-12-01",
  end_date: "2026-12-01",
  importance: "medium",
  event_kind: "official_observance",
  source_url: "https://example.com/source",
  verification_status: "verified",
  campaign_topic: "",
  content_format: "Custom format",
  hashtags: "[]",
  image_prompt: "",
  video_prompt: "",
  platforms: '["instagram"]',
  time_override: null,
  event_status: "active",
  approval_status: "approved",
  publish_status: "not_scheduled",
  approved_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderForm(event: repo.EventRow | null = null) {
  const onSaved = vi.fn();
  render(
    <EventFormDialog
      open
      onOpenChange={() => {}}
      calendarId="cal-1"
      event={event}
      defaultDate="2026-12-01"
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

function openWithKeyboard(element: HTMLElement) {
  element.focus();
  fireEvent.keyDown(element, { key: "Enter" });
}

describe("EventFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a content-type dropdown, a platform multiselect, and hides the source fields", () => {
    renderForm();

    expect(screen.getByRole("combobox", { name: "Content type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Platforms" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Official source link")).not.toBeInTheDocument();
    expect(screen.queryByText("Source check")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Content type" })).toBeInTheDocument();
  });

  it("saves selected platforms and content type", async () => {
    const { onSaved } = renderForm();

    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "World Cancer Day" } });

    const platformTrigger = screen.getByRole("button", { name: "Platforms" });
    openWithKeyboard(platformTrigger);
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Instagram" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    const contentTrigger = screen.getByRole("combobox", { name: "Content type" });
    openWithKeyboard(contentTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Reel" }));

    fireEvent.click(screen.getByRole("button", { name: "Add event" }));

    await waitFor(() => expect(repo.createEvent).toHaveBeenCalledTimes(1));
    expect(repo.createEvent).toHaveBeenCalledWith(
      "cal-1",
      expect.objectContaining({
        name: "World Cancer Day",
        platforms: ["instagram"],
        content_format: "Reel",
        source_url: "",
        verification_status: "unverified",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("keeps existing source values when editing", async () => {
    renderForm(eventRow);

    expect(screen.getByRole("combobox", { name: "Content type" })).toHaveTextContent("Custom format");

    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Edited event" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(repo.updateEvent).toHaveBeenCalledTimes(1));
    expect(repo.updateEvent).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({
        name: "Edited event",
        source_url: "https://example.com/source",
        verification_status: "verified",
        content_format: "Custom format",
      }),
    );
  });
});
