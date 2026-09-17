import { databaseUrlFor, startServer } from "@patchwork/api-kit";

process.env.DATABASE_URL = databaseUrlFor("support");

const { PrismaClient } = await import("./generated/prisma/index.js");
const prisma = new PrismaClient();

startServer("support", prisma);
