// One entry point for every AI call in the app (browser side).
import { getDb } from "@/lib/db";
import { backendFetch } from "@/lib/db/python";
import { readBrowserKey } from "@/lib/secrets";
import { listProviders, logAiRequest, type Provider } from "@/lib/repo";

export type AiResult = { text: string; ms: number; model: string; providerName: string; providerId: string; finishReason?: string | null };

export class AiError extends Error {}

export function classifyErrorTitle(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("expired")) return "API key expired";
  if (m.includes("credit") || m.includes("quota") || m.includes("billing")) return "Credits or quota exhausted";
  if (m.includes("rate limit") || m.includes("429")) return "Rate limit";
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("invalid or unauthorized")) return "API key rejected";
  if (m.includes("410") || m.includes("no longer available")) return "Model retired";
  if (m.includes("404")) return "Model or endpoint not found";
  if (m.includes("timeout") || m.includes("no response")) return "Timeout";
  if (m.includes("could not reach")) return "Network error";
  return "Provider error";
}

export async function fetchProviderModels(providerId: string): Promise<{ id: string; name: string }[]> {
  const db = await getDb();
  if (db.mode !== "python") throw new AiError("Fetch models needs the local Python backend (python main.py).");
  const res = await backendFetch("/api/ai/models", { method: "POST", body: JSON.stringify({ provider_id: providerId }) });
  const r = (await res.json()) as { ok: boolean; models?: { id: string; name: string }[]; error?: string };
  if (!r.ok) throw new AiError(r.error ?? "Could not fetch models.");
  return r.models ?? [];
}

export async function pickProvider(providerId: string | null): Promise<Provider> {
  const list = await listProviders();
  if (providerId) {
    const p = list.find((x) => x.id === providerId);
    if (!p) throw new AiError("That AI provider no longer exists.");
    if (!p.enabled) throw new AiError(`"${p.name}" is turned off. Turn it on in AI Providers.`);
    return p;
  }
  const p = list.find((x) => x.enabled && x.is_default) ?? list.filter((x) => x.enabled).sort((a, b) => a.fallback_priority - b.fallback_priority)[0];
  if (!p) throw new AiError("No AI provider is set up yet. Add one in AI Providers (or add the built-in Test provider).");
  return p;
}

async function callOnce(p: Provider, system: string, user: string, json: boolean, mock: (() => string) | undefined): Promise<{ text: string; model: string; finishReason?: string | null }> {
  if (p.protocol === "mock") {
    if (!mock) throw new AiError("The Test provider only supports event-calendar generation.");
    await new Promise((r) => setTimeout(r, 400));
    return { text: mock(), model: "deterministic-test" };
  }
  const db = await getDb();
  if (db.mode === "python") {
    const res = await backendFetch("/api/ai/run", { method: "POST", body: JSON.stringify({ provider_id: p.id, system, user, json }) });
    const r = (await res.json()) as { ok: boolean; text?: string; model?: string; error?: string; finish_reason?: string | null };
    if (!r.ok) throw new AiError(r.error ?? "The AI provider failed.");
    return { text: r.text ?? "", model: r.model ?? p.model_id, finishReason: r.finish_reason ?? null };
  }
  // Browser mode
  if (p.protocol === "ollama") {
    // Ollama runs on this PC; the browser can talk to it directly (needs OLLAMA_ORIGINS to allow this page).
    const base = p.base_url.replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: p.model_id, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(json ? { response_format: { type: "json_object" } } : {}) }),
    }).catch(() => {
      throw new AiError("Could not reach Ollama on this PC. Is it running, and is OLLAMA_ORIGINS set to allow this page?");
    });
    if (!res.ok) throw new AiError(`Ollama returned HTTP ${res.status}.`);
    const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    return { text: data.choices?.[0]?.message?.content ?? "", model: p.model_id, finishReason: data.choices?.[0]?.finish_reason ?? null };
  }
  const key = await readBrowserKey(p.id);
  if (!key) throw new AiError(`"${p.name}" has no API key saved in this browser yet.`);
  const { aiProxy } = await import("@/lib/ai-proxy.functions");
  const r = await aiProxy({
    data: {
      provider: { name: p.name, protocol: p.protocol as "openai" | "anthropic" | "gemini", base_url: p.base_url, model_id: p.model_id, max_output: p.max_output, thinking_effort: p.thinking_effort, timeout_ms: p.timeout_ms },
      apiKey: key,
      system,
      user,
      json,
    },
  });
  if (!r.ok) throw new AiError(r.error);
  return { text: r.text, model: r.model, finishReason: (r as { finishReason?: string }).finishReason ?? null };
}

export async function runAi(opts: { providerId: string | null; task: string; system: string; user: string; json: boolean; mock?: () => string }): Promise<AiResult> {
  const primary = await pickProvider(opts.providerId);
  const list = await listProviders();
  const chain = [primary];
  if (!opts.providerId) {
    const rest = list
      .filter((x) => x.enabled && x.id !== primary.id)
      .sort((a, b) => a.fallback_priority - b.fallback_priority);
    chain.push(...rest);
  }
  const started = Date.now();
  let lastErr: unknown;
  let lastFailed: Provider | null = null;
  const seen = new Set<string>();
  const { addProviderComment } = await import("@/lib/repo");
  for (const p of chain) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const attempts = Math.max(1, Math.min(4, (p.retry_count ?? 0) + 1));
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await callOnce(p, opts.system, opts.user, opts.json, opts.mock);
        const ms = Date.now() - started;
        await logAiRequest({ provider_id: p.id, provider_name: p.name, task: opts.task, model: r.model, ok: true, latency_ms: ms });
        if (lastFailed && p.id !== lastFailed.id) {
          await addProviderComment(
            lastFailed.id,
            "fallback",
            "Fell back to another provider",
            `Task "${opts.task}" left "${lastFailed.name}" because: ${String((lastErr as Error)?.message ?? "unknown")}. Next provider used: ${p.name} (${r.model}).`,
          );
          await addProviderComment(p.id, "fallback", "Used as fallback", `Took over task "${opts.task}" after "${lastFailed.name}" failed.`);
        }
        return { text: r.text, ms, model: r.model, providerName: p.name, providerId: p.id, finishReason: r.finishReason ?? null };
      } catch (e) {
        lastErr = e;
        lastFailed = p;
        const msg = String((e as Error).message);
        await addProviderComment(p.id, "error", classifyErrorTitle(msg), msg).catch(() => undefined);
        if (!/timeout|No response|Rate limit|HTTP 5\d\d|Could not reach|credits|quota|429/i.test(msg)) break;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  }
  const p = primary;
  const msg = (lastErr as Error)?.message ?? "AI call failed.";
  await logAiRequest({ provider_id: p.id, provider_name: p.name, task: opts.task, model: p.model_id, ok: false, latency_ms: Date.now() - started, error: msg });
  throw new AiError(msg);
}

/** Pull the first JSON value out of model text (handles ```json fences). */
export function parseJSONLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text) ?? "";
  const start = raw.search(/[[{]/);
  if (start < 0) throw new AiError("The AI answer did not contain JSON.");
  const candidate = raw.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    try {
      return JSON.parse(candidate.slice(0, end + 1));
    } catch {
      throw new AiError("The AI answer contained malformed JSON.");
    }
  }
}
