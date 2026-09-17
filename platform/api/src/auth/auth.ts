import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Membership, Organization, Role, User } from "../generated/prisma/index.js";
import { env, isProduction } from "../lib/env.js";
import { ApiError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";

export type AuthContext = {
  user: User;
  organization: Organization;
  membership: Membership;
};

export type AuthRequest = Request & { auth?: AuthContext };

const passwordSchema = z
  .string()
  .min(10)
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

export const SignupSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  name: z.string().min(2).max(120),
  password: passwordSchema,
  organizationName: z.string().min(2).max(160)
});

export const LoginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});

export const ForgotPasswordSchema = z.object({ email: z.string().email().transform((value) => value.toLowerCase()) });
export const ResetPasswordSchema = z.object({ token: z.string().min(20), password: passwordSchema });
export const VerifyEmailSchema = z.object({ token: z.string().min(20) });

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function issueSession(res: Response, user: User, req?: Request) {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: "pending",
      userAgent: req?.header("user-agent"),
      ipAddress: req?.ip,
      expiresAt: daysFromNow(env.refreshTokenDays)
    }
  });
  const accessToken = signToken({ sub: user.id, sid: session.id, type: "access" }, `${env.accessTokenMinutes}m`);
  const refreshToken = signToken({ sub: user.id, sid: session.id, type: "refresh" }, `${env.refreshTokenDays}d`);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: sha256(refreshToken) }
  });
  setCookies(res, accessToken, refreshToken);
  return session.id;
}

export async function rotateRefreshToken(req: Request, res: Response) {
  const token = req.cookies?.refreshToken;
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  const payload = verifyToken(token, "refresh");
  const session = await prisma.session.findUnique({ where: { id: payload.sid } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.refreshTokenHash !== sha256(token)) {
    throw new ApiError(401, "SESSION_INVALID", "Session is no longer valid.");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
  const accessToken = signToken({ sub: user.id, sid: session.id, type: "access" }, `${env.accessTokenMinutes}m`);
  const refreshToken = signToken({ sub: user.id, sid: session.id, type: "refresh" }, `${env.refreshTokenDays}d`);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: sha256(refreshToken), expiresAt: daysFromNow(env.refreshTokenDays) }
  });
  setCookies(res, accessToken, refreshToken);
  return user;
}

export async function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.accessToken;
    if (!token) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
    const payload = verifyToken(token, "access");
    const user = await prisma.user.findFirst({ where: { id: payload.sub, deletedAt: null } });
    if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: { organization: true },
      orderBy: { createdAt: "asc" }
    });
    const selectedOrgId = req.header("x-organization-id");
    const selected = memberships.find((item) => item.organizationId === selectedOrgId) || memberships[0];
    if (!selected) throw new ApiError(403, "ORG_REQUIRED", "No organization membership was found.");
    req.auth = { user, membership: selected, organization: selected.organization };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(roles: Role[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const role = req.auth?.membership.role;
    if (!role || !roles.includes(role)) {
      next(new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action."));
      return;
    }
    next();
  };
}

export async function createEmailToken(userId: string, type: "verify_email" | "password_reset", targetEmail: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.emailToken.create({
    data: {
      userId,
      type,
      tokenHash: sha256(token),
      expiresAt: hoursFromNow(type === "password_reset" ? 2 : 48)
    }
  });
  const path = type === "password_reset" ? `/reset-password?token=${token}` : `/verify-email?token=${token}`;
  const url = `${env.webUrl}${path}`;
  await prisma.mailOutbox.create({
    data: {
      toEmail: targetEmail,
      subject: type === "password_reset" ? "Reset your PATCHWORK password" : "Verify your PATCHWORK email",
      body: `Open this development link to continue: ${url}`
    }
  });
  if (!isProduction) console.log(`[mail-outbox] ${type} link queued for ${targetEmail}: ${url}`);
  return token;
}

export function clearAuthCookies(res: Response) {
  res.clearCookie("accessToken", cookieOptions());
  res.clearCookie("refreshToken", cookieOptions());
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt
  };
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signToken(payload: Record<string, unknown>, expiresIn: string) {
  return jwt.sign(payload, env.jwtSecret, { algorithm: env.jwtAlgorithm, expiresIn } as jwt.SignOptions);
}

function verifyToken(token: string, expectedType: "access" | "refresh") {
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: [env.jwtAlgorithm] }) as {
    sub: string;
    sid: string;
    type: string;
  };
  if (payload.type !== expectedType) throw new ApiError(401, "TOKEN_INVALID", "Session token is invalid.");
  return payload;
}

function setCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie("accessToken", accessToken, { ...cookieOptions(), maxAge: env.accessTokenMinutes * 60_000 });
  res.cookie("refreshToken", refreshToken, { ...cookieOptions(), maxAge: env.refreshTokenDays * 24 * 60 * 60_000 });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/"
  };
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60_000);
}

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60_000);
}
