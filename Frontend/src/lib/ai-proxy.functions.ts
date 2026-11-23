import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Stateless relay used only in browser-storage mode (hosted preview), because most AI providers
// block direct browser calls. Nothing is stored; the key is used for this one request only.
const Input = z.object({
  provider: z.object({
    name: z.string().max(120),
    protocol: z.enum(["openai", "anthropic", "gemini"]),
    base_url: z.string().max(400),
    model_id: z.string().min(1).max(200),
    max_output: z.number().int().min(16).max(64000),
    thinking_effort: z.string().max(20),
    timeout_ms: z.number().int().min(1000).max(180000),
  }),
  apiKey: z.string().min(1).max(500),
  system: z.string().max(8000),
  user: z.string().max(12000),
  json: z.boolean(),
});

export const aiProxy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { runText, assertPublicHttps, ProviderError } = await import("./ai.server");
    try {
      assertPublicHttps(data.provider.base_url);
      const r = await runText({ ...data.provider, protocol: data.provider.protocol }, data.apiKey, data.system, data.user, data.json);
      return { ok: true as const, ...r };
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false as const, error: e.message, kind: e.kind, status: e.status ?? null };
      return { ok: false as const, error: "Unexpected error while calling the provider.", kind: "network", status: null };
    }
  });
