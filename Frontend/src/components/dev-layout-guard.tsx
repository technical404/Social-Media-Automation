import { useEffect, useState } from "react";

import { auditLayout, issueSignature, type LayoutIssue } from "@/lib/layout-audit";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "dev-layout-guard";
const MARK_ATTR = "data-layout-issue";

/**
 * Dev-only overlay that audits the rendered page for overlapping / spilling / clipped boxes.
 * Mounted from the root route behind `import.meta.env.DEV`, so it never ships to users.
 *
 * It renders nothing while the page is clean. When it finds something it shows a small badge
 * ("layout 3") that can expand into the exact list, outline the offenders, or be hidden for the
 * rest of the session. Hide it permanently for this browser with
 * `localStorage.setItem("dev-layout-guard", "off")`, or with `?layout-guard=off` in the URL.
 */
export function DevLayoutGuard() {
  const [issues, setIssues] = useState<LayoutIssue[]>([]);
  const [highlight, setHighlight] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.search.includes("layout-guard=off")) return;
    if (window.localStorage.getItem(STORAGE_KEY) === "off") return;

    let timer: number | undefined;
    let known = new Set<string>();

    const clearMarks = () => {
      document.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => el.removeAttribute(MARK_ATTR));
    };

    const run = () => {
      const found = auditLayout();
      clearMarks();
      found.forEach((issue) => {
        issue.element.setAttribute(MARK_ATTR, issue.kind);
        issue.other?.setAttribute(MARK_ATTR, issue.kind);
      });

      const signatures = new Set(found.map(issueSignature));
      const fresh = found.filter((issue) => !known.has(issueSignature(issue)));
      if (fresh.length > 0) {
        console.groupCollapsed(
          `%c[layout] ${found.length} issue${found.length === 1 ? "" : "s"} (${fresh.length} new)`,
          "color:#e11d48;font-weight:600",
        );
        for (const issue of found) console.warn(`${issue.kind}: ${issue.detail}`, issue.element);
        console.groupEnd();
      }
      known = signatures;
      setIssues(found);
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 400);
    };

    run();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    window.addEventListener("resize", schedule);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      clearMarks();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("layout-guard-highlight", highlight);
  }, [highlight]);

  if (issues.length === 0 || dismissed) return null;

  const counts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.kind] = (acc[issue.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div
      data-layout-ignore
      className="fixed bottom-3 left-3 z-[100] w-[min(28rem,calc(100vw-1.5rem))] rounded-xl border border-destructive/40 bg-card/95 text-xs shadow-lift backdrop-blur"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <span className="font-semibold text-destructive">layout {issues.length}</span>
        {Object.entries(counts).map(([kind, count]) => (
          <span key={kind} className="text-muted-foreground">
            {kind} {count}
          </span>
        ))}
        <button
          type="button"
          className="ml-auto rounded px-1.5 py-0.5 font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((on) => !on)}
          aria-expanded={expanded}
        >
          {expanded ? "less" : "list"}
        </button>
        <button
          type="button"
          className={cn("rounded px-1.5 py-0.5 font-medium", highlight ? "bg-destructive/10 text-destructive" : "text-muted-foreground")}
          onClick={() => setHighlight((on) => !on)}
        >
          outline
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 font-medium text-muted-foreground hover:text-foreground"
          onClick={() => {
            window.localStorage.setItem(STORAGE_KEY, "off");
            setDismissed(true);
          }}
          title="Hide for this session"
        >
          hide
        </button>
      </div>

      {expanded && (
        <ul className="max-h-56 overflow-auto border-t px-2 py-1.5">
          {issues.map((issue, i) => (
            <li key={`${issue.kind}-${i}`}>
              <button
                type="button"
                className="w-full rounded px-1.5 py-1 text-left font-mono text-[11px] leading-snug hover:bg-accent/50"
                onClick={() => issue.element.scrollIntoView({ block: "center" })}
              >
                <span className={cn("font-semibold uppercase", issue.kind === "overlap" ? "text-destructive" : issue.kind === "escape" ? "text-warning" : "text-primary")}>
                  {issue.kind}
                </span>{" "}
                {issue.detail}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}