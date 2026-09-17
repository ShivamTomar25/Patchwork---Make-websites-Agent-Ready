export function applySyntheticCredentialDefaults() {
  const defaults: Record<string, string> = {
    PATCHWORK_SHOP_ADMIN_EMAIL: "admin@patchwork.local",
    PATCHWORK_SHOP_ADMIN_PASSWORD: "Admin123!",
    PATCHWORK_SHOP_USER_EMAIL: "shopper@patchwork.local",
    PATCHWORK_SHOP_USER_PASSWORD: "Shopper123!",
    PATCHWORK_SAAS_ADMIN_EMAIL: "admin@patchwork.local",
    PATCHWORK_SAAS_ADMIN_PASSWORD: "Admin123!",
    PATCHWORK_SAAS_USER_EMAIL: "owner@patchwork.local",
    PATCHWORK_SAAS_USER_PASSWORD: "Owner123!",
    PATCHWORK_SAAS_MEMBER_EMAIL: "member@patchwork.local",
    PATCHWORK_SAAS_MEMBER_PASSWORD: "Member123!",
    PATCHWORK_SUPPORT_ADMIN_EMAIL: "admin@patchwork.local",
    PATCHWORK_SUPPORT_ADMIN_PASSWORD: "Admin123!",
    PATCHWORK_SUPPORT_USER_EMAIL: "customer@patchwork.local",
    PATCHWORK_SUPPORT_USER_PASSWORD: "Customer123!",
    PATCHWORK_SUPPORT_AGENT_EMAIL: "agent@patchwork.local",
    PATCHWORK_SUPPORT_AGENT_PASSWORD: "Agent123!"
  };
  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] ||= value;
  }
}
