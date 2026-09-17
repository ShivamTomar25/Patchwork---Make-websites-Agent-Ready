import type { Algorithm } from "jsonwebtoken";

export const env = {
  databaseUrl: process.env.DATABASE_URL || `postgresql://${process.env.USER || "postgres"}@localhost:5432/patchwork_platform`,
  jwtSecret: process.env.JWT_SECRET_KEY || "development-only-change-me-development-only-change-me",
  jwtAlgorithm: (process.env.JWT_ALGORITHM || "HS256") as Algorithm,
  accessTokenMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || "15"),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS || "14"),
  appEnv: process.env.APP_ENV || process.env.NODE_ENV || "development",
  debug: process.env.DEBUG === "true",
  webUrl: process.env.WEB_URL || "http://localhost:3200",
  apiUrl: process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:4200",
  apiPort: Number(process.env.PORT || process.env.API_PORT || "4200")
};

export const isProduction = env.appEnv === "production";

if (isProduction) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
  if (!process.env.JWT_SECRET_KEY || env.jwtSecret.length < 32 || env.jwtSecret.startsWith("development-only")) {
    throw new Error("JWT_SECRET_KEY must be a production secret of at least 32 characters");
  }
  if (!process.env.WEB_URL || new URL(env.webUrl).protocol !== "https:") {
    throw new Error("WEB_URL must be the HTTPS frontend origin in production");
  }
}
