import { databaseUrlFor, seedDatabase } from "@patchwork/api-kit";

process.env.DATABASE_URL = databaseUrlFor("support");

const { PrismaClient } = await import("./generated/prisma/index.js");
const prisma = new PrismaClient();

try {
  await seedDatabase("support", prisma);
  console.log("SupportTwin seeded with deterministic research state.");
} finally {
  await prisma.$disconnect();
}
