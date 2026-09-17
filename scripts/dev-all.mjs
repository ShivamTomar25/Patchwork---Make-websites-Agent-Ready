import { spawn } from "node:child_process";
import { assertPilotDatabases, pilotEnvironment, printPilotDatabases } from "./research-pilot-env.mjs";

const services = [
  ["ShopTwin API", "npm", ["run", "dev", "-w", "@patchwork/shop-api"]],
  ["SaaSTwin API", "npm", ["run", "dev", "-w", "@patchwork/saas-api"]],
  ["SupportTwin API", "npm", ["run", "dev", "-w", "@patchwork/support-api"]],
  ["ShopTwin Web", "npm", ["run", "dev", "-w", "@patchwork/shop-web"]],
  ["SaaSTwin Web", "npm", ["run", "dev", "-w", "@patchwork/saas-web"]],
  ["SupportTwin Web", "npm", ["run", "dev", "-w", "@patchwork/support-web"]]
];

await run("npm", ["run", "build", "-w", "@patchwork/shared"]);
await run("npm", ["run", "build", "-w", "@patchwork/api-kit"]);
await run("npm", ["run", "build", "-w", "@patchwork/web-kit"]);
await run("npm", ["run", "prisma:generate"]);

const pilotMode = process.env.PATCHWORK_PILOT_DATABASES === "1" || process.env.RESEARCH_PILOT_DATABASES === "1";
const pilotEnv = pilotMode ? pilotEnvironment() : {};
if (pilotMode) {
  printPilotDatabases(assertPilotDatabases(pilotEnv));
}

console.log("\nPATCHWORK local URLs");
console.log("ShopTwin:    http://localhost:3101    API: http://localhost:4101");
console.log("SaaSTwin:    http://localhost:3102    API: http://localhost:4102");
console.log("SupportTwin: http://localhost:3103    API: http://localhost:4103\n");

const children = services.map(([name, command, args]) => {
  const child = spawn(command, args, {
    env: {
      ...process.env,
      ...pilotEnv,
      ...(pilotMode ? { PILOT_ALLOW_RESET: "true", RESEARCH_PILOT_DATABASES: "1" } : {})
    },
    stdio: ["inherit", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`${name} exited with ${code}`);
      stopAll();
    }
  });
  return child;
});

let shuttingDown = false;
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

function stopAll() {
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500).unref();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
    });
  });
}
