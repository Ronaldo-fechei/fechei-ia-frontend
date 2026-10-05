/**
 * Envio de e-mails transacionais via SMTP (Resend, SendGrid, Amazon SES,
 * Gmail etc. oferecem SMTP). Sem SMTP configurado, em desenvolvimento o
 * conteúdo é exibido no log; em produção o envio falha de forma explícita.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { APP_NAME } from "@veloxia/shared";
import { emailConfigured, env, isProd } from "../config/env";
import { logger } from "../lib/logger";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!emailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Lista de e-mails "enviados" em modo de teste (para asserções). */
export const sentEmailsForTests: EmailMessage[] = [];

export async function sendEmail(message: EmailMessage): Promise<{ delivered: boolean }> {
  if (env.NODE_ENV === "test") {
    sentEmailsForTests.push(message);
    return { delivered: true };
  }
  const t = getTransporter();
  if (!t) {
    if (isProd) throw new Error("SMTP não configurado (defina SMTP_HOST e SMTP_FROM)");
    logger.warn({ to: message.to, subject: message.subject, text: message.text }, "[e-mail não enviado: SMTP não configurado — modo desenvolvimento]");
    return { delivered: false };
  }
  await t.sendMail({ from: env.SMTP_FROM, ...message });
  return { delivered: true };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function layoutEmail(title: string, paragraphs: string[], cta?: { label: string; url: string }): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f8;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:bold;color:#6834f0;padding-bottom:16px">${APP_NAME}</td></tr>
<tr><td style="font-size:18px;font-weight:bold;padding-bottom:12px">${escape(title)}</td></tr>
${paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:12px">${escape(p)}</td></tr>`).join("")}
${cta ? `<tr><td style="padding:12px 0 20px"><a href="${escape(cta.url)}" style="background:#6834f0;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${escape(cta.label)}</a></td></tr>` : ""}
<tr><td style="font-size:12px;color:#71717a">Se você não fez esta solicitação, ignore este e-mail.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, "", ...paragraphs, ...(cta ? ["", `${cta.label}: ${cta.url}`] : [])].join("\n");
  return { html, text };
}
