import { Inngest } from "inngest";

/** Shown in logs when keys are missing; not used for auth. */
export const INNGEST_ENV_HINT =
  "Set INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY (Vercel integration) or INNGEST_DEV=1 for local `npx inngest-cli dev`.";

export const inngest = new Inngest({
  id: "ai-cricket-war-room",
  name: "AI Cricket War Room",
});
