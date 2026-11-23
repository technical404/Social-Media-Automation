import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CATEGORY_DOT } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { toISODate } from "@/lib/dates";

export type DayItem = { name: string; category: string; approval_status: string; publish_status: string; time?: string };

type Props = {
  start: Date; // any date in the first visible month
  onShift: (months: number) => void;
  items: Map<string, DayItem[]>;
  selected?: Set<string> | undefined;
  onDayClick?: ((iso: string) => void) | undefined;
  today?: string | undefined;
  compact?: boolean | undefined;
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function Month({ month, items, selected, onDayClick, today, compact }: Omit<Props, "start" | "onShift"> & { month: Date }) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  return (
    <div className={cn("rounded-2xl border bg-card shadow-soft", compact ? "p-3" : "p-4")} data-month={format(month, "yyyy-MM")}>
      <h3 className={cn("mb-3 text-center font-semibold", compact ? "text-base" : "text-lg")}>{format(month, "MMMM yyyy")}</h3>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const iso = toISODate(d);
          if (!isSameMonth(d, month)) return <div key={iso} className="aspect-square" aria-hidden />;
          const list = items.get(iso) ?? [];
          const has = list.length > 0;
          const scheduled = list.some((x) => x.publish_status === "scheduled" || x.publish_status === "published");
          const pending = list.some((x) => x.approval_status === "pending_review");
          const failed = list.some((x) => x.publish_status === "failed");
          const isSel = selected?.has(iso);
          const cats = [...new Set(list.map((x) => x.category))].slice(0, 3);
          const cell = (
            <button
              type="button"
              data-date={iso}
              onClick={() => onDayClick?.(iso)}
              aria-pressed={isSel}
              aria-label={`${format(d, "MMMM d, yyyy")}${has ? `, ${list.length} event${list.length > 1 ? "s" : ""}` : ""}${isSel ? ", selected" : ""}`}
              className={cn(
                "relative flex aspect-square w-full flex-col items-center justify-center rounded-lg text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                has ? (scheduled ? "bg-highlight font-semibold text-highlight-foreground hover:bg-highlight/85" : "bg-secondary font-semibold text-secondary-foreground hover:bg-secondary/70") : "hover:bg-muted",
                isSel && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                today === iso && !isSel && "outline outline-1 outline-primary",
              )}
            >
              <span className="tabular-nums">{d.getDate()}</span>
              {has && (
                <span className="mt-0.5 flex gap-0.5" aria-hidden>
                  {cats.map((c) => (
                    <span key={c} className={cn("h-1.5 w-1.5 rounded-full ring-1 ring-card", CATEGORY_DOT[c] ?? "bg-muted-foreground")} />
                  ))}
                </span>
              )}
              {list.length > 1 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{list.length}</span>
              )}
              {pending && <span className="absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-warning ring-1 ring-card" aria-hidden />}
              {failed && <span className="absolute bottom-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />}
            </button>
          );
          return has ? (
            <Tooltip key={iso}>
              <TooltipTrigger asChild>{cell}</TooltipTrigger>
              <TooltipContent className="max-w-60">
                {list.slice(0, 5).map((l, i) => (
                  <div key={i}>{l.time ? `${l.time} · ` : ""}{l.name}</div>
                ))}
                {list.length > 5 && <div>+{list.length - 5} more</div>}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div key={iso}>{cell}</div>
          );
        })}
      </div>
    </div>
  );
}

/** Always three consecutive months in one row (scrolls sideways on narrow screens). */
export function ThreeMonthCalendar({ start, onShift, items, selected, onDayClick, today, compact }: Props) {
  const first = startOfMonth(start);
  const months = [0, 1, 2].map((i) => addMonths(first, i));
  return (
    <TooltipProvider delayDuration={100}>
      <div className="mb-3 flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => onShift(-3)} aria-label="Previous three months">
          <ChevronLeft /> Prev
        </Button>
        <p className="text-sm font-medium text-muted-foreground" data-testid="calendar-range">
          {format(first, "MMMM yyyy")} | {format(addMonths(first, 1), "MMMM yyyy")} | {format(addMonths(first, 2), "MMMM yyyy")}
        </p>
        <Button variant="outline" size="sm" onClick={() => onShift(3)} aria-label="Next three months">
          Next <ChevronRight />
        </Button>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className={cn("grid grid-cols-3 gap-4", compact ? "min-w-[640px]" : "min-w-[780px]")}>
          {months.map((m) => (
            <Month key={m.toISOString()} month={m} items={items} selected={selected} onDayClick={onDayClick} today={today} compact={compact} />
          ))}
        </div>
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {Object.entries(CATEGORY_DOT).map(([c, cls]) => (
            <span key={c} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", cls)} />{c}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />Needs review</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-highlight" />Scheduled</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" />Failed</span>
        </div>
      )}
    </TooltipProvider>
  );
}
