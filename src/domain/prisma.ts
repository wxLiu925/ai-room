import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type PrismaGlobal = typeof globalThis & {
  aiRoomPrisma?: PrismaClient;
};

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPrisma() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return undefined;

  const globalPrisma = globalThis as PrismaGlobal;
  globalPrisma.aiRoomPrisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  return globalPrisma.aiRoomPrisma;
}