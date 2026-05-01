import { inngest } from "./client.mjs";

/**
 * Enqueue the async eval pipeline. Requires `INNGEST_EVENT_KEY` in cloud, or dev server + `INNGEST_DEV=1`.
 * @param {{ jobId: string; matchLabel?: string | null }} data
 */
export async function sendWarRoomEvalRequested(data) {
  await inngest.send({
    name: "war-room/eval.requested",
    data,
  });
}
