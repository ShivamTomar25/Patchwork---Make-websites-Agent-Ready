import net from "node:net";

export type PilotDatabaseInspection = {
  envName: string;
  database: string;
  host: string;
  port: string;
  username: string;
  local: boolean;
  pilot: boolean;
};

export const pilotDatabaseNames = {
  SHOP_DATABASE_URL: "patchwork_shop_pilot",
  SAAS_DATABASE_URL: "patchwork_saas_pilot",
  SUPPORT_DATABASE_URL: "patchwork_support_pilot",
  AGENTS_DATABASE_URL: "patchwork_agents_pilot"
} as const;

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function pilotEnvironment(baseEnv = process.env) {
  const user = baseEnv.USER || "postgres";
  return {
    SHOP_DATABASE_URL: baseEnv.SHOP_DATABASE_URL || `postgresql://${user}@localhost:5432/${pilotDatabaseNames.SHOP_DATABASE_URL}`,
    SAAS_DATABASE_URL: baseEnv.SAAS_DATABASE_URL || `postgresql://${user}@localhost:5432/${pilotDatabaseNames.SAAS_DATABASE_URL}`,
    SUPPORT_DATABASE_URL: baseEnv.SUPPORT_DATABASE_URL || `postgresql://${user}@localhost:5432/${pilotDatabaseNames.SUPPORT_DATABASE_URL}`,
    AGENTS_DATABASE_URL: baseEnv.AGENTS_DATABASE_URL || `postgresql://${user}@localhost:5432/${pilotDatabaseNames.AGENTS_DATABASE_URL}`,
    RESEARCH_PILOT_DATABASES: "1"
  };
}

export function inspectDatabaseUrl(envName: string, databaseUrl: string): PilotDatabaseInspection {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const host = parsed.hostname || "localhost";
  return {
    envName,
    database,
    host,
    port: parsed.port || "5432",
    username: decodeURIComponent(parsed.username || ""),
    local: localHosts.has(host),
    pilot: database.endsWith("_pilot")
  };
}

export function assertPilotRuntimeEnvironment(env = pilotEnvironment()) {
  if (process.env.PILOT_ALLOW_RESET !== "true") {
    throw new Error("PILOT_RESET_REJECTED: run with PILOT_ALLOW_RESET=true");
  }
  const inspections = Object.entries(env)
    .filter(([name]) => name.endsWith("_DATABASE_URL"))
    .map(([name, value]) => inspectDatabaseUrl(name, String(value)));
  for (const item of inspections) {
    if (!item.local) throw new Error(`PILOT_DATABASE_REJECTED ${item.envName}: host must be local, got ${item.host}`);
    if (!item.pilot) throw new Error(`PILOT_DATABASE_REJECTED ${item.envName}: database must end with _pilot, got ${item.database}`);
  }
  return inspections;
}

export function printPilotRuntimeDatabases(inspections: PilotDatabaseInspection[]) {
  console.log("PATCHWORK runtime pilot databases:");
  for (const item of inspections) {
    console.log(`- ${item.envName}: ${item.database} @ ${item.host}:${item.port}`);
  }
}

export async function allocateLocalPort(): Promise<number> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("PORT_ALLOCATION_FAILED"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

export async function assertPortAvailable(port: number) {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new Error(`PORT_OCCUPIED: ${port}`)));
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

export function redactRuntimeEnv(env: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, /password|token|secret|key/i.test(key) ? "[REDACTED]" : redactDatabasePassword(value)])
  );
}

function redactDatabasePassword(value: string | undefined) {
  if (!value) return value;
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = "[REDACTED]";
    return parsed.toString();
  } catch {
    return value;
  }
}
