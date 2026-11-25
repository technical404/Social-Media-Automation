import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostsPage } from "@/routes/_app/posts";
import type * as Repo from "@/lib/repo";

const mocks = vi.hoisted(() => ({
  listPosts: vi.fn(),
  listClients: vi.fn(),
  savePost: vi.fn(),
}));

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof Repo>();
  return { ...actual, ...mocks };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const clients = [
  { id: "cl1", name: "Acme" },
  { id: "cl2", name: "Beta" },
] as Repo.Client[];

const post = (id: string, client_id: string, body: string): Repo.PostRow => ({
  id,
  body,
  platform: "instagram",
  status: "pending_approval",
  scheduled_at: "2026-12-01T10:00",
  fail_reason: null,
  campaign_id: null,
  client_id,
  topic: "",
  pillar: "",
  content_format: "Post",
  hashtags: "[]",
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PostsPage />
    </QueryClientProvider>,
  );
}

function openWithKeyboard(element: HTMLElement) {
  element.focus();
  fireEvent.keyDown(element, { key: "Enter" });
}

describe("PostsPage client filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listClients.mockResolvedValue(clients);
    mocks.listPosts.mockResolvedValue([post("p1", "cl1", "Acme launch post"), post("p2", "cl2", "Beta launch post")]);
    mocks.savePost.mockResolvedValue(undefined);
  });

  it("shows only the selected client's posts", async () => {
    renderPage();
    expect(await screen.findByText("Acme launch post")).toBeInTheDocument();
    expect(screen.getByText("Beta launch post")).toBeInTheDocument();

    openWithKeyboard(screen.getByRole("combobox", { name: "Client view" }));
    fireEvent.click(await screen.findByRole("option", { name: "Acme" }));

    expect(await screen.findByText("Acme launch post")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Beta launch post")).not.toBeInTheDocument());
  });

  it("saves a new post to the selected client", async () => {
    renderPage();
    await screen.findByText("Acme launch post");

    openWithKeyboard(screen.getByRole("combobox", { name: "Client view" }));
    fireEvent.click(await screen.findByRole("option", { name: "Acme" }));
    await screen.findByText(/New posts are saved to this client/);

    fireEvent.change(screen.getByPlaceholderText("Post body"), { target: { value: "New Acme post" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(mocks.savePost).toHaveBeenCalledWith(expect.objectContaining({ body: "New Acme post", client_id: "cl1", status: "draft" })),
    );
  });
});
