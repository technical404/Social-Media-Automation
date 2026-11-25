import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EventWorkspace } from "@/components/event-workspace";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL_CLIENTS, clientThemes, filterEventsForClient } from "@/lib/client-view";
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
  const { data: events = [] } = useQuery({ queryKey: ["global-events"], queryFn: repo.listGlobalEvents, enabled: !!cal });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const [clientFilter, setClientFilter] = useState(ALL_CLIENTS);
  const [themeOnly, setThemeOnly] = useState(true);
  const { data: clientCalendars = [] } = useQuery({
    queryKey: ["client-calendars", clientFilter],
    queryFn: () => repo.listCalendarsByClient(clientFilter),
    enabled: clientFilter !== ALL_CLIENTS,
  });
  const { data: clientEvents = [] } = useQuery({
    queryKey: ["client-visible-events", clientFilter],
    queryFn: () => repo.listClientVisibleEvents(clientFilter),
    enabled: clientFilter !== ALL_CLIENTS,
  });

  const selectedClient = clients.find((c) => c.id === clientFilter) ?? null;
  const themes = clientThemes(selectedClient, clientCalendars);
  const visibleEvents = selectedClient ? filterEventsForClient(clientEvents, selectedClient, themes, themeOnly) : events;
  const workspaceCalendar = selectedClient ? clientCalendars[0] ?? cal : cal;

  return (
    <div>
      <PageHeader
        title={selectedClient ? `${selectedClient.name} calendar` : "Event Calendar"}
        subtitle={selectedClient
          ? "This client's Global Calendar view: its own events plus shared events in its category and scope."
          : "The Global Calendar in one place. Clients follow it and only pick their own times."}
        actions={
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-56" aria-label="Client view"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CLIENTS}>All clients (shared master)</SelectItem>
              {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
      {selectedClient && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card px-4 py-3 text-sm">
          <p>
            Showing <strong>{selectedClient.name}</strong>
            {selectedClient.industry ? <> · category <strong>{selectedClient.industry}</strong></> : null}
            {themes.length ? <> · theme <strong>{themes.join(", ")}</strong></> : null}
          </p>
          {!selectedClient.industry && (
            <span className="text-xs text-muted-foreground">Set the client industry/category to see matching shared events.</span>
          )}
          {themes.length > 0 && (
            <label htmlFor="calendar-theme-only" className="flex items-center gap-2 text-muted-foreground">
              <Checkbox id="calendar-theme-only" checked={themeOnly} onCheckedChange={(v) => setThemeOnly(v === true)} />
              Only events matching this theme
            </label>
          )}
          {!clientCalendars.length && <span className="text-xs text-muted-foreground">This client has no calendar yet; showing the filtered master view.</span>}
        </div>
      )}
      {!cal || !workspaceCalendar
        ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
        : <EventWorkspace key={`${workspaceCalendar.id}-${clientFilter}`} calendar={workspaceCalendar} events={visibleEvents} />}
    </div>
  );
}
