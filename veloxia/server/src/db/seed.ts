/**
 * Planos padrão. Os limites ficam no banco: para mudar limites ou criar
 * planos novos basta alterar a tabela `plans` — sem mudar código.
 * O seed só insere planos que ainda não existem (não sobrescreve ajustes).
 */
import { sql } from "drizzle-orm";
import { db } from "./client";
import { plans } from "./schema";

export const DEFAULT_PLANS: (typeof plans.$inferInsert)[] = [
  {
    id: "free",
    name: "Gratuito",
    description: "Para começar a automatizar seu Instagram.",
    priceCents: 0,
    isDefault: true,
    sortOrder: 0,
    limits: { instagram_accounts: 1, active_automations: 3, contacts: 500, messages_per_month: 1000, ai_generations_per_month: 0 },
    features: { flow_builder: true, advanced_analytics: false, ai: false, comment_automations: true, remove_branding: false },
  },
  {
    id: "pro",
    name: "Pro",
    description: "Para criadores e lojas que vendem pelo Instagram.",
    priceCents: 4990,
    sortOrder: 1,
    limits: { instagram_accounts: 1, active_automations: 50, contacts: 10000, messages_per_month: 25000, ai_generations_per_month: 200 },
    features: { flow_builder: true, advanced_analytics: true, ai: true, comment_automations: true, remove_branding: true },
  },
  {
    id: "business",
    name: "Business",
    description: "Para marcas e agências com alto volume.",
    priceCents: 14990,
    sortOrder: 2,
    limits: { instagram_accounts: 5, active_automations: null, contacts: 100000, messages_per_month: 200000, ai_generations_per_month: 1000 },
    features: { flow_builder: true, advanced_analytics: true, ai: true, comment_automations: true, remove_branding: true },
  },
];

export async function seedPlans(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    await db.insert(plans).values(plan).onConflictDoNothing({ target: plans.id });
  }
  // Garante exatamente um plano padrão.
  const [{ count }] = (await db.execute(sql`select count(*)::int as count from plans where is_default`)).rows as { count: number }[];
  if (count === 0) await db.execute(sql`update plans set is_default = true where id = 'free'`);
}
