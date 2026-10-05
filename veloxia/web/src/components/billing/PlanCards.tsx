import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { PLAN_FEATURE_KEYS, PLAN_FEATURE_LABELS, formatBRL, type BillingCycle } from "@veloxia/shared";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import type { PublicPlan } from "../../lib/types";
import { Badge, Segmented } from "../ui";

export function CycleToggle({ value, onChange }: { value: BillingCycle; onChange: (v: BillingCycle) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      items={[
        { value: "monthly", label: "Mensal" },
        { value: "annual", label: "Anual (2 meses grátis)" },
      ]}
    />
  );
}

const limitText = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? `${unit} ilimitados` : `${formatNumber(v)} ${unit}`);

function channelsText(p: PublicPlan): string {
  const types = p.limits.channel_types;
  if (types === 1) return "Instagram ou WhatsApp";
  const ig = p.limits.instagram_accounts;
  const wa = p.limits.whatsapp_accounts;
  const part = (n: number | null | undefined, one: string, many: string) => (n === null || n === undefined ? many : n === 1 ? one : `${n} ${many}`);
  return `${part(ig, "1 Instagram", "contas do Instagram")} + ${part(wa, "1 WhatsApp", "números do WhatsApp")}`;
}

export function PlanPrice({ plan, cycle, promoEligible }: { plan: PublicPlan; cycle: BillingCycle; promoEligible: boolean }) {
  if (plan.priceCents <= 0) return <p className="text-3xl font-semibold">Grátis</p>;
  if (cycle === "annual" && plan.annualPriceCents) {
    return (
      <div>
        <p className="text-3xl font-semibold">
          {formatBRL(Math.round(plan.annualPriceCents / 12))}
          <span className="text-sm font-normal text-zinc-500">/mês</span>
        </p>
        <p className="text-xs text-zinc-500">{formatBRL(plan.annualPriceCents)} cobrados uma vez por ano</p>
      </div>
    );
  }
  const promo = promoEligible && plan.promoPriceCents && plan.promoMonths > 0;
  return (
    <div>
      <p className="text-3xl font-semibold">
        {formatBRL(promo ? plan.promoPriceCents! : plan.priceCents)}
        <span className="text-sm font-normal text-zinc-500">/mês</span>
      </p>
      {promo ? (
        <p className="text-xs text-zinc-500">
          nos {plan.promoMonths} primeiros meses, depois {formatBRL(plan.priceCents)}/mês
        </p>
      ) : (
        <p className="text-xs text-zinc-500">cobrado todo mês, cancele quando quiser</p>
      )}
    </div>
  );
}

export function PlanCards({
  plans,
  cycle,
  promoEligible,
  currentPlanId,
  action,
}: {
  plans: PublicPlan[];
  cycle: BillingCycle;
  promoEligible: boolean;
  currentPlanId?: string;
  action: (plan: PublicPlan) => ReactNode;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((p) => {
        const current = p.id === currentPlanId;
        const promo = cycle === "monthly" && promoEligible && p.promoPriceCents && p.promoMonths > 0;
        return (
          <div
            key={p.id}
            className={cn(
              "relative flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-sm",
              p.highlighted ? "border-brand-400 ring-2 ring-brand-500/30" : "border-zinc-200",
              current && "ring-2 ring-brand-500",
            )}
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {current && <Badge tone="brand">Atual</Badge>}
                {!current && p.highlighted && <Badge tone="violet">Mais escolhido</Badge>}
                {promo && <Badge tone="green">Lançamento</Badge>}
              </div>
              <p className="mt-1 min-h-10 text-sm text-zinc-500">{p.description}</p>
            </div>
            <PlanPrice plan={p} cycle={cycle} promoEligible={promoEligible} />
            <ul className="space-y-1.5 text-sm text-zinc-700">
              {(p.perks.length ? p.perks : [channelsText(p), limitText(p.limits.active_contacts_per_month, "contatos ativos/mês")]).map((perk) => (
                <li key={perk} className="flex gap-1.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  {perk}
                </li>
              ))}
              {PLAN_FEATURE_KEYS.filter((k) => p.features[k] === false).map((k) => (
                <li key={k} className="flex gap-1.5 text-zinc-400">
                  <Minus className="mt-0.5 size-4 shrink-0 text-zinc-300" />
                  {PLAN_FEATURE_LABELS[k]}
                </li>
              ))}
            </ul>
            <div className="mt-auto">{action(p)}</div>
          </div>
        );
      })}
    </div>
  );
}
