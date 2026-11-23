import { useMemo, useRef, useState } from "react";
import type { ParsingOptions, WorkBook } from "xlsx";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CATEGORIES } from "@/lib/planner";
import { pad } from "@/lib/dates";
import { downloadFile } from "@/lib/hooks";
import * as repo from "@/lib/repo";
import { cn } from "@/lib/utils";
import {
  FIELD_LABELS,
  MAX_IMPORT_ROWS,
  autoMapColumns,
  cellToText,
  draftsFromMatrix,
  existingKeySet,
  findHeaderRow,
  localeUsesMonthFirst,
  normalizeHashtags,
  normalizePlatforms,
  normalizeSourceUrl,
  toEventInput,
  validateDrafts,
  type ImportCheck,
  type ImportDraft,
  type ImportField,
} from "@/lib/sheet-import";

type XlsxApi = typeof import("xlsx");

let xlsxPromise: Promise<XlsxApi> | null = null;
function loadXlsx(): Promise<XlsxApi> {
  if (!xlsxPromise) {
    xlsxPromise = import("xlsx").then((mod) => {
      const withDefault = mod as unknown as { default?: XlsxApi };
      return withDefault.default ?? (mod as XlsxApi);
    });
  }
  return xlsxPromise;
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function localIsoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function blankDraft(): ImportDraft {
  const today = localIsoToday();
  return {
    key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    start_date: today,
    end_date: today,
    time: "",
    time_raw: "",
    category: "Other",
    content_type: "",
    platform_text: "",
    platforms: [],
    hashtag_text: "",
    hashtags: [],
    short_description: "",
    detailed_description: "",
    campaign_topic: "",
    importance: "medium",
    source_raw: "",
    source_url: "",
    include: true,
  };
}

function RowStatus({ check }: { check: ImportCheck }) {
  const hasError = check.problems.some((p) => p.level === "error");
  const label = hasError ? "Needs fix" : check.duplicate ? "Skipped" : check.problems.length ? "Check" : "Ready";
  const tone = hasError
    ? "bg-destructive/10 text-destructive"
    : check.duplicate || check.problems.length
      ? "bg-amber-500/15 text-amber-700"
      : "bg-emerald-500/15 text-emerald-700";
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", tone)}>{hasError || check.duplicate ? <AlertTriangle className="h-3 w-3" /> : null}{label}</span>;
}

export function ImportSheetDialog({
  open,
  onOpenChange,
  calendarId,
  calendarName,
  scope,
  existingEvents,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  calendarId: string;
  calendarName: string;
  scope: string;
  existingEvents: { start_date: string; name: string }[];
  onImported: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [matrix, setMatrix] = useState<unknown[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [monthFirst, setMonthFirst] = useState(() => localeUsesMonthFirst(typeof navigator === "undefined" ? "en-US" : navigator.language));
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const existingKeys = useMemo(() => existingKeySet(existingEvents), [existingEvents]);
  const checks = useMemo(() => validateDrafts(drafts, existingKeys), [drafts, existingKeys]);
  const readyCount = drafts.reduce((count, row, index) => count + (row.include && checks[index]?.canInclude ? 1 : 0), 0);
  const errorCount = checks.filter((check) => check.problems.some((problem) => problem.level === "error")).length;
  const skippedCount = checks.filter((check) => check.duplicate).length;

  function reset() {
    setFileName("");
    setWorkbook(null);
    setSheetNames([]);
    setSheetName("");
    setMatrix([]);
    setHeaders([]);
    setMapping([]);
    setDrafts([]);
    setExpanded(new Set());
    setBusy(false);
    setImporting(false);
    setError("");
    setNotice("");
  }

  function handleOpen(next: boolean) {
    if (!next && importing) return;
    onOpenChange(next);
    if (!next) reset();
  }

  async function loadSheet(wb: WorkBook, name: string, monthFirstOrder: boolean) {
    setError("");
    setNotice("");
    const XLSX = await loadXlsx();
    const sheet = wb.Sheets[name];
    if (!sheet) {
      setError(`Sheet “${name}” could not be read.`);
      return;
    }
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    if (!raw.length) {
      setError("This sheet is empty.");
      return;
    }
    const headerRow = findHeaderRow(raw);
    const width = raw.reduce((max, row) => Math.max(max, row.length), 0);
    const headerCells = raw[headerRow] ?? [];
    const nextHeaders = Array.from({ length: width }, (_, index) => cellToText(headerCells[index]));
    const data = raw.slice(headerRow + 1);
    const truncated = data.length > MAX_IMPORT_ROWS;
    const nextMatrix: unknown[][] = [nextHeaders, ...data.slice(0, MAX_IMPORT_ROWS)];
    const nextMapping = autoMapColumns(nextHeaders);

    setMatrix(nextMatrix);
    setHeaders(nextHeaders);
    setMapping(nextMapping);
    setExpanded(new Set());
    setDrafts(draftsFromMatrix(nextMatrix, nextMapping, { monthFirst: monthFirstOrder }));
    if (!nextMapping.some((field) => field !== "ignore")) {
      setError("No columns were recognised. Match at least Topic and Date below.");
    } else if (truncated) {
      setNotice(`Only the first ${MAX_IMPORT_ROWS} rows were loaded.`);
    }
  }

  async function onFile(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("That file is larger than 15 MB.");
      const XLSX = await loadXlsx();
      const buffer = await file.arrayBuffer();
      let wb: WorkBook;
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        const options: ParsingOptions = { type: "string", cellDates: false };
        if (/\.tsv$/i.test(file.name)) options.FS = "\t";
        wb = XLSX.read(new TextDecoder().decode(buffer), options);
      } else {
        // Keep Excel serials as numbers: cellDates can shift a date to 23:59:50 the day before.
        wb = XLSX.read(buffer, { type: "array", cellDates: false });
      }
      const names = wb.SheetNames.filter(Boolean);
      if (!names.length) throw new Error("No sheets were found in this file.");
      const first = names[0] ?? "";
      setFileName(file.name);
      setWorkbook(wb);
      setSheetNames(names);
      setSheetName(first);
      await loadSheet(wb, first, monthFirst);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function changeSheet(name: string) {
    if (!workbook) return;
    setSheetName(name);
    setBusy(true);
    try {
      await loadSheet(workbook, name, monthFirst);
    } finally {
      setBusy(false);
    }
  }

  function changeMapping(index: number, field: ImportField) {
    const next = [...mapping];
    if (field !== "ignore") {
      next.forEach((current, i) => {
        if (i !== index && current === field) next[i] = "ignore";
      });
    }
    next[index] = field;
    setMapping(next);
    setDrafts(draftsFromMatrix(matrix, next, { monthFirst }));
    setExpanded(new Set());
  }

  function changeMonthFirst(next: boolean) {
    setMonthFirst(next);
    setDrafts(draftsFromMatrix(matrix, mapping, { monthFirst: next }));
    setExpanded(new Set());
  }

  function updateRow(key: string, patch: Partial<ImportDraft>) {
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setDrafts((rows) => rows.filter((row) => row.key !== key));
  }

  function toggleExpanded(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function downloadTemplate() {
    const csv = [
      "Topic,Date,Content type,Platform,Category,Time,Description,Hashtags,Source",
      '"World AIDS Day","2026-12-01","Carousel","instagram, linkedin","Awareness day","10:00","One-line caption idea","#WorldAIDSDay #Awareness","https://www.who.int"',
    ].join("\r\n");
    downloadFile("socialai-import-template.csv", csv, "text/csv;charset=utf-8");
  }

  async function applyImport() {
    const picked = drafts.filter((row, index) => row.include && checks[index]?.canInclude);
    if (!picked.length) return;
    setImporting(true);
    let saved = 0;
    const failures: string[] = [];
    for (const row of picked) {
      try {
        await repo.createEvent(calendarId, toEventInput(row, scope));
        saved++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${row.name}: ${/UNIQUE/i.test(message) ? "already exists on that date" : message}`);
      }
    }
    try {
      await repo.logActivity(
        "import.sheet",
        `Imported ${saved} event(s) into "${calendarName}" from ${fileName || "a sheet"}${failures.length ? ` · ${failures.length} failed` : ""}`,
        { level: failures.length ? "warning" : "success" },
      );
    } catch {
      // Activity logging must never block a successful import.
    }
    setImporting(false);

    if (saved) {
      toast.success(`${saved} event(s) imported — review and schedule them from the calendar`);
      onImported();
      onOpenChange(false);
      reset();
    }
    if (failures.length) {
      toast.error(`${failures.length} row(s) could not be imported: ${failures.slice(0, 3).join(" · ")}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] max-w-6xl overflow-hidden p-0">
        <div className="flex max-h-[92vh] min-h-0 flex-col">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-highlight" /> Import from sheet
            </DialogTitle>
            <DialogDescription>
              Upload .xlsx, .xls, .csv or .tsv. Match columns, fix any row, then import. Nothing is saved until you press Import.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/30 p-3">
              <div className="min-w-52 flex-1 space-y-1">
                <Label htmlFor="sheet-file">Spreadsheet</Label>
                <Input
                  ref={fileInput}
                  id="sheet-file"
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt"
                  disabled={busy || importing}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onFile(file);
                  }}
                />
                <p className="text-[11px] text-muted-foreground">Up to 15 MB · first {MAX_IMPORT_ROWS.toLocaleString()} data rows.</p>
              </div>
              <Button type="button" variant="outline" onClick={downloadTemplate} disabled={importing}>
                <Download /> Template
              </Button>
              {workbook && (
                <Button type="button" variant="ghost" onClick={reset} disabled={busy || importing}>
                  <X /> Clear
                </Button>
              )}
            </div>

            {error && <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
            {notice && <p className="rounded-xl border px-3 py-2 text-sm text-muted-foreground">{notice}</p>}

            {workbook && (
              <div className="flex flex-wrap items-end gap-3">
                {sheetNames.length > 1 && (
                  <div className="space-y-1">
                    <Label>Sheet</Label>
                    <Select value={sheetName} onValueChange={(value) => void changeSheet(value)} disabled={busy || importing}>
                      <SelectTrigger className="w-52" aria-label="Sheet">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sheetNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Ambiguous dates</Label>
                  <Select value={monthFirst ? "mdy" : "dmy"} onValueChange={(value) => changeMonthFirst(value === "mdy")} disabled={busy || importing}>
                    <SelectTrigger className="w-48" aria-label="Date order">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dmy">Day / Month / Year</SelectItem>
                      <SelectItem value="mdy">Month / Day / Year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-muted-foreground">Applies only to dates like 01/02/2026. Changing it re-reads the rows.</p>
              </div>
            )}

            {headers.length > 0 && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Match columns</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {fileName}
                    {sheetName ? ` · ${sheetName}` : ""} · {drafts.length} row(s)
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {headers.map((header, index) => (
                    <label key={`${header}-${index}`} className="space-y-1 rounded-lg border p-2">
                      <span className="block truncate text-[11px] font-medium text-muted-foreground" title={header}>
                        {header || `Column ${index + 1}`}
                      </span>
                      <Select value={mapping[index] ?? "ignore"} onValueChange={(value) => changeMapping(index, value as ImportField)} disabled={busy || importing}>
                        <SelectTrigger className="h-8" aria-label={`Map ${header || `column ${index + 1}`}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(FIELD_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Changing a match re-reads the rows and discards your edits.</p>
              </section>
            )}

            {drafts.length > 0 && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">Preview &amp; edit</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{readyCount} ready</span>
                  {errorCount > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">{errorCount} need a fix</span>}
                  {skippedCount > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700">{skippedCount} already in calendar</span>}
                  <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setDrafts((rows) => [...rows, blankDraft()])} disabled={importing}>
                    <Plus /> Add row
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Expand a row to edit description, end date, hashtags, source and importance.</p>

                <div className="hidden gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-[auto_8.5rem_5.5rem_minmax(9rem,1fr)_8.5rem_7.5rem_10rem_auto]">
                  <span title="Tick to include this row in the import">Use</span>
                  <span title="Event start date; the end date can be edited in the row details">Date</span>
                  <span title="Posting time; leave blank to use the calendar default">Time</span>
                  <span title="Event or observance name">Topic</span>
                  <span title="Calendar category used for filters and colour coding">Category</span>
                  <span title="Content format, such as Reel, Carousel or Static post">Type</span>
                  <span title="Comma-separated social platforms">Platforms</span>
                  <span />
                </div>

                <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                  {drafts.map((row, index) => {
                    const check = checks[index] ?? { problems: [], duplicate: false, canInclude: false };
                    const isOpen = expanded.has(row.key);
                    return (
                      <div key={row.key} className={cn("rounded-xl border p-2", check.problems.some((p) => p.level === "error") && "border-destructive/40 bg-destructive/5")}>
                        <div className="grid items-start gap-2 lg:grid-cols-[auto_8.5rem_5.5rem_minmax(9rem,1fr)_8.5rem_7.5rem_10rem_auto]">
                          <Checkbox
                            className="mt-2"
                            checked={row.include && check.canInclude}
                            disabled={!check.canInclude || importing}
                            onCheckedChange={(value) => updateRow(row.key, { include: value === true })}
                            aria-label={`Include ${row.name || `row ${index + 1}`}`}
                          />
                          <Input
                            type="date"
                            className="h-8"
                            aria-label="Date"
                            value={row.start_date}
                            disabled={importing}
                            onChange={(event) => {
                              const value = event.target.value;
                              const end = !row.end_date || row.end_date === row.start_date || row.end_date < value ? value : row.end_date;
                              updateRow(row.key, { start_date: value, end_date: end });
                            }}
                          />
                          <Input
                            type="time"
                            className="h-8"
                            aria-label="Posting time"
                            value={row.time}
                            disabled={importing}
                            onChange={(event) => updateRow(row.key, { time: event.target.value, time_raw: event.target.value })}
                          />
                          <div className="space-y-1">
                            <Input
                              className="h-8"
                              aria-label="Topic"
                              placeholder="Topic"
                              value={row.name}
                              disabled={importing}
                              onChange={(event) => updateRow(row.key, { name: event.target.value })}
                            />
                            <RowStatus check={check} />
                          </div>
                          <Select value={row.category} onValueChange={(value) => updateRow(row.key, { category: value })} disabled={importing}>
                            <SelectTrigger className="h-8" aria-label="Category">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map((category) => (
                                <SelectItem key={category} value={category}>
                                  {category}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            className="h-8"
                            aria-label="Content type"
                            placeholder="Reel, post…"
                            value={row.content_type}
                            disabled={importing}
                            onChange={(event) => updateRow(row.key, { content_type: event.target.value })}
                          />
                          <Input
                            className="h-8"
                            aria-label="Platforms"
                            placeholder="instagram, linkedin"
                            value={row.platform_text}
                            disabled={importing}
                            onChange={(event) => updateRow(row.key, { platform_text: event.target.value, platforms: normalizePlatforms(event.target.value) })}
                          />
                          <div className="flex items-start">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={isOpen ? "Hide row details" : "Show row details"}
                              onClick={() => toggleExpanded(row.key)}
                              disabled={importing}
                            >
                              {isOpen ? <ChevronDown /> : <ChevronRight />}
                            </Button>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${row.name || "row"}`} onClick={() => removeRow(row.key)} disabled={importing}>
                              <Trash2 />
                            </Button>
                          </div>
                        </div>

                        {check.problems.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 pl-8 text-[11px]">
                            {check.problems.map((problem, problemIndex) => (
                              <li key={problemIndex} className={problem.level === "error" ? "text-destructive" : "text-amber-700"}>
                                {problem.message}
                              </li>
                            ))}
                          </ul>
                        )}

                        {isOpen && (
                          <div className="mt-2 grid gap-2 border-t pt-2 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                              <Label className="text-[11px] text-muted-foreground">Short description</Label>
                              <Input
                                className="h-8"
                                placeholder="Caption or one-line idea"
                                value={row.short_description}
                                disabled={importing}
                                onChange={(event) => updateRow(row.key, { short_description: event.target.value })}
                              />
                            </div>
                            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                              <Label className="text-[11px] text-muted-foreground">Detailed description / notes</Label>
                              <Textarea rows={2} value={row.detailed_description} disabled={importing} onChange={(event) => updateRow(row.key, { detailed_description: event.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">End date</Label>
                              <Input type="date" className="h-8" value={row.end_date} disabled={importing} onChange={(event) => updateRow(row.key, { end_date: event.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Hashtags</Label>
                              <Input
                                className="h-8"
                                placeholder="#awareness #health"
                                value={row.hashtag_text}
                                disabled={importing}
                                onChange={(event) => updateRow(row.key, { hashtag_text: event.target.value, hashtags: normalizeHashtags(event.target.value) })}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Importance</Label>
                              <Select value={row.importance} onValueChange={(value) => updateRow(row.key, { importance: value as ImportDraft["importance"] })} disabled={importing}>
                                <SelectTrigger className="h-8" aria-label="Importance">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="high">High</SelectItem>
                                  <SelectItem value="medium">Medium</SelectItem>
                                  <SelectItem value="low">Low</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Campaign topic</Label>
                              <Input className="h-8" value={row.campaign_topic} disabled={importing} onChange={(event) => updateRow(row.key, { campaign_topic: event.target.value })} />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-[11px] text-muted-foreground">Source link (https only)</Label>
                              <Input
                                className="h-8"
                                placeholder="https://"
                                value={row.source_raw}
                                disabled={importing}
                                onChange={(event) => updateRow(row.key, { source_raw: event.target.value, source_url: normalizeSourceUrl(event.target.value) })}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {!drafts.length && !busy && headers.length === 0 && (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                <Upload className="mx-auto mb-2 h-8 w-8" />
                Choose a spreadsheet to preview its rows. Topics, dates, content types and platforms are matched automatically.
              </div>
            )}

            {busy && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the sheet…
              </p>
            )}
          </div>

          <DialogFooter className="border-t px-5 py-3">
            <div className="mr-auto text-xs text-muted-foreground">
              {drafts.length > 0
                ? `${readyCount} of ${drafts.length} selected · imported events need review before scheduling`
                : "Nothing imported yet"}
            </div>
            <Button type="button" variant="outline" onClick={() => handleOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void applyImport()} disabled={!readyCount || importing || busy}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              Import {readyCount || ""} event{readyCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
