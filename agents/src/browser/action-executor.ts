import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import type { AgentDecision, ActionResult, SiteConfig } from "../core/types.js";
import { SafetyGuard } from "../core/safety-guard.js";
import { compactText } from "../core/utils.js";

export class ActionExecutor {
  private readonly guard: SafetyGuard;

  constructor(
    private readonly siteConfig: SiteConfig,
    private readonly page?: Page
  ) {
    this.guard = new SafetyGuard(siteConfig);
  }

  async execute(decision: AgentDecision): Promise<ActionResult> {
    const started = Date.now();
    try {
      const action = decision.action;
      if (!this.page && action.type !== "finish" && action.type !== "abort" && action.type !== "call_tool" && action.type !== "inspect_available_tools") {
        throw new Error("BROWSER_PAGE_REQUIRED");
      }
      switch (action.type) {
        case "navigate": {
          this.guard.assertAllowedUrl(action.url);
          await this.page!.goto(action.url);
          return this.ok(action.type, started, "navigated");
        }
        case "click_by_role": {
          await this.page!.getByRole(action.role as never, { name: action.name }).click();
          return this.ok(action.type, started, "clicked");
        }
        case "fill_by_label": {
          await this.page!.getByLabel(action.label).fill(action.value);
          return this.ok(action.type, started, "filled");
        }
        case "select_option": {
          await this.page!.getByLabel(action.label).selectOption(action.value);
          return this.ok(action.type, started, "selected");
        }
        case "check":
        case "uncheck": {
          const locator = action.testId ? this.page!.getByTestId(action.testId) : this.page!.getByLabel(action.label || "");
          if (action.type === "check") await locator.check();
          else await locator.uncheck();
          return this.ok(action.type, started, action.type);
        }
        case "press_key": {
          await this.page!.keyboard.press(action.key);
          return this.ok(action.type, started, "key pressed");
        }
        case "scroll": {
          await this.page!.mouse.wheel(action.deltaX, action.deltaY);
          return this.ok(action.type, started, "scrolled");
        }
        case "wait": {
          await this.page!.waitForTimeout(action.ms);
          return this.ok(action.type, started, "waited");
        }
        case "go_back": {
          await this.page!.goBack();
          return this.ok(action.type, started, "went back");
        }
        case "click_xy": {
          const viewport = this.page!.viewportSize();
          if (!viewport) throw new Error("VIEWPORT_UNAVAILABLE");
          this.guard.assertViewportCoordinate(action.x, action.y, viewport.width, viewport.height);
          await this.page!.mouse.click(action.x, action.y);
          return this.ok(action.type, started, "clicked coordinate");
        }
        case "type_text": {
          await this.page!.keyboard.type(action.text);
          return this.ok(action.type, started, "typed");
        }
        case "finish":
          return this.ok(action.type, started, "agent requested finish");
        case "abort":
          return { ok: false, actionType: action.type, message: `${action.code}: ${action.message}`, latencyMs: Date.now() - started };
        case "inspect_available_tools":
          return this.ok(action.type, started, "tools inspected");
        case "call_tool":
          return { ok: false, actionType: action.type, message: "Tool execution is handled by OpenApiToolAgent", latencyMs: Date.now() - started };
      }
    } catch (error) {
      return {
        ok: false,
        actionType: decision.action.type,
        url: this.page?.url(),
        message: compactText(error instanceof Error ? error.message : String(error), 600),
        latencyMs: Date.now() - started
      };
    }
  }

  private ok(actionType: string, started: number, message: string): ActionResult {
    return { ok: true, actionType, url: this.page?.url(), message, latencyMs: Date.now() - started };
  }
}

export async function fileToDataUrl(filePath: string, mimeType = "image/png"): Promise<string> {
  const data = await readFile(filePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}
