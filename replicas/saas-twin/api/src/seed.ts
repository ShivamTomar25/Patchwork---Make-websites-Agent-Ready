import { databaseUrlFor, seedDatabase } from "@patchwork/api-kit";

process.env.DATABASE_URL = databaseUrlFor("saas");

const { PrismaClient } = await import("./generated/prisma/index.js");
const prisma = new PrismaClient();

try {
  await seedDatabase("saas", prisma);
  console.log("SaaSTwin seeded with deterministic research state.");
} finally {
  await prisma.$disconnect();
}
