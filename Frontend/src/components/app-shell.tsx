import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  CalendarRange,
  Cpu,
  Database,
  FileText,
  HardDrive,
  Image,
  LayoutDashboard,
  Megaphone,
  Menu,
  PenLine,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Workflow,
  BarChart3,
  Wifi,
  WifiOff,
  X,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { envQuery, settingsQuery, useAppSettings, useNow, useOnline, todayIn } from "@/lib/hooks";
import * as repo from "@/lib/repo";
import { formatMDY } from "@/lib/dates";
import { SCOPE_LABEL } from "@/lib/global-calendar";

const NAV: { section: string; items: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[] }[] = [
  { section: "Overview", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    section: "Planning",
    items: [
      { to: "/planner", label: "Global Calendar", icon: CalendarDays },
      { to: "/calendar", label: "Event Calendar", icon: CalendarRange },
    ],
  },
  { section: "AI Studio", items: [{ to: "/studio", label: "Content Studio", icon: Sparkles }, { to: "/brand", label: "Brand Voice", icon: PenLine }] },
  { section: "Content", items: [{ to: "/posts", label: "Posts & Approvals", icon: FileText }, { to: "/post-calendar", label: "Post Calendar", icon: CalendarRange }, { to: "/media", label: "Media Library", icon: Image }] },
  { section: "Clients", items: [{ to: "/clients", label: "Clients", icon: Users }] },
  { section: "Campaigns", items: [{ to: "/campaigns", label: "Campaigns", icon: Megaphone }, { to: "/accounts", label: "Social Accounts", icon: Share2 }] },
  { section: "AI Management", items: [{ to: "/providers", label: "AI Provider Manager", icon: Cpu }] },
  { section: "Insights", items: [{ to: "/analytics", label: "Analytics", icon: BarChart3 }, { to: "/automation", label: "Automation", icon: Workflow }] },
  {
    section: "System",
    items: [
      { to: "/activity", label: "Activity Logs", icon: Activity },
      { to: "/database", label: "Database & Backup", icon: Database },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-5" aria-label="Main">
      {NAV.map((g) => (
        <div key={g.section}>
          <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/45">{g.section}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((n) => {
              const active = path === n.to || path.startsWith(`${n.to}/`);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <n.icon className={cn("h-4 w-4", active && "text-sidebar-primary")} />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-primary font-display text-lg font-semibold text-sidebar-primary-foreground">S</span>
      <span className="leading-tight">
        <span className="block font-display text-lg font-semibold text-sidebar-foreground">SocialAI Studio</span>
        <span className="block text-[10px] uppercase tracking-widest text-sidebar-foreground/50">Local edition</span>
      </span>
    </Link>
  );
}

function StatusChips() {
  const { data: env } = useQuery(envQuery);
  const online = useOnline();
  const hb = env?.health?.worker.heartbeat_at;
  const workerOk = env?.mode === "python" && !!env.health?.worker.running && !!hb && Date.now() - new Date(hb).getTime() < 60000;
  // Icons always, labels only when there is room, so the header can never be crowded into overlap.
  const label = "hidden 2xl:inline";
  return (
    <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium"
        title={`${env?.location ?? "Opening database..."} — data store`}
      >
        <HardDrive className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className={label}>{env ? (env.mode === "python" ? "Data: this PC" : "Data: this browser") : "Opening..."}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium" title={online ? "Online" : "Offline"}>
        {online ? <Wifi className="h-3.5 w-3.5 shrink-0 text-success" /> : <WifiOff className="h-3.5 w-3.5 shrink-0 text-destructive" />}
        <span className={label}>{online ? (env?.mode === "python" || !env ? "Online" : "Online · no PC backend") : "Offline"}</span>
      </span>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium"
        title={env?.mode === "python" ? `Worker ${workerOk ? "running" : "stopped"} · heartbeat ${hb ?? "never"}` : "The background worker runs only with python main.py"}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", workerOk ? "bg-success" : "bg-muted-foreground")} />
        <span className={label}>Worker {workerOk ? "running" : env?.mode === "python" ? "stopped" : "off (browser mode)"}</span>
      </span>
    </div>
  );
}

function Clock() {
  const { timezone } = useAppSettings();
  const now = useNow(15000);
  if (!now) return <span className="hidden w-40 shrink-0 lg:block" />;
  const text = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }).format(now);
  return (
    <Link to="/settings" className="hidden w-40 min-w-0 shrink-0 text-right text-xs leading-tight lg:block" title={`Time zone: ${timezone} · change it in Settings`}>
      <span className="block truncate font-semibold tabular-nums">{text}</span>
      <span className="block truncate text-muted-foreground">{timezone}</span>
    </Link>
  );
}

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { data: hits = [] } = useQuery({ queryKey: ["search", q], queryFn: () => repo.searchEvents(q), enabled: open && q.trim().length > 1 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = (fn: () => void) => {
    setOpen(false);
    setQ("");
    fn();
  };
  return (
    <>
      <Button variant="outline" className="h-9 w-full min-w-0 max-w-xs shrink justify-start gap-2 text-muted-foreground" onClick={() => setOpen(true)} aria-label="Search">
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">Search events & pages</span>
        <kbd className="ml-auto hidden shrink-0 rounded border bg-muted px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type an event name or a page…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {hits.length > 0 && (
            <CommandGroup heading="Events">
              {hits.map((e) => (
                <CommandItem key={e.id} value={`${e.name} ${e.id}`} onSelect={() => go(() => navigate({ to: "/planner/$calendarId", params: { calendarId: e.calendar_id }, search: { date: e.start_date } }))}>
                  <span className="font-semibold tabular-nums">{formatMDY(e.start_date)}</span>
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{e.calendar_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Pages">
            {NAV.flatMap((g) => g.items).map((n) => (
              <CommandItem key={n.to} value={n.label} onSelect={() => go(() => navigate({ to: n.to }))}>
                <n.icon className="h-4 w-4" /> {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

function QuickCreate() {
  const navigate = useNavigate();
  const { data: gcal } = useQuery({ queryKey: ["global-calendar"], queryFn: repo.ensureGlobalCalendar });
  const openGlobal = (search: { generate?: boolean } = {}) => {
    if (gcal) navigate({ to: "/planner/$calendarId", params: { calendarId: gcal.id }, search });
    else navigate({ to: "/planner" });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="highlight" size="sm" className="h-9" aria-label="Quick create">
          <Plus /> <span className="hidden sm:inline">Create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate({ to: "/planner" })}>Open Global Calendar</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openGlobal({ generate: true })}>Generate events with AI</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/providers", search: { new: true } })}>Add AI provider</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Header widget: the next few things on the Global Calendar. */
function WhatsOn() {
  const { timezone } = useAppSettings();
  const today = todayIn(timezone);
  const { data: events = [] } = useQuery({ queryKey: ["global-events"], queryFn: repo.listGlobalEvents });
  const next = events.filter((e) => e.start_date >= today).slice(0, 6);
  const head = next[0];
  const headText = head ? `${formatMDY(head.start_date)} · ${head.name}` : "";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 min-w-0 max-w-[10rem] shrink sm:max-w-[13rem] xl:max-w-[18rem]"
          aria-label="What's on"
          title={headText || "What's on"}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-highlight" />
          <span className="min-w-0 truncate">{headText || "What's on"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <p className="border-b px-4 py-2.5 text-sm font-semibold">What's on</p>
        <ul className="max-h-80 overflow-auto">
          {next.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing coming up yet.</li>}
          {next.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b px-4 py-2.5 text-sm last:border-0">
              <span className="w-14 shrink-0 font-semibold tabular-nums">{formatMDY(e.start_date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{SCOPE_LABEL[e.scope ?? "GLOBAL"] ?? e.scope}</span>
              </span>
            </li>
          ))}
        </ul>
        <Link to="/planner" className="block border-t px-4 py-2 text-center text-xs font-semibold text-primary hover:underline">Open the Global Calendar</Link>
      </PopoverContent>
    </Popover>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const { notificationsSeenAt } = useAppSettings();
  const { data: items = [] } = useQuery({ queryKey: ["activity", "recent"], queryFn: () => repo.listActivity(8) });
  const unread = items.filter((i) => i.created_at > notificationsSeenAt).length;
  return (
    <Popover
      onOpenChange={async (o) => {
        if (!o && items[0]) {
          await repo.setSetting("notifications_seen_at", items[0].created_at);
          qc.invalidateQueries({ queryKey: settingsQuery.queryKey });
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} new` : ""}`}>
          <Bell />
          {unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-highlight px-1 text-[10px] font-bold text-highlight-foreground">{unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-2.5 text-sm font-semibold">Notifications</p>
        <ul className="max-h-80 overflow-auto">
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}
          {items.map((i) => (
            <li key={i.id} className={cn("border-b px-4 py-2.5 text-sm last:border-0", i.created_at > notificationsSeenAt && "bg-accent/40")}>
              <p>{i.summary}</p>
              <p className="text-xs text-muted-foreground">{new Date(i.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
        <Link to="/activity" className="block border-t px-4 py-2 text-center text-xs font-semibold text-primary hover:underline">See all activity</Link>
      </PopoverContent>
    </Popover>
  );
}

function ThemeSync() {
  const { theme } = useAppSettings();
  useEffect(() => {
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [theme]);
  return null;
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[256px_1fr]">
      <ThemeSync />
      <aside className="sticky top-0 hidden h-screen flex-col gap-7 overflow-y-auto bg-sidebar p-5 lg:flex">
        <Brand />
        <NavList />
        <p className="mt-auto px-3 text-[11px] leading-snug text-sidebar-foreground/45">More sections (Content Studio, Social accounts, Automation, Reports) arrive as each step is built and tested.</p>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-7 overflow-y-auto bg-sidebar p-5">
            <div className="flex items-center justify-between">
              <Brand />
              <Button variant="sidebar" size="icon" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/90 px-3 py-2.5 backdrop-blur sm:gap-3 sm:px-6">
          <Button variant="outline" size="icon" className="shrink-0 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <GlobalSearch />
          <StatusChips />
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            <Clock />
            <WhatsOn />
            <Notifications />
            <QuickCreate />
          </div>
        </header>
        <main className="px-4 py-6 sm:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string | undefined; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center">
      <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
