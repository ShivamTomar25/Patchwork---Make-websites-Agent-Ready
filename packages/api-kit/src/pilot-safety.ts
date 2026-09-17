export type PilotDatabaseSafety = {
  database: string;
  host: string;
  port: string;
  local: boolean;
  pilot: boolean;
  allowed: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function inspectPilotDatabaseUrl(databaseUrl: string): PilotDatabaseSafety {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const host = parsed.hostname || "localhost";
  const port = parsed.port || "5432";
  const local = LOCAL_HOSTS.has(host);
  const pilot = database.endsWith("_pilot");
  return {
    database,
    host,
    port,
    local,
    pilot,
    allowed: local && pilot
  };
}

export function assertPilotResetAllowed(databaseUrl: string, env: { PILOT_ALLOW_RESET?: string } = process.env): PilotDatabaseSafety {
  const inspection = inspectPilotDatabaseUrl(databaseUrl);
  if (env.PILOT_ALLOW_RESET !== "true") {
    throw new Error("PILOT_RESET_REJECTED: set PILOT_ALLOW_RESET=true before destructive reset/seed operations.");
  }
  if (!inspection.local) {
    throw new Error(`PILOT_RESET_REJECTED: database host must be local, got ${inspection.host}.`);
  }
  if (!inspection.pilot) {
    throw new Error(`PILOT_RESET_REJECTED: database name must end with _pilot, got ${inspection.database}.`);
  }
  return inspection;
}
