import express from "express";
import { serve } from "inngest/express";
import { inngest } from "./client.mjs";
import { inngestFunctions } from "./functions.mjs";

let app;

function getInngestExpressApp() {
  if (!app) {
    app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "6mb" }));
    app.use(
      "/api/inngest",
      serve({
        client: inngest,
        functions: inngestFunctions,
      })
    );
  }
  return app;
}

/** Delegate from `warRoomHttpHandler` for GET/POST/PUT `/api/inngest`. */
export function handleInngestRequest(req, res) {
  return new Promise((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
    getInngestExpressApp()(req, res, (err) => {
      if (err) reject(err);
    });
  });
}
