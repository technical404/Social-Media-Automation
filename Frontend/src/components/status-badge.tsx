import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/platforms";

const STYLE: Record<string, string> = {
  pending_review: "bg-warning text-warning-foreground",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-warning text-warning-foreground",
  not_scheduled: "bg-muted text-muted-foreground",
  scheduled: "bg-primary text-primary-foreground",
  published: "bg-success text-success-foreground",
  failed: "bg-destructive text-destructive-foreground",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", STYLE[status] ?? "bg-muted", className)}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Category colour tokens (calendar dots + tile chips). */
export const CATEGORY_DOT: Record<string, string> = {
  "Awareness day": "bg-chart-1",
  "Awareness week": "bg-chart-5",
  "Awareness month": "bg-chart-4",
  Holiday: "bg-highlight",
  "Industry event": "bg-chart-3",
  "Campaign idea": "bg-chart-2",
  Other: "bg-muted-foreground",
};

export function CategoryChip({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium">
      <span className={cn("h-2 w-2 rounded-full", CATEGORY_DOT[category] ?? "bg-muted-foreground")} aria-hidden />
      {category}
    </span>
  );
}
