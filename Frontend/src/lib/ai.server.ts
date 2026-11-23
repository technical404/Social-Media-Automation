// Server-only multi-provider text generation. Never import from client code.
// Used by the browser-mode proxy; the Python backend has its own copy of these adapters (backend/ai.py).

export type ProviderConfig = {
  name: string;
  protocol: "openai" | "anthropic" | "gemini" | "ollama";
  base_url: string;
  model_id: string;
  max_output: number;
  thinking_effort: string;
  timeout_ms: number;
};

export class ProviderError extends Error {
  constructor(
    public kind: "auth" | "model" | "rate_limit" | "timeout" | "network" | "bad_response" | "config" | "credits",
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export type RunResult = { text: string; ms: number; model: string; providerName: string; finishReason?: string | null };

/** Mask secrets in any string before logging or returning it. */
export function redact(s: string, secret?: string | null): string {
  let out = s;
  if (secret && secret.length > 4) out = out.split(secret).join("••••");
  return out.replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1••••").replace(/(key=)[^&\s"]+/gi, "$1••••");
}

function classifyStatus(status: number, body: string): ProviderError {
  const snippet = body.slice(0, 240);
  if (status === 401 || status === 403) return new ProviderError("auth", `Invalid or unauthorized API key (HTTP ${status}).`, status);
  if (status === 404) return new ProviderError("model", `Model or endpoint not found (HTTP 404). Check the model ID and base URL.`, status);
  if (status === 429) return new ProviderError("rate_limit", "Rate limit reached. Wait a moment and try again.", status);
  if (status === 402) return new ProviderError("credits", "The provider reports insufficient credits or billing issues.", status);
  return new ProviderError("bad_response", `Provider returned HTTP ${status}: ${snippet}`, status);
}

/** Block requests to private/loopback hosts from the hosted proxy. */
export function assertPublicHttps(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProviderError("config", "Base URL is not a valid address.");
  }
  if (u.protocol !== "https:") throw new ProviderError("config", "Base URL must start with https:// (use the Python backend for local endpoints).");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "[::1]"
  )
    throw new ProviderError("config", "Private network addresses can only be used through the local Python backend.");
}

async function postJSON(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, secret: string | null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw classifyStatus(res.status, redact(text, secret));
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError("bad_response", "Provider returned a response that is not JSON.");
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error)?.name === "AbortError") throw new ProviderError("timeout", `No response within ${Math.round(timeoutMs / 1000)}s.`);
    throw new ProviderError("network", `Could not reach the provider: ${redact(String((e as Error)?.message ?? e), secret)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function runText(p: ProviderConfig, apiKey: string | null, system: string, user: string, json: boolean): Promise<RunResult> {
  const started = Date.now();
  const base = p.base_url.replace(/\/+$/, "");
  if (!apiKey) throw new ProviderError("config", "This provider has no API key saved yet.");
  let text = "";
  let finishReason: string | null = null;
  const u = json ? `${user}\n\nReturn JSON only.` : user;
  switch (p.protocol) {
    case "openai":
    case "ollama": {
      const body: Record<string, unknown> = {
        model: p.model_id,
        messages: [
          { role: "system", content: system },
          { role: "user", content: u },
        ],
        max_tokens: p.max_output,
      };
      if (json) body["response_format"] = { type: "json_object" };
      if (p.thinking_effort !== "none") body["reasoning_effort"] = p.thinking_effort;
      const data = await postJSON(`${base}/chat/completions`, { Authorization: `Bearer ${apiKey}` }, body, p.timeout_ms, apiKey);
      text = data?.choices?.[0]?.message?.content ?? "";
      finishReason = data?.choices?.[0]?.finish_reason ?? null;
      break;
    }
    case "anthropic": {
      const data = await postJSON(
        `${base}/v1/messages`,
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        { model: p.model_id, max_tokens: p.max_output, system, messages: [{ role: "user", content: u }] },
        p.timeout_ms,
        apiKey,
      );
      text = (data?.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      finishReason = data?.stop_reason ?? null;
      break;
    }
    case "gemini": {
      const data = await postJSON(
        `${base}/v1beta/models/${encodeURIComponent(p.model_id)}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: p.max_output, ...(json ? { responseMimeType: "application/json" } : {}) },
        },
        p.timeout_ms,
        apiKey,
      );
      text = (data?.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? "").join("");
      finishReason = data?.candidates?.[0]?.finishReason ?? null;
      break;
    }
  }
  if (!text) throw new ProviderError("bad_response", "The provider returned an empty answer.");
  return { text, ms: Date.now() - started, model: p.model_id, providerName: p.name, finishReason };
}
