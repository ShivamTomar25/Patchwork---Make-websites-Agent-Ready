import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { SiteConfig } from "../core/types.js";

export class BrowserSessionManager {
  private browser: Browser | undefined;

  async newContext(siteConfig: SiteConfig): Promise<{ context: BrowserContext; page: Page }> {
    this.browser ||= await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      baseURL: siteConfig.frontendUrl,
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: false
    });
    await context.addInitScript((apiUrl) => {
      (window as Window & { __PATCHWORK_API_URL?: string }).__PATCHWORK_API_URL = apiUrl;
    }, siteConfig.apiUrl);
    const page = await context.newPage();
    const defaultTimeout = Number(process.env.PATCHWORK_PLAYWRIGHT_TIMEOUT_MS || 30_000);
    context.setDefaultTimeout(defaultTimeout);
    page.setDefaultTimeout(defaultTimeout);
    return { context, page };
  }

  async close() {
    await this.browser?.close();
    this.browser = undefined;
  }
}
