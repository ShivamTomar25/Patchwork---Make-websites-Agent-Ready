import { spawn } from "node:child_process";

const script = process.argv[2];
if (!script) {
  console.error("Usage: node scripts/workspace-runner.mjs <script>");
  process.exit(1);
}

const workspaces = [
  "@patchwork/agents",
  "@patchwork/shared",
  "@patchwork/api-kit",
  "@patchwork/web-kit",
  "@patchwork/shop-api",
  "@patchwork/saas-api",
  "@patchwork/support-api",
  "@patchwork/shop-web",
  "@patchwork/saas-web",
  "@patchwork/support-web"
];

for (const workspace of workspaces) {
  await run("npm", ["run", script, "-w", workspace, "--if-present"]);
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
