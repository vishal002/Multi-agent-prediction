/**
 * Long-running war rooms: durable steps + client polling pattern via Inngest.
 * Serve URL: `GET|POST|PUT /api/inngest` (mounted from `server.mjs`).
 *
 * @see lib/inngest/functions.mjs — event `war-room/eval.requested`
 * @see https://www.inngest.com/docs
 */
export { inngest, INNGEST_ENV_HINT } from "./inngest/client.mjs";
export { sendWarRoomEvalRequested } from "./inngest/send.mjs";
