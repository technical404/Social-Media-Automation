import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EventWorkspace } from "@/components/event-workspace";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/calendar")({
  head: () => ({
    meta: [
      { title: "Event Calendar — SocialAI Studio" },
      { name: "description", content: "The Global Calendar in one three-month view or list." },
      { property: "og:title", content: "Event Calendar — SocialAI Studio" },
      { property: "og:description", content: "The master calendar in one three-month view." },
    ],
  }),
  component: AllCalendar,
});

function AllCalendar() {
  const { data: cal } = useQuery({ queryKey: ["global-calendar"], queryFn: repo.ensureGlobalCalendar });
  const { data: events } = useQuery({ queryKey: ["global-events"], queryFn: repo.listGlobalEvents, enabled: !!cal });
  return (
    <div>
      <PageHeader title="Event Calendar" subtitle="The Global Calendar in one place. Clients follow it and only pick their own times." />
      {!cal || !events ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div> : <EventWorkspace key={cal.id} calendar={cal} events={events} />}
    </div>
  );
}
