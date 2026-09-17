export const PILOT_DATABASES = {
  SHOP_DATABASE_URL: "patchwork_shop_pilot",
  SAAS_DATABASE_URL: "patchwork_saas_pilot",
  SUPPORT_DATABASE_URL: "patchwork_support_pilot",
  AGENTS_DATABASE_URL: "patchwork_agents_pilot"
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function pilotEnvironment(baseEnv = process.env) {
  const user = baseEnv.USER || "postgres";
  return {
    SHOP_DATABASE_URL: baseEnv.SHOP_DATABASE_URL || `postgresql://${user}@localhost:5432/${PILOT_DATABASES.SHOP_DATABASE_URL}`,
    SAAS_DATABASE_URL: baseEnv.SAAS_DATABASE_URL || `postgresql://${user}@localhost:5432/${PILOT_DATABASES.SAAS_DATABASE_URL}`,
    SUPPORT_DATABASE_URL: baseEnv.SUPPORT_DATABASE_URL || `postgresql://${user}@localhost:5432/${PILOT_DATABASES.SUPPORT_DATABASE_URL}`,
    AGENTS_DATABASE_URL: baseEnv.AGENTS_DATABASE_URL || `postgresql://${user}@localhost:5432/${PILOT_DATABASES.AGENTS_DATABASE_URL}`,
    RESEARCH_PILOT_DATABASES: "1"
  };
}

export function assertPilotDatabases(env = pilotEnvironment()) {
  const inspected = Object.entries(env)
    .filter(([name]) => name.endsWith("_DATABASE_URL"))
    .map(([name, value]) => ({ name, ...inspectDatabaseUrl(String(value)) }));
  for (const item of inspected) {
    if (!item.local) throw new Error(`PILOT_DATABASE_REJECTED ${item.name}: host must be local, got ${item.host}`);
    if (!item.database.endsWith("_pilot")) {
      throw new Error(`PILOT_DATABASE_REJECTED ${item.name}: database must end with _pilot, got ${item.database}`);
    }
  }
  return inspected;
}

export function printPilotDatabases(inspected) {
  console.log("PATCHWORK pilot databases:");
  for (const item of inspected) {
    console.log(`- ${item.name}: ${item.database} @ ${item.host}:${item.port}`);
  }
}

export function inspectDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const host = parsed.hostname || "localhost";
  const port = parsed.port || "5432";
  return {
    database,
    host,
    port,
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    local: LOCAL_HOSTS.has(host)
  };
}

export function postgresArgs(info, database = "postgres") {
  return [
    "-h",
    info.host,
    "-p",
    info.port,
    ...(info.username ? ["-U", info.username] : []),
    "-d",
    database
  ];
}

export function postgresEnv(info, baseEnv = process.env) {
  return {
    ...baseEnv,
    ...(info.password ? { PGPASSWORD: info.password } : {})
  };
}
