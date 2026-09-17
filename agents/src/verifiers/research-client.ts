import { VerificationResultSchema } from "../core/schemas.js";
import { redactSecrets } from "../core/utils.js";
import type { SiteConfig } from "../core/types.js";
import { resolveCredential, type CredentialRole } from "../sites/site-registry.js";

type FetchInit = RequestInit & { bodyJson?: unknown };

export class ResearchEndpointClient {
  private cookies = new Map<string, string>();

  constructor(private readonly siteConfig: SiteConfig) {}

  async health() {
    return this.request(this.siteConfig.healthEndpoint);
  }

  async login(role: CredentialRole) {
    const credential = resolveCredential(this.siteConfig, role);
    return this.request("/api/auth/login", {
      method: "POST",
      bodyJson: credential
    });
  }

  async reset(defectConfiguration: Record<string, boolean> = {}) {
    await this.login("admin");
    const reset = await this.request(this.siteConfig.resetEndpoint, { method: "POST" });
    if (Object.keys(defectConfiguration).length > 0) {
      await this.request(this.siteConfig.defectsEndpoint, {
        method: "PUT",
        bodyJson: { defects: defectConfiguration }
      });
    }
    return reset;
  }

  async defects() {
    await this.login("admin");
    return this.request(this.siteConfig.defectsEndpoint);
  }

  async state() {
    await this.login("admin");
    return this.request(this.siteConfig.stateEndpoint);
  }

  async verify(journeyId: string) {
    await this.login("admin");
    const path = this.siteConfig.verifierEndpointTemplate.replace("{journeyId}", encodeURIComponent(journeyId));
    return VerificationResultSchema.parse(await this.request(path, { method: "POST" }));
  }

  async request(pathOrUrl: string, init: FetchInit = {}) {
    const url = new URL(pathOrUrl, this.siteConfig.apiUrl);
    const headers = new Headers(init.headers);
    if (init.bodyJson !== undefined) {
      headers.set("content-type", "application/json");
    }
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    const started = Date.now();
    const requestInit: RequestInit = { headers };
    if (init.method) requestInit.method = init.method;
    const body = init.bodyJson !== undefined ? JSON.stringify(init.bodyJson) : init.body;
    if (body !== undefined) requestInit.body = body;
    const response = await fetch(url, requestInit);
    this.storeCookies(response.headers.getSetCookie?.() || parseSingleSetCookie(response.headers.get("set-cookie")));
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(data.error?.message || `HTTP ${response.status}`) as Error & {
        status?: number;
        data?: unknown;
      };
      error.status = response.status;
      error.data = redactSecrets(data);
      throw error;
    }
    return { ...data, _latencyMs: Date.now() - started };
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  private storeCookies(values: string[]) {
    for (const value of values) {
      const first = value.split(";")[0];
      if (!first) continue;
      const index = first.indexOf("=");
      if (index > 0) this.cookies.set(first.slice(0, index), first.slice(index + 1));
    }
  }
}

export class BackendVerifier {
  constructor(private readonly client: ResearchEndpointClient) {}

  async verify(journeyId: string) {
    return this.client.verify(journeyId);
  }
}

function parseSingleSetCookie(value: string | null): string[] {
  return value ? [value] : [];
}
