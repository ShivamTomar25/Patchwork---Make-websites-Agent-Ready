import { spawn } from "node:child_process";
import { assertPilotDatabases, pilotEnvironment, printPilotDatabases } from "./research-pilot-env.mjs";

const command = process.argv[2] || "pilot";
const forwarded = process.argv.slice(3);
const pilotEnv = pilotEnvironment();
const inspected = assertPilotDatabases(pilotEnv);
printPilotDatabases(inspected);

if (command === "pilot") {
  await run("npm", ["run", "research:pilot", "-w", "@patchwork/agents", "--", ...forwarded]);
} else if (command === "resume") {
  await run("npm", ["run", "research:resume", "-w", "@patchwork/agents", "--", ...forwarded]);
} else if (command === "report") {
  await run("npm", ["run", "research:report", "-w", "@patchwork/agents", "--", ...forwarded]);
} else if (command === "audit-defects") {
  await run("npm", ["run", "research:audit-defects", "-w", "@patchwork/agents", "--", ...forwarded]);
} else {
  console.error("Usage: node scripts/research-pilot-run.mjs pilot|resume|report|audit-defects [args]");
  process.exit(1);
}

function run(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...pilotEnv,
        DATABASE_URL: pilotEnv.AGENTS_DATABASE_URL,
        PILOT_ALLOW_RESET: process.env.PILOT_ALLOW_RESET || "true"
      },
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandName} failed with ${code}`));
    });
  });
}
