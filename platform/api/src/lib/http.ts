import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { isProduction } from "./env.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function sendData(res: Response, data: unknown, meta: Record<string, unknown> = {}) {
  res.json({ data, error: null, meta: { requestId: res.locals.requestId, ...meta } });
}

export function sendCreated(res: Response, data: unknown, meta: Record<string, unknown> = {}) {
  res.status(201).json({ data, error: null, meta: { requestId: res.locals.requestId, ...meta } });
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.header("x-request-id") || randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function validate<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}

export function pagination(req: Request) {
  const page = Math.max(Number(req.query.page || "1"), 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize || "20"), 1), 100);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, "NOT_FOUND", "The requested resource was not found."));
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const apiError = normalizeError(error);
  res.status(apiError.status).json({
    data: null,
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      stack: isProduction ? undefined : undefined
    },
    meta: { requestId: res.locals.requestId }
  });
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError(400, "VALIDATION_FAILED", "Request validation failed.", error.issues);
  }
  if (error && typeof error === "object" && "code" in error && (error as any).code === "P2002") {
    return new ApiError(409, "UNIQUE_CONSTRAINT", "A record with this unique value already exists.");
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return new ApiError(500, "INTERNAL_ERROR", isProduction ? "Unexpected server error." : message);
}
