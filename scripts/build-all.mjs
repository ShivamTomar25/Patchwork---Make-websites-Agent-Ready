import { spawn } from "node:child_process";

const sequence = [
  ["npm", ["run", "build", "-w", "@patchwork/shared"]],
  ["npm", ["run", "build", "-w", "@patchwork/api-kit"]],
  ["npm", ["run", "build", "-w", "@patchwork/web-kit"]],
  ["npm", ["run", "agents:build"]],
  ["npm", ["run", "prisma:generate"]],
  ["npm", ["run", "build", "-w", "@patchwork/shop-api"]],
  ["npm", ["run", "build", "-w", "@patchwork/saas-api"]],
  ["npm", ["run", "build", "-w", "@patchwork/support-api"]],
  ["npm", ["run", "build", "-w", "@patchwork/shop-web"]],
  ["npm", ["run", "build", "-w", "@patchwork/saas-web"]],
  ["npm", ["run", "build", "-w", "@patchwork/support-web"]]
];

for (const [command, args] of sequence) {
  await run(command, args);
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
