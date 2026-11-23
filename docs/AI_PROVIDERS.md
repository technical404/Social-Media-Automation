# AI providers

Supported protocols in the local Python backend: openai (also NVIDIA NIM / Perplexity / custom OpenAI-compatible), anthropic, gemini, ollama.

Keys are stored in `Frontend/data/secrets.json` with Windows DPAPI, never in SQLite plaintext.

A provider is Validated only after a real test. Fallback uses enabled providers by `fallback_priority` on transient errors when routing is Automatic.
