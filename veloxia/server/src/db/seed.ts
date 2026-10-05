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
    description: "Para experimentar a automação de verdade.",
    priceCents: 0,
    isDefault: true,
    sortOrder: 0,
    limits: {
      instagram_accounts: 1,
      whatsapp_accounts: 1,
      channel_types: 1,
      active_automations: 2,
      active_contacts_per_month: 100,
      ai_generations_per_month: 0,
      flow_max_nodes: 10,
    },
    features: {
      flow_builder: true,
      multi_channel_automation: false,
      sequences: false,
      whatsapp_handoff: false,
      comment_automations: true,
      advanced_analytics: false,
      ai: false,
      export: false,
    },
    perks: ["1 canal: Instagram ou WhatsApp", "2 automações ativas", "100 contatos ativos por mês", "Construtor básico (até 10 blocos)", "Comentário → Direct e Stories"],
  },
  {
    id: "starter",
    name: "Starter",
    description: "Para quem vende por um canal.",
    priceCents: 3990,
    annualPriceCents: 39900,
    sortOrder: 1,
    limits: {
      instagram_accounts: 1,
      whatsapp_accounts: 1,
      channel_types: 1,
      active_automations: null,
      active_contacts_per_month: 1000,
      ai_generations_per_month: 0,
      flow_max_nodes: null,
    },
    features: {
      flow_builder: true,
      multi_channel_automation: false,
      sequences: false,
      whatsapp_handoff: false,
      comment_automations: true,
      advanced_analytics: false,
      ai: false,
      export: true,
    },
    perks: [
      "1 canal: Instagram ou WhatsApp",
      "Automações ilimitadas",
      "1.000 contatos ativos por mês",
      "Construtor visual completo",
      "Comentário → Direct, Stories e respostas automáticas",
      "Exportação de contatos",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "Instagram e WhatsApp juntos, na mesma automação.",
    priceCents: 7990,
    annualPriceCents: 79900,
    promoPriceCents: 4990,
    promoMonths: 3,
    highlighted: true,
    sortOrder: 2,
    limits: {
      instagram_accounts: 1,
      whatsapp_accounts: 1,
      channel_types: null,
      active_automations: null,
      active_contacts_per_month: 2000,
      ai_generations_per_month: 100,
      flow_max_nodes: null,
    },
    features: {
      flow_builder: true,
      multi_channel_automation: true,
      sequences: true,
      whatsapp_handoff: true,
      comment_automations: true,
      advanced_analytics: true,
      ai: true,
      export: true,
    },
    perks: [
      "Instagram + WhatsApp",
      "A mesma automação nos dois canais",
      "Automações ilimitadas",
      "2.000 contatos ativos por mês",
      "Instagram → WhatsApp",
      "Sequências com modelos do WhatsApp",
      "IA para criar mensagens (100 por mês)",
      "Analytics completo",
      "Suporte por e-mail",
    ],
  },
  {
    id: "business",
    name: "Business",
    description: "Para marcas, lojas e agências com mais volume.",
    priceCents: 14990,
    annualPriceCents: 149900,
    sortOrder: 3,
    limits: {
      instagram_accounts: 3,
      whatsapp_accounts: 3,
      channel_types: null,
      active_automations: null,
      active_contacts_per_month: 10000,
      ai_generations_per_month: 500,
      flow_max_nodes: null,
    },
    features: {
      flow_builder: true,
      multi_channel_automation: true,
      sequences: true,
      whatsapp_handoff: true,
      comment_automations: true,
      advanced_analytics: true,
      ai: true,
      export: true,
    },
    perks: [
      "Tudo do Pro",
      "Até 3 contas do Instagram e 3 números do WhatsApp",
      "10.000 contatos ativos por mês",
      "IA para criar mensagens (500 por mês)",
      "Atendimento prioritário por e-mail",
    ],
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
