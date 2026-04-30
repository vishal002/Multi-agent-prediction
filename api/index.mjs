/**
 * Vercel Node serverless entry: same HTTP router as local `server.mjs` (no `listen()`).
 * Static files under `dist/` are served by the platform first; unmatched paths fall
 * through to this handler (see `vercel.json`).
 *
 * If multi-minute war rooms still time out after Redis + LiteLLM, split work with
 * Inngest or a queue — see `lib/inngestEval.mjs` and `.env.example` placeholders.
 */
export { warRoomHttpHandler as default } from "../server.mjs";
