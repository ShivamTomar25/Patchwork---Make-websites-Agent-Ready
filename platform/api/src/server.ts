import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();
const server = app.listen(env.apiPort, () => {
  console.log(`PATCHWORK Platform API listening on http://localhost:${env.apiPort}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
