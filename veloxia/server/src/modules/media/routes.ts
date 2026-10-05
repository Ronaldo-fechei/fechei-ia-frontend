/**
 * Upload de imagens para usar nas automações. Os arquivos ficam no banco e são
 * servidos por URL pública não adivinhável (o Instagram precisa baixá-los).
 */
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { mediaFiles } from "../../db/schema";
import { badRequest, notFound } from "../../lib/errors";
import { parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);
const MAX_BYTES = 8 * 1024 * 1024; // limite de imagem do Instagram

function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export const mediaUrl = (id: string, filename: string) => `${env.APP_URL}/api/media/${id}/${encodeURIComponent(filename)}`;

export async function mediaRoutes(app: FastifyInstance) {
  app.post("/media", { bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ filename: z.string().trim().min(1).max(120), dataBase64: z.string().min(10) }), req.body);
    const data = Buffer.from(input.dataBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (data.length > MAX_BYTES) throw badRequest("A imagem deve ter no máximo 8 MB.");
    const mime = sniff(data);
    if (!mime || !ALLOWED.has(mime)) throw badRequest("Envie uma imagem JPG, PNG, GIF ou WEBP.");
    const filename = `${input.filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60) || "imagem"}.${ALLOWED.get(mime)}`;
    const [row] = await db
      .insert(mediaFiles)
      .values({ workspaceId: auth.workspace.id, filename, mimeType: mime, sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), data })
      .returning({ id: mediaFiles.id, filename: mediaFiles.filename, sizeBytes: mediaFiles.sizeBytes, mimeType: mediaFiles.mimeType, createdAt: mediaFiles.createdAt });
    return reply.code(201).send({ media: { ...row, url: mediaUrl(row.id, row.filename) } });
  });

  app.get("/media", async (req) => {
    const auth = requireAuth(req);
    const rows = await db
      .select({ id: mediaFiles.id, filename: mediaFiles.filename, sizeBytes: mediaFiles.sizeBytes, mimeType: mediaFiles.mimeType, createdAt: mediaFiles.createdAt })
      .from(mediaFiles)
      .where(eq(mediaFiles.workspaceId, auth.workspace.id))
      .orderBy(desc(mediaFiles.createdAt))
      .limit(100);
    return { media: rows.map((r) => ({ ...r, url: mediaUrl(r.id, r.filename) })) };
  });

  app.delete("/media/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await db.delete(mediaFiles).where(and(eq(mediaFiles.id, id), eq(mediaFiles.workspaceId, auth.workspace.id)));
    return { ok: true };
  });

  /** Arquivo público (o ID é um UUID aleatório). */
  app.get("/media/:id/:filename", async (req, reply) => {
    const { id } = parse(uuidParam.extend({ filename: z.string() }), req.params);
    const [row] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, id)).limit(1);
    if (!row) throw notFound("Arquivo não encontrado.");
    return reply
      .header("Content-Type", row.mimeType)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .send(row.data);
  });
}
