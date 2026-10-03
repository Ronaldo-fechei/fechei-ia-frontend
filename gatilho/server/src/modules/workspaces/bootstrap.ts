import { DEFAULT_TAGS, SYSTEM_FIELDS } from "@gatilho/shared";
import type { Tx } from "../../db/client";
import { customFields, subscriptions, tags, workspaceMembers, workspaces } from "../../db/schema";
import { defaultPlan } from "../billing/limits";

/** Cria o espaço de trabalho inicial de um usuário com plano, tags e campos padrão. */
export async function createWorkspaceForUser(tx: Tx, userId: string, name: string) {
  const [workspace] = await tx.insert(workspaces).values({ name, ownerId: userId }).returning();
  await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
  const plan = await defaultPlan(tx);
  await tx.insert(subscriptions).values({
    workspaceId: workspace.id,
    planId: plan.id,
    status: "active",
    currentPeriodStart: new Date(),
  });
  await tx.insert(tags).values(DEFAULT_TAGS.map((t) => ({ workspaceId: workspace.id, name: t.name, color: t.color })));
  await tx.insert(customFields).values(
    SYSTEM_FIELDS.map((f) => ({ workspaceId: workspace.id, key: f.key, label: f.label, type: f.type, isSystem: true })),
  );
  return workspace;
}
