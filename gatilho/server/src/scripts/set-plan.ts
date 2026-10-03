/**
 * Altera o plano de um espaço de trabalho (enquanto não há gateway de pagamento).
 * Uso: npm run plan:set -- email@cliente.com pro [--trial=14]
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { plans, subscriptions, users, workspaces } from "../db/schema";

async function main() {
  const [email, planId, ...rest] = process.argv.slice(2);
  if (!email || !planId) {
    console.error("Uso: npm run plan:set -- <email do dono> <plano> [--trial=dias]");
    process.exit(1);
  }
  const trial = Number(rest.find((a) => a.startsWith("--trial="))?.split("=")[1] ?? 0);
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw new Error(`Plano "${planId}" não existe.`);
  const [row] = await db
    .select({ workspaceId: workspaces.id })
    .from(workspaces)
    .innerJoin(users, eq(users.id, workspaces.ownerId))
    .where(eq(users.email, email.toLowerCase()));
  if (!row) throw new Error(`Nenhum espaço de trabalho encontrado para ${email}.`);
  const values = {
    planId: plan.id,
    status: (trial ? "trialing" : "active") as "trialing" | "active",
    trialEndsAt: trial ? new Date(Date.now() + trial * 86400_000) : null,
    provider: "manual",
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values({ workspaceId: row.workspaceId, ...values, currentPeriodStart: new Date() })
    .onConflictDoUpdate({ target: subscriptions.workspaceId, set: values });
  console.log(`Plano de ${email} alterado para ${plan.name}${trial ? ` (teste por ${trial} dias)` : ""}.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
