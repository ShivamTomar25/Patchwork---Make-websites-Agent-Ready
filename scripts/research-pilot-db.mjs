import { spawn } from "node:child_process";
import { assertPilotDatabases, inspectDatabaseUrl, pilotEnvironment, postgresArgs, postgresEnv, printPilotDatabases } from "./research-pilot-env.mjs";

const command = process.argv[2];
const pilotEnv = pilotEnvironment();
const inspected = assertPilotDatabases(pilotEnv);
printPilotDatabases(inspected);

if (!command || !["create", "migrate", "seed", "reset"].includes(command)) {
  console.error("Usage: node scripts/research-pilot-db.mjs create|migrate|seed|reset");
  process.exit(1);
}

if (command === "create") {
  for (const item of inspected) {
    await createDatabaseIfNeeded(item, pilotEnv[item.name]);
  }
  process.exit(0);
}

if (command === "migrate") {
  await runWorkspace("db:migrate", "@patchwork/shop-api", { SHOP_DATABASE_URL: pilotEnv.SHOP_DATABASE_URL });
  await runWorkspace("db:migrate", "@patchwork/saas-api", { SAAS_DATABASE_URL: pilotEnv.SAAS_DATABASE_URL });
  await runWorkspace("db:migrate", "@patchwork/support-api", { SUPPORT_DATABASE_URL: pilotEnv.SUPPORT_DATABASE_URL });
  await runWorkspace("db:migrate", "@patchwork/agents", { AGENTS_DATABASE_URL: pilotEnv.AGENTS_DATABASE_URL });
  process.exit(0);
}

if (command === "seed") {
  requireResetOptIn();
  await seedReplicas();
  process.exit(0);
}

if (command === "reset") {
  requireResetOptIn();
  await seedReplicas();
  await resetAgentsDatabase();
  process.exit(0);
}

async function seedReplicas() {
  await runWorkspace("seed", "@patchwork/shop-api", { SHOP_DATABASE_URL: pilotEnv.SHOP_DATABASE_URL, PILOT_ALLOW_RESET: "true" });
  await runWorkspace("seed", "@patchwork/saas-api", { SAAS_DATABASE_URL: pilotEnv.SAAS_DATABASE_URL, PILOT_ALLOW_RESET: "true" });
  await runWorkspace("seed", "@patchwork/support-api", { SUPPORT_DATABASE_URL: pilotEnv.SUPPORT_DATABASE_URL, PILOT_ALLOW_RESET: "true" });
}

async function resetAgentsDatabase() {
  const info = inspectDatabaseUrl(pilotEnv.AGENTS_DATABASE_URL);
  const sql = "TRUNCATE TABLE artifacts, steps, runs RESTART IDENTITY CASCADE;";
  await capture("psql", [...postgresArgs(info, info.database), "-v", "ON_ERROR_STOP=1", "-c", sql], postgresEnv(info));
  console.log(`PILOT_RESET_DATABASE=${info.database}`);
}

async function createDatabaseIfNeeded(item, databaseUrl) {
  const info = inspectDatabaseUrl(databaseUrl);
  const exists = await capture(
    "psql",
    [...postgresArgs(info), "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${item.database.replaceAll("'", "''")}'`],
    postgresEnv(info)
  );
  if (exists.trim() === "1") {
    console.log(`${item.database} already exists`);
    return;
  }
  await run("createdb", ["-h", info.host, "-p", info.port, ...(info.username ? ["-U", info.username] : []), item.database], postgresEnv(info));
  console.log(`${item.database} created`);
}

function requireResetOptIn() {
  if (process.env.PILOT_ALLOW_RESET !== "true") {
    throw new Error("PILOT_RESET_REJECTED: run with PILOT_ALLOW_RESET=true");
  }
}

function runWorkspace(script, workspace, env) {
  return run("npm", ["run", script, "-w", workspace], { ...process.env, ...pilotEnv, ...env });
}

function capture(commandName, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { env, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${commandName} failed with ${code}`));
    });
  });
}

function run(commandName, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandName} failed with ${code}`));
    });
  });
}
