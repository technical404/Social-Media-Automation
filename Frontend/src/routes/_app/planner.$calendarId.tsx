import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowLeft, Loader2, Plus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventWorkspace } from "@/components/event-workspace";
import { GenerateDialog } from "@/components/generate-dialog";
import { ProposalReview } from "@/components/proposal-review";
import { TopicReview } from "@/components/topic-review";
import { EventFormDialog } from "@/components/event-form-dialog";
import { todayIn, useRefresh } from "@/lib/hooks";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/planner/$calendarId")({
  validateSearch: (s) => z.object({ generate: z.boolean().optional(), date: z.string().optional(), client: z.string().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "Calendar — SocialAI Studio Event Planner" },
      { name: "description", content: "Three-month event calendar with posting times, list view and bulk actions." },
      { property: "og:title", content: "Calendar — SocialAI Studio" },
      { property: "og:description", content: "Three-month event calendar with posting times and approvals." },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const { calendarId } = Route.useParams();
  const search = Route.useSearch();
  const refresh = useRefresh();
  const { data: cal, isLoading } = useQuery({ queryKey: ["calendar", calendarId], queryFn: () => repo.getCalendar(calendarId) });
  const { data: events } = useQuery({ queryKey: ["events", calendarId], queryFn: () => repo.listEvents(calendarId) });
  const { data: run } = useQuery({ queryKey: ["run", calendarId], queryFn: () => repo.getPreviewRun(calendarId) });
  const { data: topicRun } = useQuery({ queryKey: ["run-topics", calendarId], queryFn: () => repo.getPreviewRun(calendarId, "topics") });
  const [genOpen, setGenOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [wsKey, setWsKey] = useState(0);
  const [focus, setFocus] = useState<string | undefined>(search.date);

  const navigate = Route.useNavigate();
  useEffect(() => {
    if (!search.generate) return;
    setGenOpen(true);
    // One-shot: don't reopen the AI dialog on reload.
    navigate({ search: (s) => ({ ...s, generate: undefined }), replace: true });
  }, [search.generate, navigate]);

  if (isLoading || !events) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!cal) return <p>Calendar not found. <Link to="/planner" className="text-primary underline">Back to Event Planner</Link></p>;

  const topicFirst = Boolean(topicRun && (!run || topicRun.created_at > run.created_at));
  const eventReview = run && <ProposalReview key={run.id} run={run} calendar={cal} onDone={async () => { await refresh(); setWsKey((k) => k + 1); }} />;
  const topicReview = topicRun && <TopicReview key={topicRun.id} run={topicRun} calendar={cal} onDone={async () => { await refresh(); }} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/planner" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All calendars</Link>
          <h1 className="text-3xl font-semibold sm:text-4xl">{cal.name}</h1>
          <p className="mt-1 text-muted-foreground">{[cal.industry || "General", cal.region, cal.theme].filter(Boolean).join(" · ")} · {events.length} event{events.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAdding(true)}><Plus /> Add event</Button>
          <Button variant="highlight" onClick={() => setGenOpen(true)}><Wand2 /> Ask AI</Button>
        </div>
      </div>

      {topicFirst ? <>{topicReview}{eventReview}</> : <>{eventReview}{topicReview}</>}

      <EventWorkspace key={`${cal.id}-${wsKey}-${focus ?? ""}`} calendar={cal} events={events} focusDate={focus} />

      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} calendar={cal} selectedDates={[]} initialClientId={search.client} onProposed={(d) => { refresh(); if (d) setFocus(undefined); }} />
      <EventFormDialog open={adding} onOpenChange={setAdding} calendarId={cal.id} event={null} defaultDate={todayIn(cal.timezone)} onSaved={refresh} />
    </div>
  );
}
