import { spawn } from "node:child_process";

const services = [
  ["PATCHWORK API", "npm", ["run", "dev", "-w", "@patchwork/platform-api"]],
  ["PATCHWORK Web", "npm", ["run", "dev", "-w", "@patchwork/platform-web"]]
];

await run("npm", ["run", "build", "-w", "@patchwork/platform-api"]);

console.log("\nPATCHWORK Web: http://localhost:3200");
console.log("PATCHWORK API: http://localhost:4200\n");

let shuttingDown = false;
const children = services.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
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
