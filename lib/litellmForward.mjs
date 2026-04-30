/**
 * Optional LiteLLM OpenAI-compatible proxy (LITELLM_BASE_URL).
 * Maps groq_route → model alias from litellm.config.yaml.
 */

const LITELLM_BASE = (process.env.LITELLM_BASE_URL || "").trim().replace(/\/$/, "");
const LITELLM_KEY = (process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY || "sk-1234").trim();

/** @param {string} route */
function modelAliasForRoute(route) {
  if (route === "debate") return "debate-agent";
  if (route === "judge" || route === "over") return "judge-agent";
  return "intel-agent";
}

function contentToString(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === "object" && "text" in b ? String(b.text) : "")).join("");
  }
  return String(content);
}

/**
 * @param {string} anthropicBodyString raw POST body from UI (Anthropic messages + groq_route)
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function forwardLiteLLM(anthropicBodyString) {
  if (!LITELLM_BASE) {
    return { status: 500, body: JSON.stringify({ error: { message: "LITELLM_BASE_URL is not set." } }) };
  }

  let anthropicJson;
  try {
    anthropicJson = JSON.parse(anthropicBodyString);
  } catch {
    return { status: 400, body: JSON.stringify({ error: { message: "Invalid JSON body" } }) };
  }

  const routeRaw = anthropicJson.groq_route;
  const route = typeof routeRaw === "string" && routeRaw.trim() ? routeRaw.trim() : "misc";
  delete anthropicJson.groq_route;

  const sys = anthropicJson.system != null ? String(anthropicJson.system).trim() : "";
  /** @type {{ role: string, content: string }[]} */
  const oaMessages = [];
  if (sys) oaMessages.push({ role: "system", content: sys });
  for (const m of anthropicJson.messages || []) {
    const role = m.role === "assistant" ? "assistant" : "user";
    oaMessages.push({ role, content: contentToString(m.content) });
  }
  if (!oaMessages.length) {
    oaMessages.push({ role: "user", content: "Respond helpfully." });
  }

  const requested = Math.min(Number(anthropicJson.max_tokens) || 1024, 8192);
  const caps = { intel: 240, debate: 220, judge: 640, live: 140, over: 2200, misc: 1024 };
  const maxTokens = Math.min(requested, caps[route] ?? 1024);
  const temps = { intel: 0.35, debate: 0.55, judge: 0.25, live: 0.2, over: 0.35, misc: 0.55 };
  const temperature = temps[route] ?? 0.55;

  const model = modelAliasForRoute(route);
  const url = `${LITELLM_BASE}/v1/chat/completions`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: oaMessages,
      max_tokens: maxTokens,
      temperature,
    }),
  });
  const text = await r.text();
  if (!r.ok) return { status: r.status, body: text };

  let oa;
  try {
    oa = JSON.parse(text);
  } catch {
    return { status: 502, body: JSON.stringify({ error: { message: "LiteLLM returned non-JSON" } }) };
  }

  const choice = oa.choices?.[0];
  const msg = choice?.message;
  const outText = typeof msg?.content === "string" ? msg.content : String(msg?.content ?? "");
  const usage = oa.usage;
  const shaped = {
    id: oa.id || "litellm-msg",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: outText }],
    model: oa.model || model,
    stop_reason: "end_turn",
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens ?? usage.input_tokens,
          output_tokens: usage.completion_tokens ?? usage.output_tokens,
          total_tokens: usage.total_tokens,
        }
      : undefined,
  };
  return { status: 200, body: JSON.stringify(shaped) };
}

export function liteLLMEnabled() {
  return Boolean(LITELLM_BASE);
}
