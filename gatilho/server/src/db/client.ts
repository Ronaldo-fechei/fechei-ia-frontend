import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env";
import * as schema from "./schema";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  // Erros em conexões ociosas não devem derrubar o processo.
  console.error("[db] erro em conexão ociosa:", err.message);
});

export type Database = NodePgDatabase<typeof schema>;
export const db: Database = drizzle(pool, { schema });

/** Tipo aceito por funções que podem rodar dentro ou fora de uma transação. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

export { schema };
