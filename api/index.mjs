/**
 * Vercel Node serverless entry: same HTTP router as local `server.mjs` (no `listen()`).
 * Static files under `dist/` are served by the platform first; unmatched paths fall
 * through to this handler (see `vercel.json`).
 */
export { warRoomHttpHandler as default } from "../server.mjs";
