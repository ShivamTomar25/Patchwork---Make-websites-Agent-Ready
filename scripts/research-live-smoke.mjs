import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const required = [
  "TEXT_AGENT_A_BASE_URL",
  "TEXT_AGENT_A_API_KEY",
  "TEXT_AGENT_A_MODEL",
  "TEXT_AGENT_B_BASE_URL",
  "TEXT_AGENT_B_API_KEY",
  "TEXT_AGENT_B_MODEL",
  "VISION_BASE_URL",
  "VISION_API_KEY",
  "VISION_MODEL",
  "TOOL_AGENT_BASE_URL",
  "TOOL_AGENT_API_KEY",
  "TOOL_AGENT_MODEL"
];

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const isPilot = process.argv.includes("--pilot");
  const resultDirectory = isPilot ? "experiments/results/pilot-study-v2/live" : "experiments/results/pilot-study-v2/live-smoke";
  const validation = validateLiveEnvironment(process.env);
  if (!validation.ok) {
    await writeSkipped(resultDirectory, validation.reasons);
    console.log(JSON.stringify({ ok: true, executed: false, resultDirectory, reasons: validation.reasons }, null, 2));
    process.exit(0);
  }

  if (isPilot) {
    await run("node", [
      "scripts/research-pilot-run.mjs",
      "pilot",
      "--mode",
      "live",
      "--manifest",
      "experiments/configs/pilot-study-v2.yaml",
      "--result-directory",
      resultDirectory
    ]);
  } else {
    await run("node", [
      "scripts/research-pilot-run.mjs",
      "pilot",
      "--mode",
      "live",
      "--manifest",
      "experiments/configs/pilot-study-v2.yaml",
      "--result-directory",
      resultDirectory,
      "--seeds",
      "1",
      "--journeys",
      "SHOP-J1,SAAS-J2,SUPPORT-J1",
      "--limit",
      String(Math.min(Number(process.env.LIVE_MAX_RUNS || 24), 24))
    ]);
  }
}

export function validateLiveEnvironment(env) {
  const reasons = required.filter((name) => !env[name]).map((name) => `${name} missing`);
  if (env.LIVE_ALLOW_COST !== "true") reasons.push("LIVE_ALLOW_COST is not true");
  if (Number(env.LIVE_MAX_RUNS || 24) > 24) reasons.push("LIVE_MAX_RUNS exceeds 24");
  if (Number(env.LIVE_MAX_STEPS_PER_RUN || 30) > 30) reasons.push("LIVE_MAX_STEPS_PER_RUN exceeds 30");
  if (Number(env.LIVE_MAX_TOKENS_PER_RUN || 20000) > 20000) reasons.push("LIVE_MAX_TOKENS_PER_RUN exceeds 20000");
  if (env.TEXT_AGENT_A_MODEL && env.TEXT_AGENT_B_MODEL && modelFamily(env.TEXT_AGENT_A_MODEL) === modelFamily(env.TEXT_AGENT_B_MODEL)) {
    reasons.push("TEXT_AGENT_A_MODEL and TEXT_AGENT_B_MODEL must use different model families");
  }
  if (env.VISION_MODEL && !/vision|gpt-4o|omni|claude-3|gemini|pixtral/i.test(env.VISION_MODEL)) {
    reasons.push("VISION_MODEL does not look vision-capable");
  }
  return { ok: reasons.length === 0, reasons };
}

function modelFamily(model) {
  return String(model).toLowerCase().replace(/[-_]?(\d+(\.\d+)?|latest|preview|mini|turbo|flash|pro).*$/, "");
}

async function writeSkipped(directory, reasons) {
  const absolute = path.join(process.cwd(), directory);
  await mkdir(absolute, { recursive: true });
  const payload = {
    executed: false,
    mode: directory.endsWith("/live") ? "live-pilot" : "live-smoke",
    reason: "Live provider configuration or cost approval is incomplete.",
    reasons,
    generatedAt: new Date().toISOString()
  };
  await writeFile(path.join(absolute, "live-smoke.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(
    path.join(absolute, "live-smoke.md"),
    [
      "# PATCHWORK Live Smoke",
      "",
      "Live runs were not executed.",
      "",
      ...reasons.map((reason) => `- ${reason}`),
      ""
    ].join("\n")
  );
}

function run(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandName} failed with ${code}`));
    });
  });
}
