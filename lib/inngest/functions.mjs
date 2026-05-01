import { inngest } from "./client.mjs";

/**
 * Durable multi-step pipeline for long war-room work (context → LLM rounds → persist).
 * Trigger with `sendWarRoomEvalRequested` or any Inngest client `send({ name: "war-room/eval.requested", data })`.
 *
 * Replace step bodies with real calls to match context, `forwardGroq` / LiteLLM, Redis, Supabase, etc.
 */
export const warRoomEvalPipeline = inngest.createFunction(
  { id: "war-room-eval-pipeline" },
  { event: "war-room/eval.requested" },
  async ({ event, step }) => {
    const { jobId, matchLabel } = event.data;

    const context = await step.run("load-context", async () => ({
      jobId,
      matchLabel: matchLabel ?? null,
      loadedAt: new Date().toISOString(),
    }));

    const llm = await step.run("llm-orchestration", async () => ({
      status: "placeholder",
      note: "Wire LiteLLM / provider proxy and per-round debate here.",
    }));

    await step.run("persist-result", async () => ({
      jobId,
      persistedAt: new Date().toISOString(),
    }));

    return { context, llm };
  }
);

export const inngestFunctions = [warRoomEvalPipeline];
