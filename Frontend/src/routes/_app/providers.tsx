import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CheckCircle2, Cpu, FlaskConical, Loader2, Pencil, Plus, Trash2, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRefresh } from "@/lib/hooks";
import { classifyErrorTitle, fetchProviderModels, runAi } from "@/lib/ai/client";
import { Textarea } from "@/components/ui/textarea";
import { keyHint, saveKey } from "@/lib/secrets";
import * as repo from "@/lib/repo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/providers")({
  validateSearch: (s) => z.object({ new: z.boolean().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "AI Provider Manager — SocialAI Studio" },
      { name: "description", content: "Connect OpenAI, Claude, Gemini, NVIDIA NIM, Perplexity, Ollama or any compatible API." },
      { property: "og:title", content: "AI Provider Manager — SocialAI Studio" },
      { property: "og:description", content: "Configure and test your AI providers." },
    ],
  }),
  component: ProvidersPage,
});

const TYPES: Record<string, { label: string; protocol: string; base_url: string; model: string }> = {
  openai: { label: "OpenAI", protocol: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { label: "Anthropic Claude", protocol: "anthropic", base_url: "https://api.anthropic.com", model: "claude-3-5-haiku-latest" },
  gemini: { label: "Google Gemini", protocol: "gemini", base_url: "https://generativelanguage.googleapis.com", model: "gemini-2.0-flash" },
  nvidia: { label: "NVIDIA NIM", protocol: "openai", base_url: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-8b-instruct" },
  groq: { label: "Groq", protocol: "openai", base_url: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
  perplexity: { label: "Perplexity", protocol: "openai", base_url: "https://api.perplexity.ai", model: "sonar" },
  ollama: { label: "Ollama (on this PC)", protocol: "ollama", base_url: "http://localhost:11434/v1", model: "llama3.1" },
  custom: { label: "Other API (OpenAI-compatible)", protocol: "openai", base_url: "", model: "" },
  mock: { label: "Test provider (fixed answers)", protocol: "mock", base_url: "", model: "deterministic-test" },
};

type Form = repo.ProviderInput & { apiKey: string };

const blank = (): Form => ({
  name: "OpenAI",
  provider_type: "openai",
  protocol: "openai",
  base_url: TYPES["openai"]!.base_url,
  model_id: TYPES["openai"]!.model,
  context_window: null,
  max_output: 4096,
  thinking_effort: "none",
  image_input: 0,
  timeout_ms: 90000,
  retry_count: 1,
  enabled: 1,
  is_default: 0,
  fallback_priority: 100,
  apiKey: "",
});

function ProvidersPage() {
  const search = Route.useSearch();
  const refresh = useRefresh();
  const { data: list = [], isLoading } = useQuery({ queryKey: ["providers"], queryFn: repo.listProviders });
  const [editing, setEditing] = useState<repo.Provider | "new" | null>(search.new ? "new" : null);
  const [f, setF] = useState<Form>(blank());
  const [testing, setTesting] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, { id: string; name: string }[]>>({});
  const [pickedModel, setPickedModel] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [editComment, setEditComment] = useState<repo.ProviderComment | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [del, setDel] = useState<repo.Provider | null>(null);
  const { data: allComments = [] } = useQuery({
    queryKey: ["provider-comments", list.map((p) => p.id).join(",")],
    queryFn: async () => {
      const rows: repo.ProviderComment[] = [];
      for (const p of list) rows.push(...(await repo.listProviderComments(p.id)));
      return rows;
    },
    enabled: list.length > 0,
  });

  useEffect(() => {
    if (editing === "new") setF({ ...blank(), is_default: list.length ? 0 : 1 });
    else if (editing) {
      const { id: _i, has_api_key: _h, api_key_hint: _a, last_test_at: _t, last_test_ok: _o, last_test_ms: _m, last_test_message: _g, ...rest } = editing;
      setF({ ...rest, apiKey: "" });
    }
  }, [editing, list.length]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const pickType = (t: string) => {
    const p = TYPES[t]!;
    setF((x) => ({ ...x, provider_type: t, protocol: p.protocol, base_url: p.base_url, model_id: p.model, name: x.name && editing !== "new" ? x.name : p.label }));
  };

  async function save() {
    if (!f.name.trim()) return void toast.error("Give it a name.");
    if (f.protocol !== "mock" && (!f.base_url.trim() || !f.model_id.trim())) return void toast.error("Base URL and Model ID are needed.");
    const { apiKey, ...input } = f;
    const id = await repo.saveProvider(editing && editing !== "new" ? editing.id : null, { ...input, name: input.name.trim(), base_url: input.base_url.trim(), model_id: input.model_id.trim() });
    if (apiKey.trim()) {
      await saveKey(id, apiKey.trim());
      await repo.setProviderKeyMeta(id, keyHint(apiKey.trim()));
    }
    toast.success("Provider saved");
    setEditing(null);
    refresh();
  }

  async function addTest() {
    await repo.saveProvider(null, { ...blank(), name: "Test provider", provider_type: "mock", protocol: "mock", base_url: "", model_id: "deterministic-test", is_default: list.length ? 0 : 1, retry_count: 0 });
    toast.success("Test provider added — it returns fixed sample events for testing");
    refresh();
  }

  async function fetchModels(p: repo.Provider) {
    setFetching(p.id);
    try {
      const listM = await fetchProviderModels(p.id);
      setModels((m) => ({ ...m, [p.id]: listM }));
      await repo.addProviderComment(p.id, "system", "Fetched models", `${listM.length} model(s) returned. Click a model then Save selected model.`);
      toast.success(`${listM.length} models from ${p.name}`);
    } catch (e) {
      const msg = (e as Error).message;
      await repo.addProviderComment(p.id, "error", classifyErrorTitle(msg), msg);
      toast.error(msg);
    } finally {
      setFetching(null);
      refresh();
    }
  }

  async function savePickedModel(p: repo.Provider) {
    const mid = pickedModel[p.id];
    if (!mid) return toast.error("Click a model first.");
    const { id, has_api_key: _h, api_key_hint: _a, last_test_at: _t, last_test_ok: _o, last_test_ms: _m, last_test_message: _g, ...rest } = p;
    await repo.saveProvider(id, { ...rest, model_id: mid });
    await repo.addProviderComment(p.id, "system", "Model selected", `Active model is now ${mid}.`);
    toast.success(`Saved model ${mid}`);
    refresh();
  }

  async function test(p: repo.Provider) {
    setTesting(p.id);
    const started = Date.now();
    try {
      const r = await runAi({ providerId: p.id, task: "connection_test", system: "You are a connectivity test. Reply briefly.", user: "Reply with: OK", json: false, mock: () => "OK (test provider)" });
      await repo.recordProviderTest(p.id, true, r.ms, r.text.slice(0, 200));
      await repo.addProviderComment(p.id, "test", "Connection test OK", `Answered in ${(r.ms / 1000).toFixed(1)}s — ${r.text.slice(0, 160)}`);
      toast.success(`${p.name} answered in ${(r.ms / 1000).toFixed(1)}s`, { description: r.text.slice(0, 120) });
    } catch (e) {
      const msg = (e as Error).message;
      await repo.recordProviderTest(p.id, false, Date.now() - started, msg);
      await repo.addProviderComment(p.id, "test", classifyErrorTitle(msg), msg);
      toast.error(`${p.name}: ${msg}`);
    } finally {
      setTesting(null);
      refresh();
    }
  }

  return (
    <div>
      <PageHeader
        title="AI Provider Manager"
        subtitle="Keys are kept outside the database and are never shown again after saving."
        actions={
          <>
            <Button variant="outline" onClick={addTest}><FlaskConical /> Add Test provider</Button>
            <Button variant="highlight" onClick={() => setEditing("new")}><Plus /> Add provider</Button>
          </>
        }
      />
      {!isLoading && list.length === 0 ? (
        <EmptyState icon={Cpu} title="No AI providers" body="Add OpenAI, Claude, Gemini, NVIDIA NIM, Perplexity, Ollama or any compatible API. The Test provider gives fixed answers so you can try the planner without a key." action={<Button variant="highlight" onClick={() => setEditing("new")}><Plus /> Add provider</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((p) => (
            <article key={p.id} className="rounded-2xl border bg-card p-5 shadow-soft" data-testid="provider-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-semibold">{p.name}{p.is_default ? <span className="rounded-full bg-highlight px-2 py-0.5 font-sans text-[11px] font-bold text-highlight-foreground">Default</span> : null}</h2>
                  <p className="text-sm text-muted-foreground">{TYPES[p.provider_type]?.label ?? p.provider_type} · {p.model_id}</p>
                </div>
                <Switch checked={!!p.enabled} aria-label={`Enable ${p.name}`} onCheckedChange={async (v) => { const { id, has_api_key: _h, api_key_hint: _a, last_test_at: _t, last_test_ok: _o, last_test_ms: _m, last_test_message: _g, ...rest } = p; await repo.saveProvider(id, { ...rest, enabled: v ? 1 : 0 }); refresh(); }} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">Protocol</dt><dd className="font-medium">{p.protocol}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-muted-foreground">Base URL</dt><dd className="truncate font-medium">{p.base_url || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">API key</dt><dd className="font-medium">{p.protocol === "mock" || p.protocol === "ollama" ? "Not needed" : p.api_key_hint ?? "Not set"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Max output</dt><dd className="font-medium">{p.max_output}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Context</dt><dd className="font-medium">{p.context_window ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Thinking</dt><dd className="font-medium">{p.thinking_effort}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Image input</dt><dd className="font-medium">{p.image_input ? "Yes" : "No"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Priority</dt><dd className="font-medium">{p.fallback_priority}</dd></div>
              </dl>
              {p.last_test_at && (
                <p className={cn("mt-3 flex items-start gap-1.5 rounded-lg p-2 text-xs", p.last_test_ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                  {p.last_test_ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                  <span>{p.last_test_ok ? "Worked" : "Failed"} · {((p.last_test_ms ?? 0) / 1000).toFixed(1)}s · {new Date(p.last_test_at).toLocaleString()} — {p.last_test_message}</span>
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => test(p)} disabled={testing === p.id}>{testing === p.id ? <Loader2 className="animate-spin" /> : <Zap />} Test connection</Button>
                {p.protocol !== "mock" && (
                  <Button size="sm" variant="outline" onClick={() => fetchModels(p)} disabled={fetching === p.id}>
                    {fetching === p.id ? <Loader2 className="animate-spin" /> : <Cpu />} Fetch models
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil /> Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setDel(p)}><Trash2 /> Remove</Button>
              </div>
              {(models[p.id]?.length ?? 0) > 0 && (
                <div className="mt-4 rounded-xl border bg-muted/40 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fetched models — click to select, then save</p>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {models[p.id]!.map((m) => {
                      const active = (pickedModel[p.id] ?? p.model_id) === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={cn("rounded-full border px-2.5 py-1 text-xs", active ? "border-highlight bg-highlight text-highlight-foreground" : "bg-background hover:border-primary")}
                          onClick={() => setPickedModel((s) => ({ ...s, [p.id]: m.id }))}
                        >
                          {m.id}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Selected: <span className="font-semibold text-foreground">{pickedModel[p.id] ?? p.model_id}</span></p>
                  <Button size="sm" className="mt-2" onClick={() => savePickedModel(p)}>Save selected model</Button>
                </div>
              )}
              <section className="mt-4 rounded-xl border p-3">
                <h3 className="text-sm font-semibold">Comments &amp; error log</h3>
                <p className="mb-2 text-xs text-muted-foreground">Created with this API. Fallback, credits, expired keys and test results show here automatically.</p>
                <ul className="max-h-36 space-y-2 overflow-y-auto text-xs">
                  {allComments.filter((c) => c.provider_id === p.id).length === 0 && <li className="text-muted-foreground">No comments yet. Test or fetch models to fill this log.</li>}
                  {allComments.filter((c) => c.provider_id === p.id).map((c) => (
                    <li key={c.id} className={cn("rounded-lg p-2", c.kind === "error" ? "bg-destructive/10" : c.kind === "fallback" ? "bg-warning/10" : "bg-muted/50")}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{c.title} <span className="font-normal text-muted-foreground">· {c.kind} · {new Date(c.created_at).toLocaleString()}</span></p>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditComment(c); setEditTitle(c.title); setEditBody(c.body); }}>Edit</Button>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <Textarea
                    rows={2}
                    placeholder="Add a note…"
                    value={noteDraft[p.id] ?? ""}
                    onChange={(e) => setNoteDraft((s) => ({ ...s, [p.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const t = (noteDraft[p.id] ?? "").trim();
                      if (!t) return;
                      await repo.addProviderComment(p.id, "user", "Note", t);
                      setNoteDraft((s) => ({ ...s, [p.id]: "" }));
                      refresh();
                    }}
                  >
                    Add
                  </Button>
                </div>
              </section>
            </article>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add AI provider" : "Edit AI provider"}</DialogTitle>
            <DialogDescription>Save the provider, then use Test connection and Fetch models on the card. Click a fetched model to select it, then Save selected model.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Provider type</Label>
              <Select value={f.provider_type} onValueChange={pickType}>
                <SelectTrigger aria-label="Provider type"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="p-name">Name</Label><Input id="p-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
            {f.protocol !== "mock" && (
              <>
                <div className="space-y-1.5">
                  <Label>Protocol</Label>
                  <Select value={f.protocol} onValueChange={(v) => set("protocol", v)} disabled={f.provider_type !== "custom"}>
                    <SelectTrigger aria-label="Protocol"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI-compatible (chat/completions)</SelectItem>
                      <SelectItem value="anthropic">Anthropic messages</SelectItem>
                      <SelectItem value="gemini">Gemini generateContent</SelectItem>
                      <SelectItem value="ollama">Ollama</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="p-url">Base URL</Label><Input id="p-url" value={f.base_url} onChange={(e) => set("base_url", e.target.value)} placeholder="https://" /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-key">API key</Label>
                  <Input id="p-key" type="password" autoComplete="off" value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder={editing && editing !== "new" && editing.api_key_hint ? `Saved (${editing.api_key_hint}) — type to replace` : f.protocol === "ollama" ? "Not needed" : "Paste key"} />
                </div>
                <div className="space-y-1.5"><Label htmlFor="p-model">Model ID</Label><Input id="p-model" value={f.model_id} onChange={(e) => set("model_id", e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="p-ctx">Context window</Label><Input id="p-ctx" type="number" value={f.context_window ?? ""} onChange={(e) => set("context_window", e.target.value ? Number(e.target.value) : null)} placeholder="128000" /></div>
                <div className="space-y-1.5"><Label htmlFor="p-max">Max output</Label><Input id="p-max" type="number" value={f.max_output} onChange={(e) => set("max_output", Math.max(16, Number(e.target.value) || 4096))} /></div>
                <div className="space-y-1.5">
                  <Label>Thinking effort</Label>
                  <Select value={f.thinking_effort} onValueChange={(v) => set("thinking_effort", v)}>
                    <SelectTrigger aria-label="Thinking effort"><SelectValue /></SelectTrigger>
                    <SelectContent>{["none", "low", "medium", "high"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="p-to">Timeout (seconds)</Label><Input id="p-to" type="number" value={f.timeout_ms / 1000} onChange={(e) => set("timeout_ms", Math.min(180, Math.max(5, Number(e.target.value) || 90)) * 1000)} /></div>
                <div className="space-y-1.5"><Label htmlFor="p-retry">Retries</Label><Input id="p-retry" type="number" min={0} max={3} value={f.retry_count} onChange={(e) => set("retry_count", Math.min(3, Math.max(0, Number(e.target.value) || 0)))} /></div>
              </>
            )}
            <div className="space-y-1.5"><Label htmlFor="p-prio">Fallback priority (lower = first)</Label><Input id="p-prio" type="number" value={f.fallback_priority} onChange={(e) => set("fallback_priority", Number(e.target.value) || 100)} /></div>
            <div className="flex flex-wrap items-center gap-5 sm:col-span-2">
              {f.protocol !== "mock" && <label className="flex items-center gap-2 text-sm"><Switch checked={!!f.image_input} onCheckedChange={(v) => set("image_input", v ? 1 : 0)} /> Image input</label>}
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!f.enabled} onCheckedChange={(v) => set("enabled", v ? 1 : 0)} /> Enabled</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!f.is_default} onCheckedChange={(v) => set("is_default", v ? 1 : 0)} /> Default provider</label>
            </div>
          </div>
          <DialogFooter><Button onClick={save}>Save provider</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editComment && !confirmEdit} onOpenChange={(o) => { if (!o) setEditComment(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit comment</DialogTitle>
            <DialogDescription>Errors still auto-append new log lines. Editing this line does not delete later automatic errors.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="c-title">Title</Label>
            <Input id="c-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            <Label htmlFor="c-body">Comment</Label>
            <Textarea id="c-body" rows={6} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditComment(null)}>Cancel</Button>
            <Button onClick={() => setConfirmEdit(true)}>Save…</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmEdit} onOpenChange={(o) => !o && setConfirmEdit(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this comment?</AlertDialogTitle>
            <AlertDialogDescription>This overwrites the current text. Automatic error/fallback lines will still be added after this.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!editComment) return;
                await repo.updateProviderComment(editComment.id, editTitle.trim() || editComment.title, editBody.trim());
                setConfirmEdit(false);
                setEditComment(null);
                toast.success("Comment updated");
                refresh();
              }}
            >
              Confirm save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove “{del?.name}”?</AlertDialogTitle><AlertDialogDescription>Its saved key is deleted too.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (del) { await saveKey(del.id, ""); await repo.deleteProvider(del.id, del.name); refresh(); } }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
