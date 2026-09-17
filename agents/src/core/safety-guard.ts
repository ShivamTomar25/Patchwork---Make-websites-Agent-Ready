import type { SiteConfig } from "./types.js";

export class SafetyGuard {
  constructor(private readonly siteConfig: SiteConfig) {}

  assertAllowedUrl(rawUrl: string) {
    const url = new URL(rawUrl, this.siteConfig.frontendUrl);
    if (!this.siteConfig.allowedHosts.includes(url.host)) {
      throw new Error(`SAFETY_EXTERNAL_NAVIGATION: ${url.host} is not allowlisted`);
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error(`SAFETY_UNSUPPORTED_PROTOCOL: ${url.protocol}`);
    }
  }

  assertNoResearchToolFromAgent(path: string, authorized: boolean) {
    if (!authorized && path.startsWith("/api/research/")) {
      throw new Error("SAFETY_RESEARCH_TOOL_FORBIDDEN");
    }
  }

  assertViewportCoordinate(x: number, y: number, width: number, height: number) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      throw new Error(`COORDINATE_OUT_OF_VIEWPORT: ${x},${y} outside ${width}x${height}`);
    }
  }
}
