import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./http.js";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests = 300, windowMs = 60_000) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.ip || "local"}:${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      next(new ApiError(429, "RATE_LIMITED", "Too many requests. Try again later."));
      return;
    }
    next();
  };
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|token|secret|cookie|authorization|api[_-]?key/i.test(key) ? "[REDACTED]" : redact(item)
      ])
    );
  }
  return value;
}
