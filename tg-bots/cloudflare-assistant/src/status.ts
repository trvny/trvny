import type { KanarekProviderPoolStatus } from "./providers";

const PROVIDER_LABELS: Record<string, string> = {
  orcarouter: "OrcaRouter",
  aihubmix: "AIHubMix",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  groq: "Groq",
  vercel: "Vercel",
  "workers-ai": "Workers AI",
};

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export type ProviderStatusView = { plain: string; richHtml: string };

export function formatProviderStatus(
  pool: KanarekProviderPoolStatus | null,
  routerConfigured: boolean,
  localModel: string,
): ProviderStatusView {
  const providers = routerConfigured ? pool?.providers ?? [] : [];
  const summary = routerConfigured
    ? pool ? `${pool.available}/${pool.configured} available` : "status unavailable"
    : "router token not configured";
  const rows = providers.map((provider) => {
    const label = PROVIDER_LABELS[provider.provider] ?? provider.provider;
    const status = !provider.configured
      ? "⚪ not configured"
      : provider.available
        ? "✅ available"
        : `⏳ ${provider.cooldown?.category ? `cooldown ${provider.cooldown.category}` : "unavailable"}`;
    return { label, status };
  });

  const plain = [
    "Provider status:",
    `Kanarek pool: ${summary}`,
    ...rows.map(({ label, status }) => `${label} — ${status}`),
    `Local emergency: Workers AI (${localModel})`,
  ].join("\n");

  const bodyRows = rows.length
    ? rows
        .map(({ label, status }) =>
          `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(status)}</td></tr>`,
        )
        .join("")
    : `<tr><td>Kanarek pool</td><td>${escapeHtml(summary)}</td></tr>`;
  const richHtml = [
    "<h2>Provider status</h2>",
    `<p>Kanarek pool: <b>${escapeHtml(summary)}</b></p>`,
    `<table><tr><th>Provider</th><th>Status</th></tr>${bodyRows}</table>`,
    `<details><summary>Emergency fallback</summary><p>Workers AI: <code>${escapeHtml(localModel)}</code></p></details>`,
  ].join("");

  return { plain, richHtml };
}
