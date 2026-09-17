export function inspectRepairDatabaseUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").split("/")[0] || "");
  return {
    protocol: parsed.protocol,
    host: parsed.hostname,
    port: parsed.port || "5432",
    database,
    schema: parsed.searchParams.get("schema") || "repair",
    username: parsed.username || undefined
  };
}

export function assertRepairPilotDatabase(databaseUrl: string) {
  const inspected = inspectRepairDatabaseUrl(databaseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(inspected.host)) {
    throw new Error(`REPAIR_DATABASE_REJECTED: host must be local, got ${inspected.host}`);
  }
  if (!inspected.database.endsWith("_pilot")) {
    throw new Error(`REPAIR_DATABASE_REJECTED: database must end with _pilot, got ${inspected.database}`);
  }
  return inspected;
}
