/** Aplica as migrações do banco. Uso: npm run db:migrate (produção: npm run db:migrate:prod). */
import { pool } from "../db/client";
import { runMigrations } from "../db/migrate";

runMigrations()
  .then(() => console.log("Migrações aplicadas com sucesso."))
  .catch((err) => {
    console.error("Falha ao aplicar migrações:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
