import { spawn } from "node:child_process";

const databases = ["patchwork_shop", "patchwork_saas", "patchwork_support", "patchwork_agents", "patchwork_platform"];

for (const database of databases) {
  const exists = await capture("psql", [
    "postgres",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = '${database}'`
  ]);
  if (exists.trim() === "1") {
    console.log(`${database} already exists`);
  } else {
    await run("createdb", [database]);
    console.log(`${database} created`);
  }
}

console.log("PATCHWORK databases are present:", databases.join(", "));

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
    });
  });
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
