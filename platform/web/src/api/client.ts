export const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? "/api/v1" : "http://localhost:4200/api/v1");

type ApiOptions = Omit<RequestInit, "body"> & { body?: BodyInit | Record<string, unknown> };

export type Envelope<T> = {
  data: T;
  error: null | { code: string; message: string; details?: unknown };
  meta: Record<string, unknown>;
};

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
    body: options.body && typeof options.body === "object" && !(options.body instanceof FormData) ? JSON.stringify(options.body) : (options.body as BodyInit | undefined)
  });
  const envelope = (await response.json()) as Envelope<T>;
  if (!response.ok || envelope.error) {
    throw new ApiClientError(envelope.error?.message || "Request failed.", response.status, envelope.error?.code);
  }
  return envelope.data;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}
