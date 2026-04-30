/**
 * Long-running war rooms on Vercel: if profiling shows the handler still exceeds
 * `maxDuration` after Redis caching + LiteLLM, split the pipeline with **Inngest**
 * (async steps + client polling) or an external queue worker.
 *
 * Placeholders only — no Inngest SDK dependency in this repo.
 * @see https://www.inngest.com/docs
 */
export const INNGEST_ENV_HINT = "INNGEST_SIGNING_KEY / INNGEST_EVENT_KEY — configure when you add an Inngest app.";
