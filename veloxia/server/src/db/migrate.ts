/**
 * Aplica as migrações SQL (pasta drizzle/) e os dados iniciais (planos).
 * CLI: src/scripts/migrate.ts (npm run db:migrate).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";
import { seedPlans } from "./seed";

function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../../drizzle"), resolve(here, "../drizzle"), resolve(process.cwd(), "drizzle")];
  const found = candidates.find((p) => existsSync(resolve(p, "meta/_journal.json")));
  if (!found) throw new Error("Pasta de migrações não encontrada");
  return found;
}

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
  await seedPlans();
}
