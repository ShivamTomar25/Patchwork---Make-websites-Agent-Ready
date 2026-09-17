import { databaseUrlFor, seedDatabase } from "@patchwork/api-kit";

process.env.DATABASE_URL = databaseUrlFor("shop");

const { PrismaClient } = await import("./generated/prisma/index.js");
const prisma = new PrismaClient();

try {
  await seedDatabase("shop", prisma);
  console.log("ShopTwin seeded with deterministic research state.");
} finally {
  await prisma.$disconnect();
}
