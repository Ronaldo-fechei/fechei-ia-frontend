import pg from "pg";
import { TEST_ENV } from "../vitest.config";

/** Recria o schema do banco de testes e aplica as migrações. */
export default async function setup() {
  Object.assign(process.env, TEST_ENV);
  const client = new pg.Client({ connectionString: TEST_ENV.DATABASE_URL });
  await client.connect();
  await client.query("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await client.end();
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { pool } = await import("../src/db/client");
  await pool.end();
}
