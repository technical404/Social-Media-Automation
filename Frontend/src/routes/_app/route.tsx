import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/lib/db";

// The local database lives in this window (or on this PC via the Python backend), so these pages render client-side.
export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    await getDb();
  },
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /> Opening your local database…
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">The local database could not open</h1>
        <p className="mt-2 text-sm text-muted-foreground">{(error as Error).message}</p>
        <button className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => location.reload()}>Try again</button>
      </div>
    </div>
  ),
  component: AppShell,
});
