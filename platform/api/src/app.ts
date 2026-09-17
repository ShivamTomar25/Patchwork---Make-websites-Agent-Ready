import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./lib/env.js";
import { errorMiddleware, notFound, requestId } from "./lib/http.js";
import { rateLimit } from "./lib/security.js";
import v1 from "./routes/v1.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.webUrl,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    })
  );
  app.use(requestId);
  app.use(rateLimit());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api/v1", v1);
  app.use(notFound);
  app.use(errorMiddleware);
  return app;
}
