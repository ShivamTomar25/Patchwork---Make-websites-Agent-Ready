import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { SitesFileSchema } from "../core/schemas.js";
import type { SiteConfig, SiteKey } from "../core/types.js";

export class SiteRegistry {
  private sites?: Record<SiteKey, SiteConfig>;

  constructor(
    private readonly repoRoot: string,
    private readonly configPath = process.env.PATCHWORK_SITES_CONFIG || path.join(repoRoot, "agents/configs/sites.yaml")
  ) {}

  async load(): Promise<Record<SiteKey, SiteConfig>> {
    if (this.sites) return this.sites;
    const parsed = YAML.parse(await readFile(this.configPath, "utf8"));
    this.sites = SitesFileSchema.parse(parsed) as Record<SiteKey, SiteConfig>;
    return this.sites;
  }

  async get(site: SiteKey): Promise<SiteConfig> {
    const sites = await this.load();
    return sites[site];
  }

  async list(): Promise<Array<[SiteKey, SiteConfig]>> {
    const sites = await this.load();
    return Object.entries(sites) as Array<[SiteKey, SiteConfig]>;
  }
}

export type CredentialRole = "admin" | "user" | "member" | "agent";

export function resolveCredential(siteConfig: SiteConfig, role: CredentialRole) {
  const emailEnv = siteConfig.credentials[`${role}EmailEnv`];
  const passwordEnv = siteConfig.credentials[`${role}PasswordEnv`];
  if (!emailEnv || !passwordEnv) throw new Error(`CREDENTIAL_ROLE_UNCONFIGURED: ${role}`);
  const email = process.env[emailEnv];
  const password = process.env[passwordEnv];
  if (!email || !password) {
    throw new Error(`CREDENTIAL_ENV_MISSING: set ${emailEnv} and ${passwordEnv}`);
  }
  return { email, password };
}
