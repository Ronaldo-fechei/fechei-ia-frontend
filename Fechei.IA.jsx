import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ============================================================================
   Fechei.IA — Micro SaaS de propostas comerciais com IA

   MODO HÍBRIDO:
   • BACKEND.url vazio  → modo demo (dados no navegador, IA do ambiente).
   • BACKEND.url preenchido → produção: login seguro (JWT), propostas no
     banco (Supabase), IA com sua chave e pagamento Mercado Pago.
   👉 Para ativar produção, preencha BACKEND.url logo abaixo com a URL do
      seu servidor publicado (ex.: Railway). Nada mais precisa mudar.
   ============================================================================ */

/* ---------- Design tokens ---------- */
const C = {
  ink: "#0B1F3A",        // azul escuro confiança
  inkSoft: "#1B3A5F",
  paper: "#F7F9FC",
  card: "#FFFFFF",
  line: "#E4EAF2",
  mute: "#5E6E85",
  money: "#1FAE6B",      // verde aprovação/dinheiro
  moneyDark: "#138A52",
  ai: "#6C4DF6",         // roxo IA
  aiSoft: "#EEEAFE",
  gold: "#E9B949",
  danger: "#E5484D",
  amber: "#F59E0B",
};

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";

/* ---------- Storage helpers (persistência local — modo demo/teste) ---------- */
const DB = {
  async get(key, fallback) {
    try {
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : fallback;
    } catch { return fallback; }
  },
  async set(key, value) {
    try { await window.storage.set(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  async del(key) {
    try { await window.storage.delete(key); } catch {}
  },
};

/* ============================================================================
   BACKEND — integração com o servidor (auth, propostas, IA).
   Modo híbrido:
     • Se BACKEND.url estiver preenchido → usa o servidor real (produção):
       login seguro (JWT), propostas no banco (Supabase), IA com sua chave.
     • Se estiver vazio → usa o armazenamento local (demonstração/teste),
       para o app continuar funcionando aqui sem o backend no ar.
   Para ativar produção: preencha BACKEND.url com a URL do Railway.
   ============================================================================ */
const BACKEND = {
  // Ex.: "https://fechei-ia.up.railway.app" — deixe "" para modo demo local.
  url: "https://fechei-ia-beckend-production.up.railway.app",
};
const backendOn = () => !!BACKEND.url;

/* Token JWT da sessão (em memória — reidratado no boot). */
const Session = {
  token: null,
  set(t) { this.token = t || null; },
  get() { return this.token; },
};

/* Chamada HTTP ao backend, com token quando autenticado. */
async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && Session.get()) headers.Authorization = `Bearer ${Session.get()}`;
  const res = await fetch(`${BACKEND.url}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

const API = {
  /* ---- Autenticação ---- */
  async signup(payload) {
    const r = await apiFetch("/auth/signup", { method: "POST", body: payload, auth: false });
    return r.user;
  },
  async login(email, password) {
    const r = await apiFetch("/auth/login", {
      method: "POST", body: { email, password }, auth: false,
    });
    Session.set(r.token);
    await DB.set("pp_token", r.token);   // reidrata no boot
    return r.user;
  },
  async logout() {
    Session.set(null);
    await DB.del("pp_token");
  },
  /* ---- Propostas ---- */
  async listProposals() {
    const r = await apiFetch("/proposals");
    return r.proposals || [];
  },
  async createProposal(p) {
    const r = await apiFetch("/proposals", { method: "POST", body: p });
    return r.proposal;
  },
  async updateProposal(id, patch) {
    const r = await apiFetch(`/proposals/${id}`, { method: "PUT", body: patch });
    return r.proposal;
  },
  async deleteProposal(id) {
    await apiFetch(`/proposals/${id}`, { method: "DELETE" });
  },
  /* ---- Perfil ---- */
  async updateProfile(patch) {
    const r = await apiFetch("/auth/profile", { method: "PUT", body: patch });
    return r.user;
  },
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayStr = () => new Date().toISOString();
const fmtMoney = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

/* ---------- Catálogos ---------- */
const SERVICE_TYPES = [
  "Social Media", "Gestão de Tráfego Pago", "Design Gráfico", "Criação de Logo",
  "Criação de Site", "Fotografia", "Vídeo", "Consultoria", "Manutenção residencial",
  "Reforma", "Pintura", "Serviços técnicos", "Serviços de beleza", "Marketing digital", "Outro",
];

const TONES = [
  { id: "formal", label: "Formal", desc: "Sóbrio e corporativo" },
  { id: "moderno", label: "Moderno", desc: "Atual e dinâmico" },
  { id: "persuasivo", label: "Persuasivo", desc: "Foco em conversão" },
  { id: "consultivo", label: "Consultivo", desc: "Autoridade e diagnóstico" },
  { id: "premium", label: "Premium", desc: "Sofisticado e exclusivo" },
  { id: "direto", label: "Direto", desc: "Objetivo, sem rodeios" },
  { id: "amigavel", label: "Amigável", desc: "Próximo e caloroso" },
];

const TEMPLATES = [
  { id: "social", name: "Social Media", svc: "Social Media", accent: "#6C4DF6", icon: "📱" },
  { id: "trafego", name: "Tráfego Pago", svc: "Gestão de Tráfego Pago", accent: "#1FAE6B", icon: "📈" },
  { id: "site", name: "Criação de Site", svc: "Criação de Site", accent: "#0EA5E9", icon: "🌐" },
  { id: "design", name: "Design Gráfico", svc: "Design Gráfico", accent: "#EC4899", icon: "🎨" },
  { id: "foto", name: "Fotografia", svc: "Fotografia", accent: "#F59E0B", icon: "📷" },
  { id: "video", name: "Vídeo & Edição", svc: "Produção de Vídeo", accent: "#EF4444", icon: "🎬" },
  { id: "consult", name: "Consultoria", svc: "Consultoria", accent: "#0B1F3A", icon: "💼" },
  { id: "reforma", name: "Reforma / Manutenção", svc: "Reforma", accent: "#E9B949", icon: "🔧" },
  { id: "marketing", name: "Marketing Digital", svc: "Marketing Digital", accent: "#8B5CF6", icon: "🚀" },
  { id: "branding", name: "Branding & Identidade", svc: "Branding", accent: "#DB2777", icon: "✨" },
  { id: "dev", name: "Desenvolvimento de Software", svc: "Desenvolvimento de Software", accent: "#2563EB", icon: "💻" },
  { id: "app", name: "Aplicativo Mobile", svc: "Desenvolvimento de App", accent: "#0891B2", icon: "📲" },
  { id: "ecommerce", name: "Loja Virtual / E-commerce", svc: "E-commerce", accent: "#16A34A", icon: "🛒" },
  { id: "copy", name: "Copywriting & Conteúdo", svc: "Redação / Copywriting", accent: "#CA8A04", icon: "✍️" },
  { id: "seo", name: "SEO & Otimização", svc: "SEO", accent: "#059669", icon: "🔍" },
  { id: "arquitetura", name: "Arquitetura & Interiores", svc: "Projeto de Arquitetura", accent: "#7C3AED", icon: "📐" },
  { id: "evento", name: "Eventos & Produção", svc: "Produção de Eventos", accent: "#DC2626", icon: "🎉" },
  { id: "juridico", name: "Serviços Jurídicos", svc: "Assessoria Jurídica", accent: "#1E3A8A", icon: "⚖️" },
  { id: "contabil", name: "Contabilidade & Financeiro", svc: "Serviços Contábeis", accent: "#0F766E", icon: "📊" },
  { id: "coach", name: "Coaching & Mentoria", svc: "Coaching / Mentoria", accent: "#9333EA", icon: "🎯" },
  { id: "saude", name: "Saúde & Bem-estar", svc: "Serviços de Saúde", accent: "#0D9488", icon: "🩺" },
  { id: "educacao", name: "Educação & Treinamento", svc: "Curso / Treinamento", accent: "#D97706", icon: "🎓" },
  { id: "traducao", name: "Tradução & Idiomas", svc: "Tradução", accent: "#4F46E5", icon: "🌍" },
  { id: "generic", name: "Serviço Geral", svc: "Outro", accent: "#5E6E85", icon: "📄" },
];

const PLANS = [
  {
    id: "free", name: "Gratuito", price: "R$ 0", period: "para sempre",
    highlight: false, cta: "Começar grátis",
    features: ["2 propostas por mês", "Modelos básicos", "Exportação com marca d'água",
      "Mensagem para WhatsApp", "Sem personalização avançada"],
  },
  {
    id: "pro", name: "Pro", price: "R$ 39", period: "/mês",
    highlight: true, cta: "Assinar o Pro",
    features: ["Propostas ilimitadas", "PDF sem marca d'água", "Todos os modelos premium",
      "Logotipo e cores da marca", "Mensagens WhatsApp e e-mail", "Histórico completo"],
  },
  {
    id: "premium", name: "Premium", price: "R$ 79", period: "/mês",
    highlight: false, cta: "Assinar o Premium",
    features: ["Tudo do Pro", "Contratos simples", "Assinatura digital", "Analytics de propostas",
      "Links públicos ilimitados", "Modelos avançados", "Múltiplos membros"],
  },
];

const PLAN_LIMITS = { free: 2, pro: Infinity, premium: Infinity };

/* Preços estruturados para o checkout (centavos evitam erro de float). */
const PLAN_PRICING = {
  free:    { amountCents: 0,    label: "R$ 0",  interval: null },
  pro:     { amountCents: 3900, label: "R$ 39", interval: "month" },
  premium: { amountCents: 7900, label: "R$ 79", interval: "month" },
};

/* ============================================================================
   CAMADA DE PAGAMENTO — pronta para Stripe e Mercado Pago.

   Em produção, a criação da sessão de checkout DEVE ocorrer no backend
   (a secret key nunca vai para o front). O front apenas chama seu endpoint
   e redireciona para a URL retornada. Abaixo deixamos:
     • a configuração centralizada (PAYMENTS)
     • os contratos das funções de backend esperadas (createCheckout*)
     • um modo demonstração que simula o fluxo de checkout/retorno
   Basta plugar a URL real do seu backend em PAYMENTS.endpoint e desligar
   PAYMENTS.demoMode para entrar em produção.
   ============================================================================ */
const PAYMENTS = {
  // Provedor ativo (Brasil): Mercado Pago — Pix, boleto e cartão.
  provider: "mercadopago",
  // demoMode liga sozinho quando o backend não está configurado.
  get demoMode() { return !backendOn(); },
  // O endpoint de pagamento é o próprio backend.
  get endpoint() { return BACKEND.url; },
  currency: "BRL",
  successPath: "?checkout=success",
  cancelPath: "?checkout=cancel",
};

/* Chama o backend para criar a sessão de checkout do provedor ativo.
   Espera-se que o backend responda { url: "https://checkout..." }. */
async function createCheckoutSession(planId, user) {
  const pricing = PLAN_PRICING[planId];
  if (!pricing || pricing.amountCents === 0) {
    return { ok: false, error: "Plano gratuito não requer pagamento." };
  }

  // MODO DEMONSTRAÇÃO: simula o checkout sem cobrança real.
  if (PAYMENTS.demoMode || !PAYMENTS.endpoint) {
    return {
      ok: true,
      demo: true,
      provider: PAYMENTS.provider,
      plan: planId,
      amount: pricing.label,
    };
  }

  // PRODUÇÃO: o backend cria a preferência no Mercado Pago e retorna a URL.
  try {
    const data = await apiFetch("/payment/checkout", {
      method: "POST",
      body: { plan: planId },
    });
    if (data && data.url) return { ok: true, url: data.url };
    return { ok: false, error: data.error || "Falha ao criar checkout." };
  } catch (e) {
    return { ok: false, error: e.message || "Não foi possível contatar o servidor de pagamento." };
  }
}

/* Confirma o pagamento ao voltar do provedor. Em produção, valide via
   webhook no backend; aqui lemos o parâmetro de retorno da URL. */
function readCheckoutReturn() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("checkout") === "success") return "success";
    if (p.get("checkout") === "cancel") return "cancel";
  } catch {}
  return null;
}


/* ---------- Tipografia / estilos globais ---------- */
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: ${FONT_BODY}; }
      ::selection { background: ${C.ai}; color: #fff; }
      .pp-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
      .pp-scroll::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 8px; }
      @keyframes ppFade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
      @keyframes ppPop { 0% { transform: scale(.96); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      @keyframes ppSpin { to { transform: rotate(360deg); } }
      @keyframes ppShimmer { 0% { background-position: -480px 0; } 100% { background-position: 480px 0; } }
      @keyframes ppFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
      @keyframes ppGrad { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
      .pp-anim { animation: ppFade .6s cubic-bezier(.2,.7,.3,1) both; }
      .pp-pop { animation: ppPop .4s cubic-bezier(.2,.7,.3,1) both; }
      .pp-btn { transition: transform .15s ease, box-shadow .2s ease, background .2s ease, opacity .2s; cursor: pointer; border: none; font-family: ${FONT_BODY}; }
      .pp-btn:hover { transform: translateY(-2px); }
      .pp-btn:active { transform: translateY(0); }
      .pp-card { transition: transform .25s cubic-bezier(.2,.7,.3,1), box-shadow .25s ease; }
      .pp-lift:hover { transform: translateY(-6px); box-shadow: 0 22px 50px -20px rgba(11,31,58,.28); }
      input, textarea, select { font-family: ${FONT_BODY}; outline: none; }
      input:focus, textarea:focus, select:focus { border-color: ${C.ai} !important; box-shadow: 0 0 0 4px ${C.aiSoft}; }
      .pp-fieldlabel { font-size: 12.5px; font-weight: 700; color: ${C.ink}; letter-spacing: .02em; text-transform: uppercase; }
      a { color: inherit; }
      @media print { .pp-noprint { display: none !important; } }
    `}</style>
  );
}

/* ---------- Primitivos de UI ---------- */
const Btn = ({ children, kind = "primary", size = "md", style, ...p }) => {
  const sizes = {
    sm: { padding: "8px 14px", fontSize: 13 },
    md: { padding: "12px 22px", fontSize: 14.5 },
    lg: { padding: "16px 30px", fontSize: 16 },
  };
  const kinds = {
    primary: { background: C.ink, color: "#fff", boxShadow: "0 12px 26px -12px rgba(11,31,58,.6)" },
    ai: { background: `linear-gradient(120deg, ${C.ai}, #8E6BFF)`, color: "#fff", boxShadow: "0 14px 30px -12px rgba(108,77,246,.65)" },
    money: { background: `linear-gradient(120deg, ${C.money}, #28C57E)`, color: "#fff", boxShadow: "0 14px 30px -12px rgba(31,174,107,.6)" },
    ghost: { background: "transparent", color: C.ink, border: `1.5px solid ${C.line}` },
    soft: { background: C.paper, color: C.ink, border: `1px solid ${C.line}` },
    danger: { background: "#FFF0F0", color: C.danger, border: `1px solid #F5C4C5` },
  };
  return (
    <button className="pp-btn" style={{
      borderRadius: 13, fontWeight: 700, display: "inline-flex", alignItems: "center",
      gap: 9, justifyContent: "center", ...sizes[size], ...kinds[kind], ...style,
    }} {...p}>{children}</button>
  );
};

const Field = ({ label, hint, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
    {label && <label className="pp-fieldlabel">{label}</label>}
    {children}
    {hint && <span style={{ fontSize: 12, color: C.mute }}>{hint}</span>}
  </div>
);

const inputStyle = {
  width: "100%", padding: "13px 15px", borderRadius: 12, border: `1.5px solid ${C.line}`,
  fontSize: 15, color: C.ink, background: "#fff", transition: "border .15s, box-shadow .15s",
};

const Input = (p) => <input style={{ ...inputStyle, ...p.style }} {...p} />;
const Textarea = (p) => <textarea style={{ ...inputStyle, minHeight: 96, resize: "vertical", lineHeight: 1.55, ...p.style }} {...p} />;
const Select = ({ children, ...p }) => (
  <select style={{ ...inputStyle, appearance: "none", cursor: "pointer",
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%235E6E85' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 15px center", paddingRight: 38, ...p.style }} {...p}>{children}</select>
);

const Badge = ({ children, color = C.mute, bg }) => (
  <span style={{
    fontSize: 11.5, fontWeight: 800, color, background: bg || `${color}1A`,
    padding: "4px 10px", borderRadius: 999, letterSpacing: ".03em", textTransform: "uppercase",
    display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
  }}>{children}</span>
);

const Spinner = ({ size = 16, color = "#fff" }) => (
  <span style={{
    width: size, height: size, border: `2.5px solid ${color}40`,
    borderTopColor: color, borderRadius: "50%", display: "inline-block",
    animation: "ppSpin .7s linear infinite",
  }} />
);

const Logo = ({ size = 22, dark = false }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div style={{
      width: size + 12, height: size + 12, borderRadius: 11,
      background: `linear-gradient(135deg, ${C.ai}, #8E6BFF 60%, ${C.money})`,
      display: "grid", placeItems: "center", color: "#fff", fontWeight: 800,
      fontSize: size - 4, boxShadow: "0 8px 20px -8px rgba(108,77,246,.6)",
    }}>F</div>
    <span style={{ fontFamily: FONT_DISPLAY, fontSize: size, fontWeight: 600,
      color: dark ? "#fff" : C.ink, letterSpacing: "-.01em" }}>
      Fechei<span style={{ color: C.ai }}>.IA</span>
    </span>
  </div>
);

const STATUS = {
  rascunho: { label: "Rascunho", color: C.mute },
  enviada: { label: "Enviada", color: "#0EA5E9" },
  aprovada: { label: "Aprovada", color: C.money },
  recusada: { label: "Recusada", color: C.danger },
};

/* ============================================================================
   CAMADA DE IA — modo configurável pelo usuário:
   • "auto"  → tenta a IA real e cai no modo local se falhar (recomendado)
   • "ia"    → força a IA real (sem fallback silencioso; avisa se falhar)
   • "local" → usa apenas a geração local inteligente (rápida, offline)
   A preferência fica salva por usuário e é lida em tempo de execução.
   ============================================================================ */
const AI_MODEL = "claude-sonnet-4-20250514";

/* Modo de IA global em memória — sincronizado com o storage do usuário logado. */
const AIState = {
  mode: "auto",                 // "auto" | "ia" | "local"
  set(m) { this.mode = m === "ia" || m === "local" ? m : "auto"; },
  get() { return this.mode; },
};

async function callAI(systemPrompt, userPrompt, maxTokens = 1400) {
  // Modo local: nunca chama a rede.
  if (AIState.get() === "local") return { ok: false, text: "", local: true };

  // PRODUÇÃO: a IA passa pelo backend (sua chave fica segura no servidor).
  if (backendOn()) {
    try {
      const r = await apiFetch("/ai", {
        method: "POST",
        body: { system: systemPrompt, prompt: userPrompt, maxTokens },
      });
      if (r && r.ok && r.text) return { ok: true, text: r.text };
      return { ok: false, text: "" };
    } catch {
      return { ok: false, text: "" };
    }
  }

  // DEMO (artifact): usa a IA disponível no ambiente do Claude.
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) throw new Error("empty");
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: "" };
  }
}

const TONE_GUIDE = {
  formal: "linguagem sóbria, corporativa, impessoal e respeitosa",
  moderno: "linguagem atual, dinâmica, leve mas profissional",
  persuasivo: "linguagem orientada à conversão, com gatilhos de valor e urgência sutil",
  consultivo: "linguagem de autoridade, com diagnóstico e recomendações de especialista",
  premium: "linguagem sofisticada, exclusiva, que transmite alto valor agregado",
  direto: "linguagem objetiva, sem rodeios, frases curtas e claras",
  amigavel: "linguagem próxima, calorosa e acessível, mantendo profissionalismo",
};

/* Geração da proposta completa, seção a seção. */
async function generateProposal(d) {
  const tone = TONE_GUIDE[d.tone] || TONE_GUIDE.persuasivo;
  const sys = `Você é um redator comercial sênior brasileiro, especialista em propostas que fecham negócios. Escreva sempre em português do Brasil, com ${tone}. Não use markdown, não use títulos, não use listas com asteriscos. Responda APENAS com o JSON pedido, sem texto extra, sem cercas de código.`;

  const ctx = `
DADOS DO PRESTADOR:
- Nome: ${d.provider.name || "—"}
- Descrição: ${d.provider.about || "—"}
- Contato: ${d.provider.phone || "—"} | ${d.provider.email || "—"} | ${d.provider.site || "—"}

DADOS DO CLIENTE:
- Cliente: ${d.client.name || "—"} (${d.client.company || "—"})
- Segmento: ${d.client.segment || "—"}
- Problema/necessidade: ${d.client.problem || "—"}

SERVIÇO: ${d.serviceType === "Outro" ? d.serviceTypeOther : d.serviceType}

PROJETO:
- Título: ${d.project.title || "—"}
- Objetivo: ${d.project.goal || "—"}
- Escopo (rascunho do usuário): ${d.project.scope || "—"}
- Entregáveis (rascunho): ${d.project.deliverables || "—"}
- Prazo: ${d.project.deadline || "—"}
- Etapas: ${d.project.steps || "—"}
- Revisões incluídas: ${d.project.revisions || "—"}
- Observações: ${d.project.notes || "—"}

COMERCIAL:
- Valor total: ${fmtMoney(d.commercial.total)}
- Pagamento: ${d.commercial.payment || "—"}
- Parcelamento: ${d.commercial.installments || "—"}
- Recorrência: ${d.commercial.recurring || "—"}
- Validade: ${d.commercial.validity || "15 dias"}
- Condições: ${d.commercial.conditions || "—"}`;

  const ask = `${ctx}

Gere a proposta comercial em JSON com EXATAMENTE estas chaves (todas string, exceto schedule e nextSteps que são arrays):
{
 "presentation": "2 parágrafos apresentando o prestador de forma profissional e confiável",
 "understanding": "1-2 parágrafos demonstrando que entendeu profundamente o problema do cliente",
 "objective": "1 parágrafo claro sobre o objetivo do projeto",
 "solution": "2 parágrafos descrevendo a solução proposta e como resolve o problema",
 "scope": "texto reescrito de forma profissional e detalhada do escopo (parágrafo único, fluido)",
 "deliverables": ["item 1", "item 2", "item 3", "item 4", "item 5"],
 "schedule": [{"phase":"Etapa","detail":"o que acontece","time":"prazo"}, ... 3 a 5 itens],
 "differentials": ["diferencial competitivo 1", "diferencial 2", "diferencial 3", "diferencial 4"],
 "nextSteps": ["passo 1", "passo 2", "passo 3", "passo 4"],
 "closing": "1 parágrafo de chamada final persuasiva convidando o cliente a aprovar"
}
Seja específico ao contexto, nunca genérico. Não invente dados de contato.`;

  const r = await callAI(sys, ask, 2200);
  if (r.ok) {
    try {
      const clean = r.text.replace(/```json|```/g, "").trim();
      const j = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
      return { ...j, _ai: true };
    } catch { /* cai no fallback */ }
  }
  return localProposal(d);
}

/* Fallback local — coerente e profissional mesmo sem IA. */
function localProposal(d) {
  const svc = d.serviceType === "Outro" ? (d.serviceTypeOther || "serviço") : d.serviceType;
  const cli = d.client.name || "o cliente";
  const comp = d.client.company ? ` (${d.client.company})` : "";
  const prov = d.provider.name || "nossa equipe";
  return {
    presentation: `${prov} atua com excelência em ${svc.toLowerCase()}, entregando resultados consistentes para quem precisa de profissionalismo e confiança. ${d.provider.about || "Nosso compromisso é unir estratégia, qualidade de execução e atenção a cada detalhe."}\n\nCada projeto é conduzido com método, comunicação clara e foco no resultado que importa para o seu negócio.`,
    understanding: `Entendemos que ${cli}${comp} enfrenta um desafio concreto: ${d.client.problem || "melhorar seus resultados de forma estruturada"}. Esse cenário exige uma abordagem sob medida — e não uma solução genérica. Mapeamos esse contexto antes de propor qualquer caminho.`,
    objective: d.project.goal || `Entregar ${svc.toLowerCase()} de alto padrão que resolva a necessidade apresentada e gere retorno mensurável para ${cli}.`,
    solution: `Propomos um plano de ${svc.toLowerCase()} desenhado especificamente para o seu momento. ${d.project.scope || "Atuaremos de ponta a ponta, com etapas bem definidas e entregas claras."}\n\nO trabalho é organizado em fases, com pontos de validação, garantindo previsibilidade e qualidade do início ao fim.`,
    scope: d.project.scope
      ? `O escopo contempla: ${d.project.scope}. Todo o trabalho é executado com padrão profissional, comunicação contínua e alinhamento constante de expectativas.`
      : `Escopo completo de ${svc.toLowerCase()}, executado com padrão profissional e acompanhamento dedicado durante todo o projeto.`,
    deliverables: (d.project.deliverables || "Planejamento estratégico\nExecução completa do serviço\nRelatório de entrega\nSuporte durante o período\nAjustes e revisões previstas")
      .split(/\n|,|;/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    schedule: (d.project.steps || "Diagnóstico e alinhamento\nExecução\nRevisão e entrega")
      .split(/\n|,|;/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
      .map((p, i) => ({ phase: `Fase ${i + 1}`, detail: p, time: i === 0 ? "Semana 1" : `Semana ${i + 1}` })),
    differentials: [
      "Atendimento próximo e comunicação transparente",
      "Entrega no prazo combinado, sem surpresas",
      "Padrão profissional em cada detalhe",
      "Foco no resultado real para o seu negócio",
    ],
    nextSteps: [
      "Aprovação desta proposta",
      "Pagamento da entrada (quando aplicável)",
      "Reunião de alinhamento inicial",
      "Início do projeto",
    ],
    closing: `${cli}, esta proposta foi construída para resolver exatamente o que você precisa — com clareza, qualidade e segurança. Estamos prontos para começar assim que você aprovar. Será um prazer trabalhar com você.`,
    _ai: false,
  };
}

/* Mensagens WhatsApp / E-mail. */
async function generateMessages(d, proposalTitle, link) {
  const sys = `Você escreve mensagens comerciais curtas e eficazes em português do Brasil. Responda APENAS o JSON pedido, sem markdown.`;
  const ask = `Cliente: ${d.client.name || "Cliente"}. Projeto: ${proposalTitle}. Objetivo: ${d.project.goal || d.serviceType}. Prestador: ${d.provider.name || ""}. Link da proposta: ${link}.
Gere JSON:
{
 "wppFormal":"mensagem de WhatsApp formal e curta",
 "wppDireta":"mensagem de WhatsApp direta e curta",
 "wppPersuasiva":"mensagem de WhatsApp persuasiva e curta",
 "wppAmigavel":"mensagem de WhatsApp amigável e curta",
 "emailSubject":"assunto do e-mail",
 "emailBody":"corpo do e-mail com saudação, resumo, chamada para resposta e assinatura"
}
Inclua o link nas mensagens. Não invente telefones.`;
  const r = await callAI(sys, ask, 900);
  if (r.ok) {
    try {
      const c = r.text.replace(/```json|```/g, "").trim();
      return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
    } catch {}
  }
  const cli = d.client.name || "Cliente";
  const obj = d.project.goal || proposalTitle;
  return {
    wppFormal: `Olá, ${cli}. Tudo bem? Preparei uma proposta personalizada referente a ${obj}. Ela contém o escopo, prazos, investimento e próximos passos. Segue o link para análise: ${link}. Permaneço à disposição.`,
    wppDireta: `Oi ${cli}! Proposta de ${obj} pronta. Escopo, valores e prazos no link: ${link}. Qualquer dúvida me chama. 👍`,
    wppPersuasiva: `Olá, ${cli}! 🚀 Montei uma proposta sob medida pra ${obj} — pensada pra entregar resultado de verdade. Dá uma olhada: ${link}. Posso reservar sua agenda essa semana?`,
    wppAmigavel: `Oi ${cli}, tudo bem? 😊 Caprichei na proposta pra ${obj}! Tá tudo certinho aqui: ${link}. Me conta o que achou, tô por aqui!`,
    emailSubject: `Proposta Comercial — ${proposalTitle}`,
    emailBody: `Olá, ${cli},\n\nEspero que esteja bem. Conforme conversamos, preparei uma proposta personalizada para ${obj}.\n\nNo documento você encontra o escopo completo, cronograma, investimento e próximos passos. Acesse pelo link: ${link}\n\nFico à disposição para esclarecer qualquer ponto e seguir com os próximos passos assim que estiver tudo certo.\n\nAtenciosamente,\n${d.provider.name || ""}\n${d.provider.phone || ""}`,
  };
}

/* Ações rápidas de texto no editor. */
async function quickAI(action, text) {
  const map = {
    melhorar: "Melhore este texto deixando-o mais claro e profissional, mantendo o sentido",
    profissional: "Reescreva este texto em tom corporativo e profissional",
    persuasivo: "Reescreva este texto deixando-o mais persuasivo e orientado à venda",
    resumir: "Resuma este texto em no máximo 3 frases mantendo o essencial",
    expandir: "Expanda este texto com mais detalhes e argumentos de valor",
    premium: "Reescreva este texto com linguagem premium, sofisticada e de alto valor",
    portugues: "Corrija a gramática e ortografia deste texto, sem mudar o sentido",
    fechamento: "Transforme este texto em uma chamada final persuasiva de fechamento de venda",
  };
  const sys = `Você é redator comercial brasileiro. ${map[action] || map.melhorar}. Responda APENAS o texto final, sem aspas, sem markdown, sem comentários.`;
  const r = await callAI(sys, text, 800);
  return r.ok ? r.text : text;
}

/* ============================================================================
   LANDING PAGE — página de vendas de alta conversão
   ============================================================================ */
function Landing({ go }) {
  const [faq, setFaq] = useState(null);
  const benefits = [
    { icon: "⚡", t: "Pronto em minutos", d: "Da informação solta à proposta completa em menos de 5 minutos." },
    { icon: "🤖", t: "Escrita por IA", d: "A IA transforma seu rascunho em texto profissional e persuasivo." },
    { icon: "📄", t: "PDF que impressiona", d: "Capa, sua marca, tabela de preços e layout de agência." },
    { icon: "💬", t: "Mensagem pronta", d: "WhatsApp e e-mail gerados automaticamente para enviar na hora." },
    { icon: "🎨", t: "Sua identidade", d: "Logotipo, cores e 8 modelos por tipo de serviço." },
    { icon: "📊", t: "Acompanhe tudo", d: "Status, taxa de aprovação e ticket médio no seu painel." },
  ];
  const steps = [
    { n: "01", t: "Conte o básico", d: "Quem é você, quem é o cliente e o que será feito." },
    { n: "02", t: "A IA monta tudo", d: "Estrutura completa, escopo, cronograma e argumentos de venda." },
    { n: "03", t: "Ajuste e envie", d: "Edite, exporte em PDF e mande pelo WhatsApp em um clique." },
  ];

  return (
    <div className="pp-scroll" style={{ background: C.paper, minHeight: "100vh", overflowX: "hidden" }}>
      {/* NAV */}
      <nav className="pp-noprint" style={{
        position: "sticky", top: 0, zIndex: 50, background: "rgba(247,249,252,.82)",
        backdropFilter: "blur(14px)", borderBottom: `1px solid ${C.line}`,
        padding: "16px clamp(20px,5vw,64px)", display: "flex",
        alignItems: "center", justifyContent: "space-between",
      }}>
        <Logo />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="#como-funciona" className="pp-navlink" style={{
            color: C.mute, fontWeight: 700, fontSize: 14.5, padding: "8px 12px",
            textDecoration: "none", cursor: "pointer",
          }}>Como funciona</a>
          <a href="#planos" className="pp-navlink" style={{
            color: C.mute, fontWeight: 700, fontSize: 14.5, padding: "8px 12px",
            textDecoration: "none", cursor: "pointer",
          }}>Planos</a>
          <button onClick={() => go("login")} className="pp-btn" style={{
            background: "none", color: C.ink, fontWeight: 700, fontSize: 14.5, padding: "8px 12px",
          }}>Entrar</button>
          <Btn kind="ai" size="sm" onClick={() => go("signup")}>Criar conta grátis</Btn>
        </div>
      </nav>

      {/* HERO */}
      <header style={{ position: "relative", padding: "clamp(48px,8vw,110px) clamp(20px,5vw,64px) clamp(40px,6vw,80px)" }}>
        <div style={{
          position: "absolute", inset: 0, zIndex: 0, opacity: .5,
          background: `radial-gradient(60% 60% at 78% 12%, ${C.aiSoft} 0%, transparent 60%), radial-gradient(50% 50% at 8% 90%, #DEF6EA 0%, transparent 55%)`,
        }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1180, margin: "0 auto",
          display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 56, alignItems: "center" }}
          className="pp-hero-grid">
          <div className="pp-anim">
            <Badge color={C.ai} bg={C.aiSoft}>✦ Propostas com Inteligência Artificial</Badge>
            <h1 style={{
              fontFamily: FONT_DISPLAY, fontWeight: 600, color: C.ink,
              fontSize: "clamp(38px,5.4vw,66px)", lineHeight: 1.05, margin: "20px 0 18px",
              letterSpacing: "-.02em",
            }}>
              Crie propostas comerciais <span style={{
                background: `linear-gradient(120deg, ${C.ai}, ${C.money})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>profissionais</span> em poucos minutos.
            </h1>
            <p style={{ fontSize: "clamp(16px,1.8vw,20px)", color: C.mute, lineHeight: 1.6, maxWidth: 540, marginBottom: 32 }}>
              Transforme informações simples em propostas completas, bonitas e persuasivas —
              e feche mais clientes sem perder horas escrevendo.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Btn kind="ai" size="lg" onClick={() => go("signup")}>
                Criar minha primeira proposta →
              </Btn>
              <Btn kind="ghost" size="lg" onClick={() => go("login")}>Já tenho conta</Btn>
            </div>
            <div style={{ display: "flex", gap: 22, marginTop: 30, flexWrap: "wrap", color: C.mute, fontSize: 13.5, fontWeight: 600 }}>
              <span>✓ Grátis para começar</span>
              <span>✓ Sem cartão de crédito</span>
              <span>✓ Pronto em 5 minutos</span>
            </div>
          </div>
          {/* mock visual */}
          <div className="pp-anim" style={{ animationDelay: ".15s", position: "relative" }}>
            <div className="pp-card" style={{
              background: "#fff", borderRadius: 22, padding: 24, border: `1px solid ${C.line}`,
              boxShadow: "0 40px 80px -30px rgba(11,31,58,.4)", transform: "rotate(1.4deg)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>
                    Proposta Comercial
                  </div>
                  <div style={{ fontSize: 12.5, color: C.mute, marginTop: 3 }}>Para: Loja Aurora</div>
                </div>
                <Badge color={C.money}>● Pronta</Badge>
              </div>
              <div style={{
                height: 92, borderRadius: 14, marginBottom: 16,
                background: `linear-gradient(120deg, ${C.ink}, ${C.inkSoft})`,
                display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 20px", gap: 6,
              }}>
                <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600 }}>
                  Gestão de Redes Sociais
                </div>
                <div style={{ color: "#9FB6D6", fontSize: 12.5, fontWeight: 600 }}>Plano mensal · 90 dias</div>
              </div>
              {["Planejamento de conteúdo", "20 posts por mês", "Relatório de resultados"].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 6, background: `${C.money}1F`,
                    color: C.money, fontSize: 11, fontWeight: 900, display: "grid", placeItems: "center", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 13.5, color: C.ink, fontWeight: 600 }}>{item}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                marginTop: 16, padding: 14, borderRadius: 12, background: C.paper }}>
                <span style={{ fontSize: 12, color: C.mute, fontWeight: 700, letterSpacing: ".04em" }}>INVESTIMENTO</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: C.money, fontFamily: FONT_DISPLAY }}>R$ 2.400</span>
              </div>
            </div>
            <div style={{
              position: "absolute", bottom: -22, left: -18, background: "#fff",
              padding: "12px 18px", borderRadius: 14, border: `1px solid ${C.line}`,
              boxShadow: "0 20px 40px -16px rgba(11,31,58,.3)", display: "flex",
              alignItems: "center", gap: 10, animation: "ppFloat 4s ease-in-out infinite",
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: C.aiSoft,
                display: "grid", placeItems: "center", fontSize: 16 }}>🤖</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>IA escreveu</div>
                <div style={{ fontSize: 11, color: C.mute }}>em 4,2 segundos</div>
              </div>
            </div>
          </div>
        </div>
        {/* prova social */}
        <div style={{ maxWidth: 1180, margin: "70px auto 0", display: "flex",
          gap: 40, justifyContent: "center", flexWrap: "wrap", opacity: .65,
          fontSize: 13, fontWeight: 700, color: C.mute, textTransform: "uppercase", letterSpacing: ".08em" }}>
          <span>Freelancers</span><span>•</span><span>Agências</span><span>•</span>
          <span>Prestadores de serviço</span><span>•</span><span>MEIs</span><span>•</span><span>Consultores</span>
        </div>
      </header>

      {/* BENEFÍCIOS */}
      <section style={{ padding: "clamp(50px,7vw,90px) clamp(20px,5vw,64px)", background: "#fff" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <Badge color={C.ai} bg={C.aiSoft}>Por que usar</Badge>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(28px,3.6vw,44px)",
              color: C.ink, margin: "16px 0 12px", fontWeight: 600, letterSpacing: "-.02em" }}>
              Tudo o que você precisa para fechar mais
            </h2>
            <p style={{ color: C.mute, fontSize: 17, maxWidth: 560, margin: "0 auto" }}>
              Pare de perder vendas por causa de orçamento simples demais.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 22 }}>
            {benefits.map((b, i) => (
              <div key={i} className="pp-card pp-lift" style={{
                background: C.paper, borderRadius: 18, padding: 30, border: `1px solid ${C.line}`,
              }}>
                <div style={{ fontSize: 30, marginBottom: 16 }}>{b.icon}</div>
                <h3 style={{ fontSize: 19, color: C.ink, marginBottom: 8, fontWeight: 800 }}>{b.t}</h3>
                <p style={{ color: C.mute, fontSize: 15, lineHeight: 1.6 }}>{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" style={{ padding: "clamp(50px,7vw,90px) clamp(20px,5vw,64px)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <Badge color={C.money}>Simples assim</Badge>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(28px,3.6vw,44px)",
              color: C.ink, margin: "16px 0", fontWeight: 600, letterSpacing: "-.02em" }}>
              Três passos. Nenhuma dor de cabeça.
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 24 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ position: "relative", padding: "8px 4px" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 64, fontWeight: 600,
                  color: C.line, lineHeight: 1, marginBottom: 8 }}>{s.n}</div>
                <h3 style={{ fontSize: 22, color: C.ink, marginBottom: 10, fontWeight: 800 }}>{s.t}</h3>
                <p style={{ color: C.mute, fontSize: 15.5, lineHeight: 1.6 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LANÇAMENTO — seção honesta de early-adopter.
          👉 Quando tiver depoimentos REAIS de clientes, troque os 3 cards
             abaixo por aspas reais (nome, profissão e foto/iniciais). */}
      <section style={{ padding: "clamp(50px,7vw,90px) clamp(20px,5vw,64px)", background: C.ink }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 50 }}>
            <Badge color={C.gold} bg="#E9B94922">✦ Acabou de chegar</Badge>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(28px,3.6vw,42px)",
              color: "#fff", margin: "16px 0 14px", fontWeight: 600 }}>
              Seja um dos primeiros a fechar mais com IA
            </h2>
            <p style={{ color: "#9FB1C9", fontSize: 17, maxWidth: 600, margin: "0 auto", lineHeight: 1.6 }}>
              Enquanto seu concorrente ainda escreve orçamento no Word, você manda
              uma proposta de agência em minutos. Comece agora — é grátis.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 22 }}>
            {[
              { icon: "🎯", t: "Comece sem risco", d: "Plano grátis e sem cartão de crédito. Você só evolui de plano se realmente gostar." },
              { icon: "⚡", t: "Resultado imediato", d: "Em menos de 5 minutos sua primeira proposta profissional está pronta para enviar." },
              { icon: "🔒", t: "Seus dados protegidos", d: "Cada conta acessa apenas as próprias propostas, com armazenamento seguro." },
            ].map((c, i) => (
              <div key={i} style={{ background: "#13294A", borderRadius: 18, padding: 30,
                border: "1px solid #1F3A5F" }}>
                <div style={{ fontSize: 30, marginBottom: 16 }}>{c.icon}</div>
                <h3 style={{ color: "#fff", fontWeight: 800, fontSize: 19, marginBottom: 9 }}>{c.t}</h3>
                <p style={{ color: "#A9BAD2", fontSize: 15, lineHeight: 1.65 }}>{c.d}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 44 }}>
            <Btn kind="money" size="lg" onClick={() => go("signup")}>Começar agora — é grátis →</Btn>
            <p style={{ color: "#8499B5", fontSize: 13.5, fontWeight: 600, marginTop: 14 }}>
              Leva menos de 1 minuto para criar sua conta
            </p>
          </div>
        </div>
      </section>

      {/* PLANOS */}
      <section id="planos" style={{ padding: "clamp(50px,7vw,90px) clamp(20px,5vw,64px)", background: "#fff" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 50 }}>
            <Badge color={C.ai} bg={C.aiSoft}>Planos</Badge>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(28px,3.6vw,44px)",
              color: C.ink, margin: "16px 0", fontWeight: 600, letterSpacing: "-.02em" }}>
              Comece grátis. Cresça quando quiser.
            </h2>
          </div>
          <PlanCards go={go} />
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "clamp(50px,7vw,90px) clamp(20px,5vw,64px)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(26px,3.4vw,40px)",
            color: C.ink, marginBottom: 36, fontWeight: 600, textAlign: "center" }}>
            Perguntas frequentes
          </h2>
          {[
            { q: "Preciso saber escrever bem?", a: "Não. Você escreve do seu jeito, em poucas palavras, e a IA transforma em texto profissional e persuasivo automaticamente." },
            { q: "A proposta sai em PDF?", a: "Sim. Com capa, sua logo, suas cores, tabela de preços e layout de agência. Também geramos mensagem pronta para WhatsApp e e-mail." },
            { q: "Funciona para qualquer serviço?", a: "Sim. São 8 modelos por tipo de serviço — de social media a reforma — além do modelo genérico para qualquer prestador." },
            { q: "O plano grátis serve para começar?", a: "Serve. Você cria até 2 propostas por mês gratuitamente. Quando precisar de mais, o Pro libera propostas ilimitadas." },
            { q: "Meus dados ficam seguros?", a: "Sim. Cada conta acessa apenas suas próprias propostas, com rotas protegidas e armazenamento seguro." },
          ].map((f, i) => (
            <div key={i} onClick={() => setFaq(faq === i ? null : i)} style={{
              background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14,
              padding: "20px 24px", marginBottom: 12, cursor: "pointer",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                <span style={{ fontWeight: 800, color: C.ink, fontSize: 16 }}>{f.q}</span>
                <span style={{ fontSize: 22, color: C.ai, transform: faq === i ? "rotate(45deg)" : "none",
                  transition: "transform .2s", fontWeight: 400 }}>+</span>
              </div>
              {faq === i && <p style={{ color: C.mute, fontSize: 15, lineHeight: 1.65, marginTop: 14 }}>{f.a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section style={{ padding: "clamp(20px,4vw,40px) clamp(20px,5vw,64px) clamp(60px,8vw,100px)" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", borderRadius: 28,
          background: `linear-gradient(125deg, ${C.ink}, ${C.inkSoft} 55%, ${C.ai})`,
          padding: "clamp(40px,6vw,72px)", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(28px,4vw,48px)",
            color: "#fff", fontWeight: 600, marginBottom: 16, letterSpacing: "-.02em" }}>
            Sua próxima proposta pode fechar hoje.
          </h2>
          <p style={{ color: "#C9D6E8", fontSize: 18, marginBottom: 28, maxWidth: 520, margin: "0 auto 28px" }}>
            Crie agora, grátis. Em 5 minutos você tem uma proposta de agência na mão.
          </p>
          <Btn kind="money" size="lg" onClick={() => go("signup")}>Quero criar minha proposta grátis →</Btn>
          <p style={{ color: "#9FB1C9", fontSize: 13.5, fontWeight: 600, marginTop: 16 }}>
            ✓ Grátis para começar &nbsp;·&nbsp; ✓ Sem cartão de crédito &nbsp;·&nbsp; ✓ Cancele quando quiser
          </p>
        </div>
      </section>

      <Footer go={go} />
      <WhatsAppWidget />
      <style>{`
        html { scroll-behavior: smooth; }
        #como-funciona, #planos { scroll-margin-top: 84px; }
        .pp-navlink:hover { color: ${C.ink}; }
        @media (max-width: 880px){ .pp-hero-grid{ grid-template-columns:1fr !important; } }
        @media (max-width: 720px){ .pp-navlink{ display:none !important; } }
      `}</style>
    </div>
  );
}

function PlanCards({ go, currentPlan, onPick }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 22 }}>
      {PLANS.map((p) => (
        <div key={p.id} className="pp-card pp-lift" style={{
          background: p.highlight ? C.ink : "#fff",
          color: p.highlight ? "#fff" : C.ink,
          borderRadius: 20, padding: 32, position: "relative",
          border: p.highlight ? "none" : `1px solid ${C.line}`,
          boxShadow: p.highlight ? "0 30px 60px -24px rgba(11,31,58,.5)" : "none",
        }}>
          {p.highlight && <div style={{ position: "absolute", top: -13, left: "50%",
            transform: "translateX(-50%)" }}><Badge color="#fff" bg={C.ai}>★ Mais popular</Badge></div>}
          <h3 style={{ fontSize: 21, fontWeight: 800, marginBottom: 8 }}>{p.name}</h3>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 22 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 600 }}>{p.price}</span>
            <span style={{ opacity: .6, fontSize: 14 }}>{p.period}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 }}>
            {p.features.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: 14.5,
                color: p.highlight ? "#D6E0EE" : C.mute, alignItems: "flex-start" }}>
                <span style={{ color: p.highlight ? C.money : C.money, fontWeight: 800 }}>✓</span>{f}
              </div>
            ))}
          </div>
          {currentPlan === p.id ? (
            <Btn kind={p.highlight ? "money" : "soft"} style={{ width: "100%" }} disabled>
              Plano atual
            </Btn>
          ) : (
            <Btn kind={p.highlight ? "money" : (p.id === "free" ? "ghost" : "primary")}
              style={{ width: "100%", ...(p.highlight ? {} : p.id === "free" && p.highlight === false ? { borderColor: "#fff", color: C.ink } : {}) }}
              onClick={() => onPick ? onPick(p.id) : go("signup")}>
              {p.cta}
            </Btn>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Botão flutuante de WhatsApp com perguntas prontas ---------- */
const WA_NUMBER = "5511984127054"; // 55 (Brasil) + 11 98412-7054
function WhatsAppWidget() {
  const [open, setOpen] = useState(false);
  const quick = [
    { label: "💬 Quais são os planos e preços?", msg: "Olá! Vi o site do Fechei.IA e queria saber mais sobre os planos e preços." },
    { label: "🤖 Como funciona a criação de propostas?", msg: "Olá! Queria entender como o Fechei.IA cria propostas com IA." },
    { label: "🎁 Quero testar grátis", msg: "Olá! Quero começar no plano grátis do Fechei.IA. Pode me ajudar?" },
    { label: "🙋 Falar com uma pessoa", msg: "Olá! Preciso de ajuda com o Fechei.IA." },
  ];
  const send = (msg) =>
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");

  return (
    <div className="pp-noprint" style={{ position: "fixed", right: "clamp(16px,4vw,28px)", bottom: "clamp(16px,4vw,28px)", zIndex: 60 }}>
      {/* Painel */}
      {open && (
        <div style={{
          position: "absolute", bottom: 76, right: 0, width: "min(330px, calc(100vw - 36px))",
          background: "#fff", borderRadius: 18, overflow: "hidden",
          boxShadow: "0 30px 60px -18px rgba(11,31,58,.45)", border: `1px solid ${C.line}`,
          animation: "ppFloat .25s ease",
        }}>
          {/* Cabeçalho */}
          <div style={{ background: "linear-gradient(120deg, #25D366, #1FAE6B)", padding: "18px 20px",
            display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,.18)",
              display: "grid", placeItems: "center", color: "#fff", fontWeight: 800,
              fontFamily: FONT_DISPLAY, fontSize: 20 }}>F</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 15.5 }}>Fechei.IA</div>
              <div style={{ color: "#E4FBEC", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C6FFD9", display: "inline-block" }} />
                Normalmente responde rápido
              </div>
            </div>
          </div>
          {/* Corpo */}
          <div style={{ padding: 18, background: "#F2F5F9" }}>
            <div style={{ background: "#fff", borderRadius: "4px 14px 14px 14px", padding: "12px 14px",
              fontSize: 14, color: C.ink, lineHeight: 1.55, marginBottom: 14,
              boxShadow: "0 2px 6px -3px rgba(11,31,58,.2)" }}>
              Olá! 👋 Sobre o que você quer falar? Escolha uma opção:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {quick.map((q, i) => (
                <button key={i} onClick={() => send(q.msg)} className="pp-btn" style={{
                  textAlign: "left", background: "#fff", border: `1px solid ${C.line}`,
                  borderRadius: 12, padding: "11px 14px", fontSize: 13.5, fontWeight: 600,
                  color: C.ink, cursor: "pointer", width: "100%",
                }}>{q.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Botão verde */}
      <button onClick={() => setOpen((v) => !v)} aria-label="Abrir conversa no WhatsApp"
        className="pp-btn" style={{
          width: 60, height: 60, borderRadius: "50%", border: "none", cursor: "pointer",
          background: open ? C.ink : "#25D366", display: "grid", placeItems: "center",
          boxShadow: "0 14px 30px -10px rgba(37,211,102,.7)", marginLeft: "auto",
        }}>
        {open ? (
          <span style={{ color: "#fff", fontSize: 26, fontWeight: 400, lineHeight: 1 }}>×</span>
        ) : (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="#fff">
            <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.821 9.821 0 0 0 1.692 5.514l-.999 3.648 3.737-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
          </svg>
        )}
      </button>
    </div>
  );
}

function Footer({ go }) {
  return (
    <footer className="pp-noprint" style={{ background: C.ink, color: "#8FA3BE",
      padding: "50px clamp(20px,5vw,64px) 36px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex",
        justifyContent: "space-between", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
        <div>
          <Logo dark size={20} />
          <p style={{ marginTop: 12, fontSize: 13.5, maxWidth: 320, lineHeight: 1.6 }}>
            Propostas comerciais profissionais com IA. Feche mais clientes em menos tempo.
          </p>
        </div>
        <div style={{ display: "flex", gap: 30, fontSize: 13.5, flexWrap: "wrap" }}>
          <a onClick={() => go("login")} style={{ cursor: "pointer" }}>Entrar</a>
          <a onClick={() => go("signup")} style={{ cursor: "pointer" }}>Criar conta</a>
          <a onClick={() => go("privacy")} style={{ cursor: "pointer" }}>Privacidade</a>
          <a onClick={() => go("terms")} style={{ cursor: "pointer" }}>Termos de uso</a>
        </div>
      </div>
      <div style={{ maxWidth: 1180, margin: "30px auto 0", paddingTop: 20,
        borderTop: "1px solid #1F3A5F", fontSize: 12.5, display: "flex",
        justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span>© 2026 Fechei.IA. Todos os direitos reservados.</span>
        <span>Feito para quem vive de prestar serviço.</span>
      </div>
    </footer>
  );
}

/* ============================================================================
   AUTENTICAÇÃO — login, cadastro, recuperação
   ============================================================================ */
function AuthShell({ children, title, sub }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr",
      background: C.paper }} className="pp-auth-grid">
      <div className="pp-auth-side" style={{ position: "relative", overflow: "hidden",
        background: `linear-gradient(150deg, ${C.ink}, ${C.inkSoft} 60%, ${C.ai})` }}>
        <div style={{ position: "absolute", inset: 0, opacity: .35,
          background: `radial-gradient(50% 40% at 75% 20%, ${C.money}55 0%, transparent 60%)` }} />
        <div style={{ position: "relative", padding: 56, height: "100%",
          display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <Logo dark />
          <div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, color: "#fff",
              fontWeight: 600, lineHeight: 1.15, marginBottom: 18 }}>
              Propostas que parecem de agência. Feitas em minutos.
            </h2>
            <p style={{ color: "#C9D6E8", fontSize: 16, lineHeight: 1.6 }}>
              A IA escreve, você ajusta, o cliente aprova.
            </p>
          </div>
          <div style={{ display: "flex", gap: 20, color: "#A9BDD6", fontSize: 13.5, fontWeight: 600 }}>
            <span>★★★★★ 4,9/5</span><span>+1.200 propostas criadas</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="pp-pop" style={{ width: "100%", maxWidth: 400 }}>
          <div style={{ marginBottom: 28 }} className="pp-auth-logo"><Logo /></div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, color: C.ink, fontWeight: 600, marginBottom: 8 }}>{title}</h1>
          <p style={{ color: C.mute, fontSize: 15, marginBottom: 28 }}>{sub}</p>
          {children}
        </div>
      </div>
      <style>{`
        .pp-auth-side { display: none; }
        @media (min-width: 900px){ .pp-auth-side{ display:block; } .pp-auth-logo{ display:none; } }
        @media (max-width: 899px){ .pp-auth-grid{ grid-template-columns:1fr !important; } }
      `}</style>
    </div>
  );
}

function Login({ go, onAuth }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    if (!email || !pass) return setErr("Preencha e-mail e senha.");
    setBusy(true);
    try {
      if (backendOn()) {
        const u = await API.login(email.toLowerCase().trim(), pass);
        setBusy(false);
        onAuth(u);
        return;
      }
      const users = await DB.get("pp_users", {});
      const u = users[email.toLowerCase().trim()];
      setBusy(false);
      if (!u || u.password !== pass) return setErr("E-mail ou senha incorretos.");
      onAuth(u);
    } catch (e) {
      setBusy(false);
      setErr(e.message || "Não foi possível entrar.");
    }
  }

  return (
    <AuthShell title="Bem-vindo de volta" sub="Entre para continuar criando propostas.">
      {err && <div style={{ background: "#FFF0F0", color: C.danger, padding: "11px 14px",
        borderRadius: 11, fontSize: 13.5, marginBottom: 16, fontWeight: 600 }}>{err}</div>}
      <Field label="E-mail">
        <Input type="email" placeholder="voce@email.com" value={email}
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      <Field label="Senha">
        <Input type="password" placeholder="••••••••" value={pass}
          onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      <div style={{ textAlign: "right", marginBottom: 18 }}>
        <a onClick={() => go("recover")} style={{ color: C.ai, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Esqueci minha senha
        </a>
      </div>
      <Btn kind="ai" style={{ width: "100%" }} onClick={submit} disabled={busy}>
        {busy ? <Spinner /> : "Entrar"}
      </Btn>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0", color: C.mute, fontSize: 12.5 }}>
        <div style={{ flex: 1, height: 1, background: C.line }} /> ou <div style={{ flex: 1, height: 1, background: C.line }} />
      </div>
      <Btn kind="soft" style={{ width: "100%" }} onClick={() => setErr("Login com Google estará disponível na versão com backend.")}>
        <span style={{ fontWeight: 800, color: "#4285F4" }}>G</span> Continuar com Google
      </Btn>
      <p style={{ textAlign: "center", marginTop: 24, color: C.mute, fontSize: 14 }}>
        Não tem conta? <a onClick={() => go("signup")} style={{ color: C.ai, fontWeight: 700, cursor: "pointer" }}>Criar agora</a>
      </p>
    </AuthShell>
  );
}

function Signup({ go, onAuth }) {
  const [f, setF] = useState({ name: "", email: "", pass: "", pass2: "", terms: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    setErr("");
    if (!f.name || !f.email || !f.pass) return setErr("Preencha todos os campos.");
    if (f.pass.length < 4) return setErr("A senha precisa de pelo menos 4 caracteres.");
    if (f.pass !== f.pass2) return setErr("As senhas não conferem.");
    if (!f.terms) return setErr("Você precisa aceitar os termos de uso.");
    setBusy(true);
    const key = f.email.toLowerCase().trim();
    try {
      if (backendOn()) {
        if (f.pass.length < 6) { setBusy(false); return setErr("No servidor a senha precisa de ao menos 6 caracteres."); }
        await API.signup({ name: f.name, email: key, password: f.pass });
        const u = await API.login(key, f.pass);   // já entra logado
        setBusy(false);
        onAuth(u);
        return;
      }
      const users = await DB.get("pp_users", {});
      if (users[key]) { setBusy(false); return setErr("Já existe uma conta com esse e-mail."); }
      const user = {
        id: uid(), name: f.name, email: key, password: f.pass, plan: "free",
        company_name: "", phone: "", logo_url: "", brand_color: C.ink,
        site: "", about: "", ai_mode: "auto", created_at: todayStr(),
      };
      users[key] = user;
      await DB.set("pp_users", users);
      await DB.set(`pp_proposals_${user.id}`, []);
      setBusy(false);
      onAuth(user);
    } catch (e) {
      setBusy(false);
      setErr(e.message || "Não foi possível criar a conta.");
    }
  }

  return (
    <AuthShell title="Crie sua conta grátis" sub="Sua primeira proposta profissional sai hoje.">
      {err && <div style={{ background: "#FFF0F0", color: C.danger, padding: "11px 14px",
        borderRadius: 11, fontSize: 13.5, marginBottom: 16, fontWeight: 600 }}>{err}</div>}
      <Field label="Nome completo">
        <Input placeholder="Seu nome" value={f.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="E-mail">
        <Input type="email" placeholder="voce@email.com" value={f.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Senha">
          <Input type="password" placeholder="••••••" value={f.pass} onChange={(e) => set("pass", e.target.value)} />
        </Field>
        <Field label="Confirmar">
          <Input type="password" placeholder="••••••" value={f.pass2} onChange={(e) => set("pass2", e.target.value)} />
        </Field>
      </div>
      <label style={{ display: "flex", gap: 10, fontSize: 13.5, color: C.mute,
        marginBottom: 20, cursor: "pointer", alignItems: "flex-start" }}>
        <input type="checkbox" checked={f.terms} onChange={(e) => set("terms", e.target.checked)}
          style={{ marginTop: 2, accentColor: C.ai, width: 16, height: 16 }} />
        <span>Li e aceito os <a onClick={() => go("terms")} style={{ color: C.ai, fontWeight: 700 }}>Termos de uso</a> e a <a onClick={() => go("privacy")} style={{ color: C.ai, fontWeight: 700 }}>Política de privacidade</a>.</span>
      </label>
      <Btn kind="ai" style={{ width: "100%" }} onClick={submit} disabled={busy}>
        {busy ? <Spinner /> : "Criar conta grátis →"}
      </Btn>
      <p style={{ textAlign: "center", marginTop: 24, color: C.mute, fontSize: 14 }}>
        Já tem conta? <a onClick={() => go("login")} style={{ color: C.ai, fontWeight: 700, cursor: "pointer" }}>Entrar</a>
      </p>
    </AuthShell>
  );
}

function Recover({ go }) {
  const [sent, setSent] = useState(false);
  return (
    <AuthShell title="Recuperar senha" sub="Enviaremos instruções para seu e-mail.">
      {sent ? (
        <div style={{ background: "#E9F9F1", color: C.moneyDark, padding: 20, borderRadius: 13,
          fontSize: 14.5, lineHeight: 1.6 }}>
          ✓ Se existir uma conta com esse e-mail, você receberá as instruções de recuperação em instantes.
          <div style={{ marginTop: 16 }}>
            <Btn kind="soft" size="sm" onClick={() => go("login")}>Voltar ao login</Btn>
          </div>
        </div>
      ) : (
        <>
          <Field label="E-mail da conta">
            <Input type="email" placeholder="voce@email.com" />
          </Field>
          <Btn kind="ai" style={{ width: "100%" }} onClick={() => setSent(true)}>Enviar instruções</Btn>
          <p style={{ textAlign: "center", marginTop: 24, color: C.mute, fontSize: 14 }}>
            <a onClick={() => go("login")} style={{ color: C.ai, fontWeight: 700, cursor: "pointer" }}>← Voltar ao login</a>
          </p>
        </>
      )}
    </AuthShell>
  );
}

/* ============================================================================
   APP SHELL — navegação lateral autenticada
   ============================================================================ */
function AppShell({ user, view, go, onLogout, children }) {
  const nav = [
    { id: "dashboard", label: "Painel", icon: "▦" },
    { id: "create", label: "Nova proposta", icon: "✦" },
    { id: "plans", label: "Planos", icon: "◆" },
    { id: "settings", label: "Configurações", icon: "⚙" },
  ];
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.paper }}>
      <aside className="pp-noprint" style={{
        width: 248, background: "#fff", borderRight: `1px solid ${C.line}`,
        display: "flex", flexDirection: "column", padding: "26px 18px",
        position: "fixed", height: "100vh", zIndex: 40,
        transform: open ? "none" : undefined,
      }} data-open={open}>
        <div style={{ padding: "0 8px 24px" }}><Logo size={19} /></div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {nav.map((n) => {
            const active = view === n.id;
            return (
              <button key={n.id} className="pp-btn" onClick={() => { go(n.id); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                  borderRadius: 11, background: active ? C.ink : "transparent",
                  color: active ? "#fff" : C.mute, fontWeight: 700, fontSize: 14.5,
                  textAlign: "left", transform: "none",
                }}>
                <span style={{ fontSize: 15, color: active ? C.money : C.mute }}>{n.icon}</span>
                {n.label}
              </button>
            );
          })}
        </nav>
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 6px", marginBottom: 8 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10,
              background: `linear-gradient(135deg,${C.ai},${C.money})`, color: "#fff",
              display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>
              {(user.name || "U")[0].toUpperCase()}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: C.ink,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
              <Badge color={user.plan === "free" ? C.mute : C.money}>
                {user.plan === "free" ? "Plano Grátis" : `Plano ${user.plan === "pro" ? "Pro" : "Premium"}`}
              </Badge>
            </div>
          </div>
          <button className="pp-btn" onClick={onLogout} style={{
            width: "100%", padding: "10px", borderRadius: 10, background: C.paper,
            color: C.mute, fontWeight: 700, fontSize: 13.5, transform: "none",
          }}>Sair</button>
        </div>
      </aside>

      <button className="pp-btn pp-noprint" onClick={() => setOpen((o) => !o)} style={{
        position: "fixed", top: 16, left: 16, zIndex: 60, background: C.ink, color: "#fff",
        width: 42, height: 42, borderRadius: 11, fontSize: 18, display: "none",
      }} data-mobilemenu>{open ? "✕" : "☰"}</button>

      <main style={{ flex: 1, marginLeft: 248, padding: "clamp(20px,4vw,44px)" }} className="pp-main">
        {children}
      </main>

      <style>{`
        @media (max-width: 860px){
          aside { transform: translateX(-100%); transition: transform .25s; }
          aside[data-open="true"] { transform: translateX(0) !important; }
          .pp-main { margin-left: 0 !important; padding-top: 72px !important; }
          [data-mobilemenu] { display: grid !important; }
        }
      `}</style>
    </div>
  );
}

/* ============================================================================
   DASHBOARD + ANALYTICS
   ============================================================================ */
function Dashboard({ user, proposals, go, onOpen, onDuplicate, onDelete, onExport }) {
  const now = new Date();
  const thisMonth = proposals.filter((p) => {
    const d = new Date(p.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const sent = proposals.filter((p) => ["enviada", "aprovada", "recusada"].includes(p.status));
  const approved = proposals.filter((p) => p.status === "aprovada");
  const refused = proposals.filter((p) => p.status === "recusada");
  const totalSent = sent.reduce((a, p) => a + (Number(p.total_value) || 0), 0);
  const decided = approved.length + refused.length;
  const apprRate = decided ? Math.round((approved.length / decided) * 100) : 0;
  const ticket = approved.length ? totalSent / sent.length : 0;
  const limit = PLAN_LIMITS[user.plan];
  const remaining = limit === Infinity ? "∞" : Math.max(0, limit - thisMonth.length);

  const [filter, setFilter] = useState("todas");
  const shown = filter === "todas" ? proposals : proposals.filter((p) => p.status === filter);

  const stats = [
    { label: "Propostas no mês", val: thisMonth.length, sub: `${remaining} restantes`, color: C.ai },
    { label: "Total enviado", val: fmtMoney(totalSent), sub: `${sent.length} propostas`, color: C.money },
    { label: "Taxa de aprovação", val: `${apprRate}%`, sub: `${approved.length} aprovadas`, color: C.moneyDark },
    { label: "Ticket médio", val: fmtMoney(ticket), sub: `por proposta`, color: C.ink },
  ];

  return (
    <div className="pp-anim">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        flexWrap: "wrap", gap: 16, marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(26px,3.4vw,38px)",
            color: C.ink, fontWeight: 600, letterSpacing: "-.02em" }}>
            Olá, {user.name.split(" ")[0]} 👋
          </h1>
          <p style={{ color: C.mute, fontSize: 15.5, marginTop: 6 }}>
            Aqui está o resumo das suas propostas.
          </p>
        </div>
        <Btn kind="ai" size="lg" onClick={() => go("create")}>＋ Criar nova proposta</Btn>
      </div>

      {user.plan === "free" && thisMonth.length >= limit && (
        <div style={{ background: "#FFF7E8", border: `1px solid #F3D98C`, borderRadius: 14,
          padding: "16px 20px", marginBottom: 24, display: "flex", justifyContent: "space-between",
          alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <span style={{ color: "#92660A", fontWeight: 700, fontSize: 14.5 }}>
            ⚠ Você atingiu o limite de {limit} propostas do plano grátis este mês.
          </span>
          <Btn kind="money" size="sm" onClick={() => go("plans")}>Fazer upgrade</Btn>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
        gap: 18, marginBottom: 36 }}>
        {stats.map((s, i) => (
          <div key={i} className="pp-card" style={{ background: "#fff", borderRadius: 18,
            padding: 24, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.mute,
              textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 12 }}>{s.label}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600,
              color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 13, color: C.mute, marginTop: 8 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
        <h2 style={{ fontSize: 21, fontWeight: 800, color: C.ink }}>Suas propostas</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["todas", "rascunho", "enviada", "aprovada", "recusada"].map((s) => (
            <button key={s} className="pp-btn" onClick={() => setFilter(s)} style={{
              padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700,
              background: filter === s ? C.ink : "#fff", color: filter === s ? "#fff" : C.mute,
              border: `1px solid ${filter === s ? C.ink : C.line}`, transform: "none",
              textTransform: "capitalize",
            }}>{s}</button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 18, border: `1px dashed ${C.line}`,
          padding: 60, textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>📄</div>
          <h3 style={{ fontSize: 19, color: C.ink, fontWeight: 800, marginBottom: 8 }}>
            Nenhuma proposta {filter !== "todas" ? `(${filter})` : "ainda"}
          </h3>
          <p style={{ color: C.mute, fontSize: 15, marginBottom: 22 }}>
            Crie sua primeira proposta profissional em poucos minutos.
          </p>
          <Btn kind="ai" onClick={() => go("create")}>✦ Criar proposta com IA</Btn>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shown.slice().reverse().map((p) => (
            <div key={p.id} className="pp-card pp-lift" style={{
              background: "#fff", borderRadius: 16, border: `1px solid ${C.line}`,
              padding: "18px 22px", display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 18, flexWrap: "wrap",
            }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, color: C.ink, fontSize: 16 }}>
                    {p.title || "Proposta sem título"}
                  </span>
                  <Badge color={STATUS[p.status]?.color || C.mute}>
                    ● {STATUS[p.status]?.label || p.status}
                  </Badge>
                </div>
                <div style={{ fontSize: 13.5, color: C.mute, display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span>👤 {p.client_name || "Sem cliente"}</span>
                  <span>📅 {fmtDate(p.created_at)}</span>
                  <span style={{ fontWeight: 700, color: C.money }}>{fmtMoney(p.total_value)}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <Btn kind="soft" size="sm" onClick={() => onOpen(p.id)}>Editar</Btn>
                <Btn kind="soft" size="sm" onClick={() => onDuplicate(p.id)}>Duplicar</Btn>
                <Btn kind="soft" size="sm" onClick={() => onExport(p.id)}>PDF</Btn>
                <Btn kind="danger" size="sm" onClick={() => onDelete(p.id)}>Excluir</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   WIZARD DE CRIAÇÃO — 7 etapas com progresso visual
   ============================================================================ */
const emptyProposal = () => ({
  provider: { name: "", doc: "", phone: "", email: "", site: "", logo: "", color: C.ink, about: "" },
  client: { name: "", company: "", email: "", phone: "", segment: "", problem: "" },
  serviceType: "Social Media", serviceTypeOther: "",
  project: { title: "", goal: "", scope: "", deliverables: "", deadline: "",
    steps: "", revisions: "2", notes: "" },
  commercial: { total: "", payment: "Pix ou transferência", installments: "", entry: "",
    recurring: "", validity: "15 dias", conditions: "", taxes: "Impostos inclusos", extra: "" },
  plans: [],
  tone: "persuasivo",
  template: "social",
});

const STEPS = [
  "Prestador", "Cliente", "Serviço", "Projeto", "Valores", "Tom", "Gerar com IA",
];

function Wizard({ user, draft, onCancel, onGenerated }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState(draft || emptyProposal());
  const [gen, setGen] = useState(false);
  const [genMsg, setGenMsg] = useState("");

  useEffect(() => {
    if (!draft && user) {
      setD((s) => ({ ...s, provider: {
        ...s.provider, name: user.company_name || user.name || "",
        phone: user.phone || "", email: user.email || "",
        site: user.site || "", about: user.about || "",
        color: user.brand_color || C.ink, logo: user.logo_url || "",
      }}));
    }
  }, []);

  const upd = (section, key, val) =>
    setD((s) => ({ ...s, [section]: { ...s[section], [key]: val } }));
  const updRoot = (key, val) => setD((s) => ({ ...s, [key]: val }));

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  async function doGenerate() {
    setGen(true);
    setGenMsg("Analisando as informações do projeto…");
    await new Promise((r) => setTimeout(r, 600));
    setGenMsg("Escrevendo a proposta com IA…");
    const content = await generateProposal(d);
    setGenMsg("Gerando mensagens para WhatsApp e e-mail…");
    const link = `fechei.ia/p/${uid()}`;
    const msgs = await generateMessages(d, d.project.title || "Proposta", `https://${link}`);
    setGenMsg("Finalizando…");
    await new Promise((r) => setTimeout(r, 400));
    const proposal = {
      id: uid(), user_id: user.id,
      title: d.project.title || `Proposta — ${d.client.name || "Cliente"}`,
      client_name: d.client.name, client_company: d.client.company,
      service_type: d.serviceType === "Outro" ? d.serviceTypeOther : d.serviceType,
      status: "rascunho",
      total_value: Number(d.commercial.total) || 0,
      data: d, content, messages: msgs,
      public_link: link, public_enabled: false,
      created_at: todayStr(), updated_at: todayStr(),
    };
    setGen(false);
    onGenerated(proposal);
  }

  const stepValid = useMemo(() => {
    if (step === 0) return !!d.provider.name;
    if (step === 1) return !!d.client.name;
    if (step === 3) return !!d.project.title;
    if (step === 4) return !!d.commercial.total;
    return true;
  }, [step, d]);

  return (
    <div className="pp-anim">
      {/* header + progress */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(24px,3vw,32px)",
            color: C.ink, fontWeight: 600 }}>Nova proposta</h1>
          <p style={{ color: C.mute, fontSize: 14.5, marginTop: 4 }}>
            Etapa {step + 1} de {STEPS.length} — {STEPS[step]}
          </p>
        </div>
        <Btn kind="soft" size="sm" onClick={onCancel}>✕ Cancelar</Btn>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 30 }}>
        {STEPS.map((s, i) => (
          <div key={i} onClick={() => i < step && setStep(i)} style={{
            flex: 1, height: 6, borderRadius: 999, cursor: i < step ? "pointer" : "default",
            background: i <= step ? `linear-gradient(90deg,${C.ai},${C.money})` : C.line,
            transition: "background .3s",
          }} />
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 20, border: `1px solid ${C.line}`,
        padding: "clamp(22px,4vw,40px)", maxWidth: 820, margin: "0 auto" }}>

        {step === 0 && (
          <StepWrap title="Dados do prestador" desc="Quem está enviando a proposta.">
            <Row>
              <Field label="Nome da empresa ou profissional *">
                <Input value={d.provider.name} onChange={(e) => upd("provider", "name", e.target.value)}
                  placeholder="Ex: Estúdio Criativo / João Silva" />
              </Field>
              <Field label="CNPJ ou CPF (opcional)">
                <Input value={d.provider.doc} onChange={(e) => upd("provider", "doc", e.target.value)}
                  placeholder="00.000.000/0001-00" />
              </Field>
            </Row>
            <Row>
              <Field label="Telefone / WhatsApp">
                <Input value={d.provider.phone} onChange={(e) => upd("provider", "phone", e.target.value)}
                  placeholder="(11) 90000-0000" />
              </Field>
              <Field label="E-mail">
                <Input value={d.provider.email} onChange={(e) => upd("provider", "email", e.target.value)}
                  placeholder="contato@email.com" />
              </Field>
            </Row>
            <Row>
              <Field label="Site ou Instagram">
                <Input value={d.provider.site} onChange={(e) => upd("provider", "site", e.target.value)}
                  placeholder="@seuperfil ou seusite.com" />
              </Field>
              <Field label="Cor principal da marca">
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="color" value={d.provider.color}
                    onChange={(e) => upd("provider", "color", e.target.value)}
                    style={{ width: 52, height: 46, borderRadius: 10, border: `1px solid ${C.line}`, cursor: "pointer", padding: 3 }} />
                  <Input value={d.provider.color} onChange={(e) => upd("provider", "color", e.target.value)} />
                </div>
              </Field>
            </Row>
            <Field label="Logotipo (opcional)">
              <LogoUpload value={d.provider.logo} onChange={(v) => upd("provider", "logo", v)} />
            </Field>
            <Field label="Breve descrição do prestador" hint="A IA usará isso na apresentação.">
              <Textarea value={d.provider.about} onChange={(e) => upd("provider", "about", e.target.value)}
                placeholder="Ex: Somos especialistas em gestão de redes sociais para pequenos negócios, ajudando marcas locais a crescerem no digital." />
            </Field>
          </StepWrap>
        )}

        {step === 1 && (
          <StepWrap title="Dados do cliente" desc="Para quem é esta proposta.">
            <Row>
              <Field label="Nome do cliente *">
                <Input value={d.client.name} onChange={(e) => upd("client", "name", e.target.value)}
                  placeholder="Ex: Maria Oliveira" />
              </Field>
              <Field label="Empresa do cliente">
                <Input value={d.client.company} onChange={(e) => upd("client", "company", e.target.value)}
                  placeholder="Ex: Padaria Pão Dourado" />
              </Field>
            </Row>
            <Row>
              <Field label="E-mail do cliente">
                <Input value={d.client.email} onChange={(e) => upd("client", "email", e.target.value)} />
              </Field>
              <Field label="Telefone do cliente">
                <Input value={d.client.phone} onChange={(e) => upd("client", "phone", e.target.value)} />
              </Field>
            </Row>
            <Field label="Segmento do cliente">
              <Input value={d.client.segment} onChange={(e) => upd("client", "segment", e.target.value)}
                placeholder="Ex: Alimentação, Varejo, Saúde…" />
            </Field>
            <Field label="Principal problema ou necessidade" hint="A IA vai mostrar que você entendeu a dor do cliente.">
              <Textarea value={d.client.problem} onChange={(e) => upd("client", "problem", e.target.value)}
                placeholder="Ex: O cliente precisa melhorar a presença no Instagram e gerar mais pedidos pelo WhatsApp." />
            </Field>
          </StepWrap>
        )}

        {step === 2 && (
          <StepWrap title="Tipo de serviço" desc="Selecione a categoria. Isso ajusta o modelo da proposta.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
              {SERVICE_TYPES.map((s) => (
                <button key={s} className="pp-btn" onClick={() => updRoot("serviceType", s)} style={{
                  padding: "16px 12px", borderRadius: 13, fontSize: 14, fontWeight: 700,
                  textAlign: "left", transform: "none",
                  background: d.serviceType === s ? C.ink : C.paper,
                  color: d.serviceType === s ? "#fff" : C.ink,
                  border: `1.5px solid ${d.serviceType === s ? C.ink : C.line}`,
                }}>{s}</button>
              ))}
            </div>
            {d.serviceType === "Outro" && (
              <div style={{ marginTop: 18 }}>
                <Field label="Descreva o serviço">
                  <Input value={d.serviceTypeOther} onChange={(e) => updRoot("serviceTypeOther", e.target.value)}
                    placeholder="Ex: Adestramento de cães" />
                </Field>
              </div>
            )}
          </StepWrap>
        )}

        {step === 3 && (
          <StepWrap title="Detalhes do projeto" desc="Escreva simples. A IA deixa profissional.">
            <Field label="Título da proposta *">
              <Input value={d.project.title} onChange={(e) => upd("project", "title", e.target.value)}
                placeholder="Ex: Gestão de Instagram — Padaria Pão Dourado" />
            </Field>
            <Field label="Objetivo do serviço">
              <Input value={d.project.goal} onChange={(e) => upd("project", "goal", e.target.value)}
                placeholder="Ex: Aumentar presença digital e gerar pedidos pelo WhatsApp" />
            </Field>
            <Field label="Escopo do serviço" hint="Pode escrever do seu jeito — a IA reescreve profissionalmente.">
              <Textarea value={d.project.scope} onChange={(e) => upd("project", "scope", e.target.value)}
                placeholder="Ex: Vou cuidar do Instagram, fazer posts, stories e responder comentários." />
            </Field>
            <Row>
              <Field label="Entregáveis" hint="Um por linha.">
                <Textarea value={d.project.deliverables} onChange={(e) => upd("project", "deliverables", e.target.value)}
                  placeholder={"12 posts/mês\n20 stories/mês\nRelatório mensal"} />
              </Field>
              <Field label="Etapas do trabalho" hint="Uma por linha.">
                <Textarea value={d.project.steps} onChange={(e) => upd("project", "steps", e.target.value)}
                  placeholder={"Planejamento\nProdução\nPublicação e análise"} />
              </Field>
            </Row>
            <Row>
              <Field label="Prazo de execução">
                <Input value={d.project.deadline} onChange={(e) => upd("project", "deadline", e.target.value)}
                  placeholder="Ex: 30 dias / mensal contínuo" />
              </Field>
              <Field label="Revisões incluídas">
                <Input value={d.project.revisions} onChange={(e) => upd("project", "revisions", e.target.value)}
                  placeholder="Ex: 2" />
              </Field>
            </Row>
            <Field label="Observações importantes">
              <Textarea value={d.project.notes} onChange={(e) => upd("project", "notes", e.target.value)}
                placeholder="Algo que o cliente precisa saber?" style={{ minHeight: 70 }} />
            </Field>
          </StepWrap>
        )}

        {step === 4 && (
          <StepWrap title="Valores e condições" desc="Quanto custa e como o cliente paga.">
            <Row>
              <Field label="Valor total da proposta *">
                <Input type="number" value={d.commercial.total}
                  onChange={(e) => upd("commercial", "total", e.target.value)} placeholder="2400" />
              </Field>
              <Field label="Forma de pagamento">
                <Input value={d.commercial.payment} onChange={(e) => upd("commercial", "payment", e.target.value)} />
              </Field>
            </Row>
            <Row>
              <Field label="Parcelamento">
                <Input value={d.commercial.installments} onChange={(e) => upd("commercial", "installments", e.target.value)}
                  placeholder="Ex: até 3x sem juros" />
              </Field>
              <Field label="Entrada (se houver)">
                <Input value={d.commercial.entry} onChange={(e) => upd("commercial", "entry", e.target.value)}
                  placeholder="Ex: 50% para iniciar" />
              </Field>
            </Row>
            <Row>
              <Field label="Recorrência mensal (se contínuo)">
                <Input value={d.commercial.recurring} onChange={(e) => upd("commercial", "recurring", e.target.value)}
                  placeholder="Ex: R$ 1.200/mês" />
              </Field>
              <Field label="Validade da proposta">
                <Input value={d.commercial.validity} onChange={(e) => upd("commercial", "validity", e.target.value)} />
              </Field>
            </Row>
            <Field label="Condições adicionais">
              <Textarea value={d.commercial.conditions} onChange={(e) => upd("commercial", "conditions", e.target.value)}
                placeholder="Ex: Valores não incluem tráfego pago. Impostos inclusos." style={{ minHeight: 70 }} />
            </Field>
            <PlansEditor plans={d.plans} onChange={(v) => updRoot("plans", v)} />
          </StepWrap>
        )}

        {step === 5 && (
          <StepWrap title="Tom da proposta" desc="A IA ajusta a linguagem ao estilo escolhido.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
              {TONES.map((t) => (
                <button key={t.id} className="pp-btn" onClick={() => updRoot("tone", t.id)} style={{
                  padding: "18px 16px", borderRadius: 14, textAlign: "left", transform: "none",
                  background: d.tone === t.id ? C.aiSoft : C.paper,
                  border: `1.5px solid ${d.tone === t.id ? C.ai : C.line}`,
                }}>
                  <div style={{ fontWeight: 800, color: C.ink, fontSize: 15.5, marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontSize: 13, color: C.mute }}>{t.desc}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 24 }}>
              <Field label="Modelo visual">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
                  {TEMPLATES.map((t) => (
                    <button key={t.id} className="pp-btn" onClick={() => updRoot("template", t.id)} style={{
                      padding: 14, borderRadius: 12, transform: "none", textAlign: "left",
                      display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 700,
                      background: d.template === t.id ? "#fff" : C.paper,
                      border: `1.5px solid ${d.template === t.id ? t.accent : C.line}`,
                      color: C.ink,
                    }}>
                      <span style={{ fontSize: 18 }}>{t.icon}</span>{t.name}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </StepWrap>
        )}

        {step === 6 && (
          <StepWrap title="Gerar proposta com IA" desc="Revise o resumo e gere a proposta completa.">
            <div style={{ background: C.paper, borderRadius: 14, padding: 22, marginBottom: 22 }}>
              <Summary d={d} />
            </div>
            {gen ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ display: "inline-flex", marginBottom: 20 }}>
                  <Spinner size={42} color={C.ai} />
                </div>
                <h3 style={{ fontSize: 18, color: C.ink, fontWeight: 800, marginBottom: 8 }}>
                  Criando sua proposta…
                </h3>
                <p style={{ color: C.mute, fontSize: 14.5 }}>{genMsg}</p>
                <div style={{ marginTop: 22, height: 6, background: C.line, borderRadius: 999,
                  overflow: "hidden", maxWidth: 320, margin: "22px auto 0" }}>
                  <div style={{ height: "100%", width: "70%",
                    background: `linear-gradient(90deg,${C.ai},${C.money})`,
                    animation: "ppShimmer 1.2s linear infinite",
                    backgroundSize: "480px 100%" }} />
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
                <p style={{ color: C.mute, fontSize: 15, marginBottom: 22, maxWidth: 440, margin: "0 auto 22px" }}>
                  A IA vai montar capa, apresentação, escopo, cronograma, investimento,
                  diferenciais e chamada de fechamento — tudo em português profissional.
                </p>
                <Btn kind="ai" size="lg" onClick={doGenerate}>✦ Gerar proposta com IA</Btn>
              </div>
            )}
          </StepWrap>
        )}

        {/* navegação */}
        {!gen && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32,
            paddingTop: 24, borderTop: `1px solid ${C.line}` }}>
            <Btn kind="ghost" onClick={prev} disabled={step === 0}
              style={{ opacity: step === 0 ? .4 : 1 }}>← Voltar</Btn>
            {step < STEPS.length - 1 && (
              <Btn kind="primary" onClick={next} disabled={!stepValid}
                style={{ opacity: stepValid ? 1 : .5 }}>
                Continuar →
              </Btn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const StepWrap = ({ title, desc, children }) => (
  <div className="pp-anim">
    <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: C.ink, fontWeight: 600, marginBottom: 6 }}>{title}</h2>
    <p style={{ color: C.mute, fontSize: 14.5, marginBottom: 26 }}>{desc}</p>
    {children}
  </div>
);

const Row = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="pp-row">
    {children}
    <style>{`@media (max-width:640px){ .pp-row{ grid-template-columns:1fr !important; } }`}</style>
  </div>
);

function LogoUpload({ value, onChange }) {
  const ref = useRef();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {value
        ? <img src={value} alt="logo" style={{ width: 64, height: 64, borderRadius: 12,
            objectFit: "contain", border: `1px solid ${C.line}`, background: "#fff", padding: 6 }} />
        : <div style={{ width: 64, height: 64, borderRadius: 12, border: `1px dashed ${C.line}`,
            display: "grid", placeItems: "center", color: C.mute, fontSize: 22 }}>🖼</div>}
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => onChange(r.result);
          r.readAsDataURL(f);
        }} />
      <Btn kind="soft" size="sm" onClick={() => ref.current?.click()}>
        {value ? "Trocar logo" : "Enviar logo"}
      </Btn>
      {value && <Btn kind="soft" size="sm" onClick={() => onChange("")}>Remover</Btn>}
    </div>
  );
}

function PlansEditor({ plans, onChange }) {
  const add = () => onChange([...plans, { name: "", desc: "", items: "", value: "", time: "", recommended: false }]);
  const set = (i, k, v) => onChange(plans.map((p, idx) => idx === i ? { ...p, [k]: v } : p));
  const rm = (i) => onChange(plans.filter((_, idx) => idx !== i));
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="pp-fieldlabel">Múltiplos planos (opcional)</span>
        <Btn kind="soft" size="sm" onClick={add}>＋ Adicionar plano</Btn>
      </div>
      {plans.length === 0 && (
        <p style={{ fontSize: 13, color: C.mute }}>
          Adicione planos como Básico, Profissional e Premium para o cliente escolher.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {plans.map((p, i) => (
          <div key={i} style={{ background: C.paper, borderRadius: 12, padding: 16,
            border: `1px solid ${C.line}` }}>
            <Row>
              <Field label="Nome do plano"><Input value={p.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="Profissional" /></Field>
              <Field label="Valor"><Input type="number" value={p.value} onChange={(e) => set(i, "value", e.target.value)} placeholder="2400" /></Field>
            </Row>
            <Field label="Descrição"><Input value={p.desc} onChange={(e) => set(i, "desc", e.target.value)} /></Field>
            <Row>
              <Field label="Entregáveis (um por linha)"><Textarea value={p.items} onChange={(e) => set(i, "items", e.target.value)} style={{ minHeight: 60 }} /></Field>
              <Field label="Prazo"><Input value={p.time} onChange={(e) => set(i, "time", e.target.value)} /></Field>
            </Row>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, fontSize: 13.5, color: C.mute, cursor: "pointer", fontWeight: 600 }}>
                <input type="checkbox" checked={p.recommended}
                  onChange={(e) => set(i, "recommended", e.target.checked)}
                  style={{ accentColor: C.money }} /> Plano recomendado ⭐
              </label>
              <Btn kind="danger" size="sm" onClick={() => rm(i)}>Remover</Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Summary({ d }) {
  const rows = [
    ["Prestador", d.provider.name || "—"],
    ["Cliente", `${d.client.name || "—"}${d.client.company ? ` (${d.client.company})` : ""}`],
    ["Serviço", d.serviceType === "Outro" ? d.serviceTypeOther : d.serviceType],
    ["Título", d.project.title || "—"],
    ["Valor", fmtMoney(d.commercial.total)],
    ["Tom", TONES.find((t) => t.id === d.tone)?.label],
    ["Modelo", TEMPLATES.find((t) => t.id === d.template)?.name],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "10px 24px" }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12,
          fontSize: 14, borderBottom: `1px dashed ${C.line}`, paddingBottom: 8 }}>
          <span style={{ color: C.mute, fontWeight: 600 }}>{k}</span>
          <span style={{ color: C.ink, fontWeight: 700, textAlign: "right" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   DOCUMENTO DA PROPOSTA — renderização que vira PDF / link público
   ============================================================================ */
function ProposalDoc({ p, forPrint }) {
  const d = p.data, c = p.content, color = d.provider.color || C.ink;
  const watermark = p._watermark;
  const Section = ({ n, title, children }) => (
    <div style={{ marginBottom: 30, breakInside: "avoid" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: color, color: "#fff",
          display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{n}</span>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.ink, fontWeight: 600 }}>{title}</h3>
      </div>
      <div style={{ fontSize: 14.5, color: "#33425A", lineHeight: 1.7, paddingLeft: 42 }}>{children}</div>
    </div>
  );
  const para = (t) => String(t || "").split("\n").filter(Boolean).map((x, i) =>
    <p key={i} style={{ marginBottom: 10 }}>{x}</p>);

  return (
    <div style={{ background: "#fff", color: C.ink, position: "relative",
      width: forPrint ? "210mm" : "100%", minHeight: forPrint ? "auto" : undefined,
      fontFamily: FONT_BODY }}>
      {watermark && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
          pointerEvents: "none", zIndex: 5, opacity: .08 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 56, fontWeight: 700,
            transform: "rotate(-28deg)", color: C.ink }}>Fechei.IA</span>
        </div>
      )}

      {/* CAPA */}
      <div style={{ background: `linear-gradient(150deg, ${color}, ${color}DD 60%, ${C.ink})`,
        color: "#fff", padding: "56px 50px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -60, right: -60, width: 220, height: 220,
          borderRadius: "50%", background: "#ffffff14" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 60 }}>
          {d.provider.logo
            ? <img src={d.provider.logo} alt="" style={{ maxHeight: 56, maxWidth: 160,
                objectFit: "contain", background: "#fff", borderRadius: 8, padding: 8 }} />
            : <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600 }}>{d.provider.name}</span>}
          <span style={{ fontSize: 13, opacity: .85, background: "#ffffff22",
            padding: "6px 14px", borderRadius: 999 }}>Proposta Comercial</span>
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 600,
          lineHeight: 1.15, marginBottom: 16, maxWidth: 560 }}>{p.title}</h1>
        <div style={{ display: "flex", gap: 40, marginTop: 50, fontSize: 13.5, flexWrap: "wrap" }}>
          <div><div style={{ opacity: .7, marginBottom: 4 }}>PREPARADO PARA</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.client.name || "—"}</div>
            {d.client.company && <div style={{ opacity: .85 }}>{d.client.company}</div>}</div>
          <div><div style={{ opacity: .7, marginBottom: 4 }}>POR</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.provider.name}</div></div>
          <div><div style={{ opacity: .7, marginBottom: 4 }}>DATA</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtDate(p.created_at)}</div></div>
        </div>
      </div>

      {/* CORPO */}
      <div style={{ padding: "44px 50px" }}>
        <Section n="1" title="Apresentação">{para(c.presentation)}</Section>
        <Section n="2" title="Entendimento da necessidade">{para(c.understanding)}</Section>
        <Section n="3" title="Objetivo">{para(c.objective)}</Section>
        <Section n="4" title="Solução proposta">{para(c.solution)}</Section>
        <Section n="5" title="Escopo dos serviços">{para(c.scope)}</Section>
        <Section n="6" title="Entregáveis">
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {(c.deliverables || []).map((it, i) => (
              <li key={i} style={{ display: "flex", gap: 10 }}>
                <span style={{ color: C.money, fontWeight: 800 }}>✓</span>{it}</li>
            ))}
          </ul>
        </Section>
        <Section n="7" title="Cronograma">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ background: C.paper }}>
              {["Etapa", "Descrição", "Prazo"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 12px",
                  color: C.mute, fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em" }}>{h}</th>))}
            </tr></thead>
            <tbody>
              {(c.schedule || []).map((s, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <td style={{ padding: "10px 12px", fontWeight: 700 }}>{s.phase}</td>
                  <td style={{ padding: "10px 12px" }}>{s.detail}</td>
                  <td style={{ padding: "10px 12px", color: color, fontWeight: 700 }}>{s.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section n="8" title="Investimento">
          {d.plans && d.plans.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(d.plans.length,3)},1fr)`, gap: 14 }}>
              {d.plans.map((pl, i) => (
                <div key={i} style={{ border: `2px solid ${pl.recommended ? C.money : C.line}`,
                  borderRadius: 14, padding: 18, position: "relative",
                  background: pl.recommended ? "#F2FBF6" : "#fff" }}>
                  {pl.recommended && <div style={{ position: "absolute", top: -11, left: 14 }}>
                    <Badge color="#fff" bg={C.money}>★ Recomendado</Badge></div>}
                  <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{pl.name || `Plano ${i+1}`}</div>
                  <div style={{ fontSize: 13, color: C.mute, marginBottom: 12 }}>{pl.desc}</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600,
                    color: C.money, marginBottom: 12 }}>{fmtMoney(pl.value)}</div>
                  {String(pl.items || "").split("\n").filter(Boolean).map((it, j) => (
                    <div key={j} style={{ fontSize: 13, marginBottom: 6, display: "flex", gap: 6 }}>
                      <span style={{ color: C.money }}>✓</span>{it}</div>))}
                  {pl.time && <div style={{ fontSize: 12.5, color: C.mute, marginTop: 10 }}>⏱ {pl.time}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: C.paper, borderRadius: 14, padding: 24,
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div><div style={{ fontSize: 13, color: C.mute, marginBottom: 4 }}>Investimento total</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600, color: C.money }}>
                  {fmtMoney(d.commercial.total)}</div></div>
              <div style={{ fontSize: 13.5, color: C.mute, textAlign: "right", lineHeight: 1.7 }}>
                {d.commercial.payment && <div>💳 {d.commercial.payment}</div>}
                {d.commercial.installments && <div>📆 {d.commercial.installments}</div>}
                {d.commercial.recurring && <div>🔁 {d.commercial.recurring}</div>}
              </div>
            </div>
          )}
        </Section>
        <Section n="9" title="Condições comerciais">
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
            {d.commercial.payment && <li>• Pagamento: {d.commercial.payment}</li>}
            {d.commercial.entry && <li>• Entrada: {d.commercial.entry}</li>}
            {d.commercial.installments && <li>• Parcelamento: {d.commercial.installments}</li>}
            <li>• Validade da proposta: {d.commercial.validity}</li>
            {d.project.revisions && <li>• Revisões incluídas: {d.project.revisions}</li>}
            {d.commercial.conditions && <li>• {d.commercial.conditions}</li>}
          </ul>
        </Section>
        <Section n="10" title="Diferenciais">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {(c.differentials || []).map((it, i) => (
              <div key={i} style={{ background: C.paper, borderRadius: 10, padding: "12px 14px",
                fontSize: 13.5, display: "flex", gap: 8 }}>
                <span style={{ color: color, fontWeight: 800 }}>◆</span>{it}</div>))}
          </div>
        </Section>
        <Section n="11" title="Próximos passos">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(c.nextSteps || []).map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: color,
                  color: "#fff", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800,
                  flexShrink: 0 }}>{i + 1}</span>{it}</div>))}
          </div>
        </Section>
        <div style={{ background: `linear-gradient(135deg, ${color}, ${C.ink})`, color: "#fff",
          borderRadius: 16, padding: "30px 34px", marginTop: 36, breakInside: "avoid" }}>
          <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
            Vamos começar?</h3>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, opacity: .92 }}>{c.closing}</p>
          <div style={{ marginTop: 18, fontSize: 13, opacity: .8 }}>
            Proposta válida por {d.commercial.validity}. Para aprovar, basta responder esta proposta.
          </div>
        </div>
      </div>

      {/* RODAPÉ */}
      <div style={{ borderTop: `1px solid ${C.line}`, padding: "20px 50px",
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
        fontSize: 12.5, color: C.mute }}>
        <span style={{ fontWeight: 700, color: C.ink }}>{d.provider.name}</span>
        <span>{[d.provider.phone, d.provider.email, d.provider.site].filter(Boolean).join("  •  ")}</span>
      </div>
    </div>
  );
}

/* ============================================================================
   EDITOR VISUAL — edita conteúdo, cores, ações rápidas de IA, exporta
   ============================================================================ */
const QUICK = [
  { id: "melhorar", label: "Melhorar texto" },
  { id: "profissional", label: "Mais profissional" },
  { id: "persuasivo", label: "Mais persuasivo" },
  { id: "resumir", label: "Resumir" },
  { id: "expandir", label: "Expandir" },
  { id: "premium", label: "Versão premium" },
  { id: "portugues", label: "Corrigir português" },
  { id: "fechamento", label: "Chamada de venda" },
];

function Editor({ user, proposal, onSave, onClose }) {
  const [p, setP] = useState(JSON.parse(JSON.stringify(proposal)));
  const [tab, setTab] = useState("editar");
  const [aiField, setAiField] = useState(null);
  const [saved, setSaved] = useState(false);
  const printRef = useRef();

  const setContent = (k, v) => setP((s) => ({ ...s, content: { ...s.content, [k]: v } }));
  const setColor = (v) => setP((s) => ({ ...s, data: { ...s.data, provider: { ...s.data.provider, color: v } } }));

  async function runQuick(field, action) {
    setAiField(`${field}:${action}`);
    const cur = p.content[field];
    const out = await quickAI(action, Array.isArray(cur) ? cur.join("\n") : cur);
    if (Array.isArray(cur)) setContent(field, out.split("\n").filter(Boolean));
    else setContent(field, out);
    setAiField(null);
  }

  function save(status) {
    const updated = { ...p, status: status || p.status, updated_at: todayStr(),
      total_value: Number(p.data.commercial.total) || 0 };
    onSave(updated);
    setP(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const watermark = user.plan === "free";

  function exportPDF() {
    const win = window.open("", "_blank");
    if (!win) { alert("Permita pop-ups para exportar o PDF."); return; }
    const html = printRef.current.innerHTML;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      <style>*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      body{font-family:'Plus Jakarta Sans',sans-serif;} @page{margin:0;size:A4;}
      @media print{ .noprint{display:none;} }</style></head>
      <body>${html}
      <div class="noprint" style="position:fixed;bottom:20px;right:20px;display:flex;gap:10px;">
      <button onclick="window.print()" style="padding:12px 22px;background:#0B1F3A;color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:sans-serif;">🖨 Imprimir / Salvar PDF</button></div>
      <script>setTimeout(()=>window.print(),700)</script></body></html>`);
    win.document.close();
  }

  const fields = [
    ["presentation", "Apresentação"], ["understanding", "Entendimento da necessidade"],
    ["objective", "Objetivo"], ["solution", "Solução proposta"], ["scope", "Escopo"],
    ["closing", "Chamada final"],
  ];

  return (
    <div className="pp-anim">
      <div className="pp-noprint" style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(22px,3vw,30px)",
              color: C.ink, fontWeight: 600 }}>{p.title}</h1>
            <Badge color={STATUS[p.status]?.color}>● {STATUS[p.status]?.label}</Badge>
            {p.content._ai && <Badge color={C.ai} bg={C.aiSoft}>✦ Gerada por IA</Badge>}
          </div>
          <p style={{ color: C.mute, fontSize: 14, marginTop: 5 }}>
            Cliente: {p.client_name} • {fmtMoney(p.total_value)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn kind="soft" size="sm" onClick={onClose}>← Painel</Btn>
          <Btn kind="soft" size="sm" onClick={() => save()}>
            {saved ? "✓ Salvo" : "💾 Salvar"}
          </Btn>
          <Btn kind="primary" size="sm" onClick={exportPDF}>⬇ Exportar PDF</Btn>
        </div>
      </div>

      <div className="pp-noprint" style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {[["editar", "✎ Editar conteúdo"], ["preview", "👁 Pré-visualizar"],
          ["share", "📤 Compartilhar"], ["contract", "📜 Contrato"]].map(([id, lb]) => (
          <button key={id} className="pp-btn" onClick={() => setTab(id)} style={{
            padding: "10px 18px", borderRadius: 11, fontSize: 14, fontWeight: 700, transform: "none",
            background: tab === id ? C.ink : "#fff", color: tab === id ? "#fff" : C.mute,
            border: `1px solid ${tab === id ? C.ink : C.line}`,
          }}>{lb}</button>
        ))}
      </div>

      {tab === "editar" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, maxWidth: 820 }}>
          <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
            border: `1px solid ${C.line}`, padding: 22 }}>
            <h3 style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 16 }}>🎨 Aparência</h3>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <Field label="Cor da marca">
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="color" value={p.data.provider.color} onChange={(e) => setColor(e.target.value)}
                    style={{ width: 50, height: 44, borderRadius: 10, border: `1px solid ${C.line}`, cursor: "pointer" }} />
                  <Input value={p.data.provider.color} onChange={(e) => setColor(e.target.value)} style={{ width: 130 }} />
                </div>
              </Field>
              <Field label="Logotipo">
                <LogoUpload value={p.data.provider.logo}
                  onChange={(v) => setP((s) => ({ ...s, data: { ...s.data, provider: { ...s.data.provider, logo: v } } }))} />
              </Field>
            </div>
          </div>

          {fields.map(([fk, fl]) => (
            <div key={fk} className="pp-card" style={{ background: "#fff", borderRadius: 16,
              border: `1px solid ${C.line}`, padding: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontWeight: 800, fontSize: 15.5, color: C.ink }}>{fl}</h3>
              </div>
              <Textarea value={p.content[fk]} onChange={(e) => setContent(fk, e.target.value)}
                style={{ minHeight: 110 }} />
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
                {QUICK.map((q) => {
                  const loading = aiField === `${fk}:${q.id}`;
                  return (
                    <button key={q.id} className="pp-btn" disabled={!!aiField}
                      onClick={() => runQuick(fk, q.id)} style={{
                        padding: "7px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                        background: C.aiSoft, color: C.ai, transform: "none",
                        opacity: aiField && !loading ? .5 : 1,
                        display: "inline-flex", gap: 6, alignItems: "center",
                      }}>
                      {loading ? <Spinner size={12} color={C.ai} /> : "✦"} {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* listas editáveis */}
          {[["deliverables", "Entregáveis"], ["differentials", "Diferenciais"], ["nextSteps", "Próximos passos"]].map(([fk, fl]) => (
            <div key={fk} className="pp-card" style={{ background: "#fff", borderRadius: 16,
              border: `1px solid ${C.line}`, padding: 22 }}>
              <h3 style={{ fontWeight: 800, fontSize: 15.5, color: C.ink, marginBottom: 12 }}>{fl}</h3>
              <Textarea value={(p.content[fk] || []).join("\n")}
                onChange={(e) => setContent(fk, e.target.value.split("\n").filter(Boolean))}
                style={{ minHeight: 100 }} placeholder="Um item por linha" />
            </div>
          ))}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "8px 0 30px" }}>
            <Btn kind="money" onClick={() => save("aprovada")}>✓ Marcar como aprovada</Btn>
            <Btn kind="soft" onClick={() => save("enviada")}>📤 Marcar como enviada</Btn>
            <Btn kind="soft" onClick={() => save("recusada")}>✕ Marcar como recusada</Btn>
          </div>
        </div>
      )}

      {tab === "preview" && (
        <div style={{ background: "#E9EDF3", borderRadius: 18, padding: "clamp(12px,3vw,30px)",
          overflow: "auto" }}>
          <div style={{ maxWidth: 800, margin: "0 auto", boxShadow: "0 30px 70px -30px rgba(11,31,58,.4)",
            borderRadius: 14, overflow: "hidden" }}>
            <ProposalDoc p={{ ...p, _watermark: watermark }} />
          </div>
        </div>
      )}

      {tab === "share" && <ShareTab p={p} user={user} />}
      {tab === "contract" && <ContractTab p={p} />}

      {/* container oculto para impressão */}
      <div style={{ position: "absolute", left: -99999, top: 0 }}>
        <div ref={printRef}><ProposalDoc p={{ ...p, _watermark: watermark }} forPrint /></div>
      </div>
    </div>
  );
}

/* ---------- Aba Compartilhar ---------- */
function ShareTab({ p, user }) {
  const m = p.messages || {};
  const [copied, setCopied] = useState("");
  const [pub, setPub] = useState(p.public_enabled);
  const copy = (txt, id) => {
    navigator.clipboard?.writeText(txt);
    setCopied(id); setTimeout(() => setCopied(""), 1600);
  };
  const link = `https://${p.public_link}`;
  const wpps = [
    ["wppFormal", "Formal"], ["wppDireta", "Direta"],
    ["wppPersuasiva", "Persuasiva"], ["wppAmigavel", "Amigável"],
  ];
  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 24 }}>
        <h3 style={{ fontWeight: 800, fontSize: 16.5, color: C.ink, marginBottom: 6 }}>🔗 Link público</h3>
        <p style={{ color: C.mute, fontSize: 13.5, marginBottom: 16 }}>
          O cliente visualiza a proposta mas não pode editá-la.
        </p>
        <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16,
          fontSize: 14, fontWeight: 600, color: C.ink, cursor: "pointer" }}>
          <input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)}
            style={{ accentColor: C.money, width: 18, height: 18 }} />
          Ativar link público compartilhável
        </label>
        {pub && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input readOnly value={link} style={{ flex: 1, minWidth: 220, background: C.paper }} />
            <Btn kind="primary" size="sm" onClick={() => copy(link, "link")}>
              {copied === "link" ? "✓ Copiado" : "Copiar link"}
            </Btn>
          </div>
        )}
      </div>

      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 24 }}>
        <h3 style={{ fontWeight: 800, fontSize: 16.5, color: C.ink, marginBottom: 16 }}>
          💬 Mensagem para WhatsApp
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {wpps.map(([k, lb]) => m[k] && (
            <div key={k} style={{ background: C.paper, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Badge color={C.money}>{lb}</Badge>
                <Btn kind="soft" size="sm" onClick={() => copy(m[k], k)}>
                  {copied === k ? "✓ Copiado" : "Copiar"}
                </Btn>
              </div>
              <p style={{ fontSize: 13.5, color: "#33425A", lineHeight: 1.6 }}>{m[k]}</p>
            </div>
          ))}
        </div>
        <Btn kind="money" style={{ marginTop: 16, width: "100%" }}
          onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(m.wppPersuasiva || "")}`, "_blank")}>
          Abrir no WhatsApp
        </Btn>
      </div>

      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 24 }}>
        <h3 style={{ fontWeight: 800, fontSize: 16.5, color: C.ink, marginBottom: 16 }}>✉️ E-mail</h3>
        <Field label="Assunto">
          <div style={{ display: "flex", gap: 8 }}>
            <Input readOnly value={m.emailSubject || ""} style={{ flex: 1, background: C.paper }} />
            <Btn kind="soft" size="sm" onClick={() => copy(m.emailSubject, "es")}>
              {copied === "es" ? "✓" : "Copiar"}</Btn>
          </div>
        </Field>
        <Field label="Corpo do e-mail">
          <Textarea readOnly value={m.emailBody || ""} style={{ minHeight: 180, background: C.paper }} />
        </Field>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="soft" size="sm" onClick={() => copy(m.emailBody, "eb")}>
            {copied === "eb" ? "✓ Copiado" : "Copiar corpo"}</Btn>
          <Btn kind="primary" size="sm"
            onClick={() => window.open(`mailto:${p.data.client.email || ""}?subject=${encodeURIComponent(m.emailSubject||"")}&body=${encodeURIComponent(m.emailBody||"")}`)}>
            Abrir no e-mail
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------- Aba Contrato simples ---------- */
function ContractTab({ p }) {
  const d = p.data;
  const isPrem = false;
  const ref = useRef();
  const printContract = () => {
    const w = window.open("", "_blank");
    if (!w) return alert("Permita pop-ups.");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Contrato — ${p.title}</title>
      <style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 30px;line-height:1.8;color:#1a1a1a;}h1{font-size:22px;}h3{margin-top:24px;}@media print{button{display:none;}}</style>
      </head><body>${ref.current.innerHTML}
      <button onclick="window.print()" style="margin-top:30px;padding:12px 22px;background:#0B1F3A;color:#fff;border:none;border-radius:8px;cursor:pointer;">Imprimir / PDF</button></body></html>`);
    w.document.close();
  };
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <h3 style={{ fontWeight: 800, fontSize: 17, color: C.ink }}>📜 Contrato simples</h3>
          <Btn kind="primary" size="sm" onClick={printContract}>⬇ Exportar contrato</Btn>
        </div>
        <div style={{ background: "#FFF7E8", border: "1px solid #F3D98C", borderRadius: 10,
          padding: "12px 16px", fontSize: 13, color: "#92660A", marginBottom: 22 }}>
          ⚠ Este documento é um modelo básico e não substitui a orientação de um advogado.
        </div>
        <div ref={ref} style={{ fontSize: 14, color: "#33425A", lineHeight: 1.8 }}>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, marginBottom: 16 }}>
            Contrato de Prestação de Serviços</h1>
          <p><b>CONTRATADO:</b> {d.provider.name}{d.provider.doc ? `, inscrito sob ${d.provider.doc}` : ""}.</p>
          <p><b>CONTRATANTE:</b> {d.client.name}{d.client.company ? ` — ${d.client.company}` : ""}.</p>
          <h3 style={{ color: C.ink, marginTop: 18 }}>1. Objeto</h3>
          <p>O presente contrato tem por objeto a prestação dos serviços de {p.service_type}: {d.project.title}. {d.project.goal}</p>
          <h3 style={{ color: C.ink, marginTop: 18 }}>2. Valor e pagamento</h3>
          <p>O valor total dos serviços é de {fmtMoney(d.commercial.total)}, pago via {d.commercial.payment}. {d.commercial.installments}. {d.commercial.entry}</p>
          <h3 style={{ color: C.ink, marginTop: 18 }}>3. Prazo</h3>
          <p>Os serviços serão executados no prazo de {d.project.deadline || "a combinar"}, a contar da aprovação e do pagamento inicial.</p>
          <h3 style={{ color: C.ink, marginTop: 18 }}>4. Responsabilidades</h3>
          <p>O CONTRATADO compromete-se a executar os serviços com qualidade profissional. O CONTRATANTE compromete-se a fornecer as informações necessárias e efetuar os pagamentos nas datas acordadas.</p>
          <h3 style={{ color: C.ink, marginTop: 18 }}>5. Cancelamento</h3>
          <p>O cancelamento por qualquer das partes deverá ser comunicado por escrito com antecedência mínima de 7 dias. Valores referentes a serviços já executados não serão reembolsados.</p>
          <h3 style={{ color: C.ink, marginTop: 18 }}>6. Confidencialidade</h3>
          <p>As partes comprometem-se a manter sigilo sobre informações confidenciais a que tiverem acesso durante a execução deste contrato.</p>
          <h3 style={{ color: C.ink, marginTop: 18 }}>7. Foro</h3>
          <p>Fica eleito o foro da comarca do CONTRATADO para dirimir quaisquer questões oriundas deste contrato.</p>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 50, gap: 30 }}>
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 8, fontSize: 13 }}>{d.provider.name}<br/>CONTRATADO</div>
            </div>
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 8, fontSize: 13 }}>{d.client.name}<br/>CONTRATANTE</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Página pública ---------- */
function PublicView({ proposal, go }) {
  if (!proposal) return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.paper }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, color: C.ink }}>Proposta não encontrada</h2>
        <Btn kind="soft" style={{ marginTop: 16 }} onClick={() => go("landing")}>Voltar ao início</Btn>
      </div>
    </div>
  );
  return (
    <div style={{ background: "#E9EDF3", minHeight: "100vh", padding: "clamp(12px,4vw,40px)" }}>
      <div className="pp-noprint" style={{ maxWidth: 820, margin: "0 auto 16px",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Logo size={18} />
        <Btn kind="primary" size="sm" onClick={() => window.print()}>⬇ Baixar PDF</Btn>
      </div>
      <div style={{ maxWidth: 820, margin: "0 auto", borderRadius: 14, overflow: "hidden",
        boxShadow: "0 30px 70px -30px rgba(11,31,58,.4)" }}>
        <ProposalDoc p={proposal} />
      </div>
      <p className="pp-noprint" style={{ textAlign: "center", color: C.mute, fontSize: 12.5, marginTop: 20 }}>
        Proposta gerada com Fechei.IA
      </p>
    </div>
  );
}

/* ---------- Configurações ---------- */
function Settings({ user, onUpdate, go }) {
  const [f, setF] = useState({ ...user });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    AIState.set(f.ai_mode || "auto");
    await onUpdate(f); setSaved(true); setTimeout(() => setSaved(false), 1800);
  };
  return (
    <div className="pp-anim" style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(24px,3vw,32px)",
        color: C.ink, fontWeight: 600, marginBottom: 26 }}>Configurações</h1>

      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 26, marginBottom: 18 }}>
        <h3 style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 18 }}>Dados pessoais</h3>
        <Row>
          <Field label="Nome"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="E-mail"><Input value={f.email} disabled style={{ background: C.paper }} /></Field>
        </Row>
        <Row>
          <Field label="Empresa"><Input value={f.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
          <Field label="Telefone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        </Row>
        <Field label="Site / Instagram"><Input value={f.site || ""} onChange={(e) => set("site", e.target.value)} /></Field>
        <Field label="Descrição do prestador">
          <Textarea value={f.about || ""} onChange={(e) => set("about", e.target.value)} />
        </Field>
      </div>

      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 26, marginBottom: 18 }}>
        <h3 style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 18 }}>Marca</h3>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Field label="Cor da marca">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="color" value={f.brand_color || C.ink} onChange={(e) => set("brand_color", e.target.value)}
                style={{ width: 50, height: 44, borderRadius: 10, border: `1px solid ${C.line}`, cursor: "pointer" }} />
              <Input value={f.brand_color || C.ink} onChange={(e) => set("brand_color", e.target.value)} style={{ width: 130 }} />
            </div>
          </Field>
          <Field label="Logotipo">
            <LogoUpload value={f.logo_url} onChange={(v) => set("logo_url", v)} />
          </Field>
        </div>
      </div>

      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 26, marginBottom: 18 }}>
        <h3 style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 6 }}>
          Geração de texto com IA
        </h3>
        <p style={{ color: C.mute, fontSize: 13.5, marginBottom: 18, lineHeight: 1.6 }}>
          Escolha como o conteúdo das propostas é escrito. Você pode mudar quando quiser.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          {[
            { id: "auto", icon: "✨", title: "Automático (recomendado)",
              desc: "Usa a IA real e, se ela falhar ou estiver offline, gera localmente. Nunca trava." },
            { id: "ia", icon: "🤖", title: "Somente IA real",
              desc: "Força a geração pela IA. Mais criativo e personalizado. Requer conexão." },
            { id: "local", icon: "⚡", title: "Somente modo local",
              desc: "Geração instantânea no seu dispositivo, sem internet. Texto profissional pré-estruturado." },
          ].map((opt) => {
            const active = (f.ai_mode || "auto") === opt.id;
            return (
              <div key={opt.id} onClick={() => set("ai_mode", opt.id)}
                style={{
                  display: "flex", gap: 14, alignItems: "flex-start", cursor: "pointer",
                  padding: 16, borderRadius: 14,
                  border: `2px solid ${active ? C.ai : C.line}`,
                  background: active ? C.aiSoft : "#fff",
                  transition: "all .15s",
                }}>
                <div style={{ fontSize: 22, lineHeight: 1 }}>{opt.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 14.5,
                      color: active ? C.ai : C.ink }}>{opt.title}</span>
                    {active && <Badge color="#fff" bg={C.ai}>Ativo</Badge>}
                  </div>
                  <p style={{ color: C.mute, fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>
                    {opt.desc}
                  </p>
                </div>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  border: `2px solid ${active ? C.ai : C.line}`,
                  background: active ? C.ai : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {active && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pp-card" style={{ background: "#fff", borderRadius: 16,
        border: `1px solid ${C.line}`, padding: 26, marginBottom: 22 }}>
        <h3 style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 14 }}>Plano atual</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Badge color={user.plan === "free" ? C.mute : C.money}>
            {user.plan === "free" ? "Plano Gratuito" : `Plano ${user.plan === "pro" ? "Pro" : "Premium"}`}
          </Badge>
          <Btn kind="money" size="sm" onClick={() => go("plans")}>Ver planos</Btn>
        </div>
      </div>

      <Btn kind="primary" onClick={save}>{saved ? "✓ Salvo com sucesso" : "Salvar alterações"}</Btn>
    </div>
  );
}

/* ---------- Modal de checkout (Stripe / Mercado Pago) ---------- */
function CheckoutModal({ planId, user, onClose, onConfirmed }) {
  const [stage, setStage] = useState("review"); // review | processing | success | error
  const [err, setErr] = useState("");
  const pricing = PLAN_PRICING[planId];
  const planName = planId === "pro" ? "Pro" : "Premium";
  const providerName = PAYMENTS.provider === "stripe" ? "Stripe" : "Mercado Pago";

  async function pay() {
    setStage("processing");
    const sess = await createCheckoutSession(planId, user);
    if (!sess.ok) { setErr(sess.error || "Erro no checkout."); setStage("error"); return; }

    if (sess.url) {
      // PRODUÇÃO: salva o plano pendente e redireciona ao checkout do provedor.
      await DB.set("pp_pending_plan", planId);
      window.location.href = sess.url;
      return;
    }
    // DEMONSTRAÇÃO: simula o processamento e o retorno aprovado.
    await new Promise((r) => setTimeout(r, 1500));
    setStage("success");
    await new Promise((r) => setTimeout(r, 1100));
    onConfirmed(planId);
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(11,31,58,.55)",
      backdropFilter: "blur(4px)", zIndex: 999, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="pp-pop" style={{
        background: "#fff", borderRadius: 22, width: "100%", maxWidth: 440,
        padding: 32, boxShadow: "0 40px 80px -30px rgba(11,31,58,.6)",
      }}>
        {stage === "review" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 600 }}>
                Finalizar assinatura
              </h3>
              <button onClick={onClose} style={{ background: "none", border: "none",
                fontSize: 22, color: C.mute, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ background: C.paper, borderRadius: 14, padding: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: C.mute, fontSize: 14 }}>Plano</span>
                <span style={{ fontWeight: 800, color: C.ink }}>Fechei.IA {planName}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: C.mute, fontSize: 14 }}>Cobrança</span>
                <span style={{ fontWeight: 700, color: C.ink }}>Mensal · renovação automática</span>
              </div>
              <div style={{ height: 1, background: C.line, margin: "12px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: C.ink, fontWeight: 700 }}>Total hoje</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600, color: C.money }}>
                  {pricing.label}<span style={{ fontSize: 14, color: C.mute }}>/mês</span>
                </span>
              </div>
            </div>
            <Btn kind="money" style={{ width: "100%" }} onClick={pay}>
              🔒 Pagar com {providerName}
            </Btn>
            <p style={{ textAlign: "center", color: C.mute, fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
              {PAYMENTS.demoMode
                ? "Modo demonstração — nenhuma cobrança real será feita."
                : `Você será redirecionado para o ambiente seguro do ${providerName}.`}
              <br />Pagamento processado com criptografia. Cancele quando quiser.
            </p>
          </>
        )}
        {stage === "processing" && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <Spinner size={36} color={C.ai} />
            <p style={{ color: C.ink, fontWeight: 700, marginTop: 18 }}>Processando pagamento…</p>
            <p style={{ color: C.mute, fontSize: 13, marginTop: 6 }}>Não feche esta janela.</p>
          </div>
        )}
        {stage === "success" && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ fontSize: 54 }}>✅</div>
            <p style={{ color: C.ink, fontWeight: 800, fontSize: 18, marginTop: 14 }}>
              Pagamento aprovado!
            </p>
            <p style={{ color: C.mute, fontSize: 14, marginTop: 6 }}>
              Seu plano {planName} já está ativo.
            </p>
          </div>
        )}
        {stage === "error" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 48 }}>⚠️</div>
            <p style={{ color: C.ink, fontWeight: 800, marginTop: 12 }}>Não foi possível concluir</p>
            <p style={{ color: C.mute, fontSize: 13.5, marginTop: 6, marginBottom: 20 }}>{err}</p>
            <Btn kind="soft" style={{ width: "100%" }} onClick={() => setStage("review")}>
              Tentar novamente
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Página de planos (dentro do app) ---------- */
function PlansPage({ user, onUpgrade }) {
  const [checkout, setCheckout] = useState(null); // planId em checkout

  function pick(id) {
    if (id === "free" || id === user.plan) { onUpgrade(id); return; }
    setCheckout(id);
  }

  return (
    <div className="pp-anim" style={{ maxWidth: 1080 }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(26px,3.4vw,40px)",
          color: C.ink, fontWeight: 600 }}>Escolha seu plano</h1>
        <p style={{ color: C.mute, fontSize: 16, marginTop: 8 }}>
          Faça upgrade quando precisar de mais. Cancele quando quiser.
        </p>
      </div>
      <PlanCards currentPlan={user.plan} onPick={pick} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        gap: 18, marginTop: 30, flexWrap: "wrap", color: C.mute, fontSize: 13 }}>
        <span>🔒 Pagamento seguro</span>
        <span>💳 {PAYMENTS.provider === "stripe" ? "Stripe" : "Mercado Pago"}</span>
        <span>↩️ Cancele quando quiser</span>
      </div>
      {PAYMENTS.demoMode && (
        <p style={{ textAlign: "center", color: C.mute, fontSize: 12.5, marginTop: 14 }}>
          Estrutura de pagamento real já integrada (Stripe / Mercado Pago).
          Em modo demonstração o upgrade é aplicado sem cobrança.
        </p>
      )}
      {checkout && (
        <CheckoutModal planId={checkout} user={user}
          onClose={() => setCheckout(null)}
          onConfirmed={(id) => { setCheckout(null); onUpgrade(id); }} />
      )}
    </div>
  );
}

/* ---------- Páginas legais ---------- */
function LegalPage({ kind, go }) {
  const isPriv = kind === "privacy";
  return (
    <div style={{ background: C.paper, minHeight: "100vh", padding: "clamp(24px,5vw,60px)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ marginBottom: 30 }}><Logo /></div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, color: C.ink, fontWeight: 600, marginBottom: 20 }}>
          {isPriv ? "Política de Privacidade" : "Termos de Uso"}
        </h1>
        <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${C.line}`,
          padding: 32, color: C.mute, fontSize: 14.5, lineHeight: 1.8 }}>
          {isPriv ? (
            <>
              <p>A Fechei.IA valoriza sua privacidade. Coletamos apenas os dados necessários para criar e gerenciar suas propostas comerciais.</p>
              <p style={{ marginTop: 14 }}>Seus dados de conta e propostas são armazenados de forma segura e acessíveis somente por você. Não vendemos seus dados a terceiros.</p>
              <p style={{ marginTop: 14 }}>O conteúdo gerado por IA é processado para criar suas propostas. Você pode excluir suas propostas a qualquer momento.</p>
            </>
          ) : (
            <>
              <p>Ao usar a Fechei.IA, você concorda em utilizar a plataforma para fins legítimos de criação de propostas comerciais.</p>
              <p style={{ marginTop: 14 }}>O conteúdo gerado por IA é uma sugestão e deve ser revisado por você antes do envio. A plataforma não se responsabiliza por acordos comerciais firmados.</p>
              <p style={{ marginTop: 14 }}>Os modelos de contrato são básicos e não substituem orientação jurídica profissional.</p>
            </>
          )}
        </div>
        <Btn kind="soft" style={{ marginTop: 24 }} onClick={() => go("landing")}>← Voltar</Btn>
      </div>
    </div>
  );
}

/* ============================================================================
   APP — orquestração de estado, rotas e persistência
   ============================================================================ */
export default function App() {
  const [view, setView] = useState("landing");
  const [user, setUser] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [editing, setEditing] = useState(null);   // proposal id em edição
  const [draft, setDraft] = useState(null);        // draft do wizard (duplicação)
  const [publicProp, setPublicProp] = useState(null);
  const [booting, setBooting] = useState(true);

  /* sessão persistida */
  useEffect(() => {
    (async () => {
      // PRODUÇÃO: reidrata o token e busca dados do servidor.
      if (backendOn()) {
        const tok = await DB.get("pp_token", null);
        if (tok) {
          Session.set(tok);
          try {
            const ps = await API.listProposals();
            // /proposals exige token válido; se chegou aqui, a sessão vale.
            const prof = await DB.get("pp_profile", null);
            if (prof) {
              AIState.set(prof.ai_mode || "auto");
              setUser(prof);
              setProposals(ps);
              setView("dashboard");
              const ret = readCheckoutReturn();
              if (ret === "success") {
                try {
                  const st = await apiFetch("/payment/status");
                  if (st && st.plan) {
                    const u2 = { ...prof, plan: st.plan };
                    setUser(u2);
                    await DB.set("pp_profile", u2);
                  }
                } catch {}
              }
            }
          } catch {
            // token expirado → limpa e volta ao login
            Session.set(null);
            await DB.del("pp_token");
          }
        }
        setBooting(false);
        return;
      }

      // DEMO: sessão local via window.storage.
      const sid = await DB.get("pp_session", null);
      if (sid) {
        const users = await DB.get("pp_users", {});
        const found = Object.values(users).find((u) => u.id === sid);
        if (found) {
          AIState.set(found.ai_mode || "auto");
          setUser(found);
          const ps = await DB.get(`pp_proposals_${found.id}`, []);
          setProposals(ps);
          setView("dashboard");
          /* Retorno do checkout do provedor (fluxo de produção). */
          const ret = readCheckoutReturn();
          if (ret === "success") {
            const pend = await DB.get("pp_pending_plan", null);
            if (pend) {
              const u2 = { ...found, plan: pend };
              const all = await DB.get("pp_users", {});
              all[u2.email] = u2;
              await DB.set("pp_users", all);
              await DB.del("pp_pending_plan");
              setUser(u2);
            }
          }
        }
      }
      setBooting(false);
    })();
  }, []);

  const persist = useCallback(async (next, u) => {
    const usr = u || user;
    if (!usr) return;
    setProposals(next);
    if (!backendOn()) await DB.set(`pp_proposals_${usr.id}`, next);
  }, [user]);

  async function handleAuth(u) {
    AIState.set(u.ai_mode || "auto");
    setUser(u);
    if (backendOn()) {
      await DB.set("pp_profile", u);
      try {
        const ps = await API.listProposals();
        setProposals(ps);
      } catch { setProposals([]); }
      setView("dashboard");
      return;
    }
    await DB.set("pp_session", u.id);
    const ps = await DB.get(`pp_proposals_${u.id}`, []);
    setProposals(ps);
    setView("dashboard");
  }

  async function logout() {
    if (backendOn()) {
      await API.logout();
      await DB.del("pp_profile");
    } else {
      await DB.del("pp_session");
    }
    setUser(null); setProposals([]); setEditing(null);
    setView("landing");
  }

  function startCreate() {
    const now = new Date();
    const monthCount = proposals.filter((p) => {
      const dt = new Date(p.created_at);
      return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
    }).length;
    if (PLAN_LIMITS[user.plan] !== Infinity && monthCount >= PLAN_LIMITS[user.plan]) {
      setView("plans");
      return;
    }
    setDraft(null);
    setView("create");
  }

  async function onGenerated(proposal) {
    if (backendOn()) {
      try {
        const saved = await API.createProposal(proposal);
        const next = [saved, ...proposals];
        setProposals(next);
        setEditing(saved.id);
        setView("editor");
        return;
      } catch (e) {
        window.alert(e.message || "Não foi possível salvar a proposta.");
        return;
      }
    }
    const next = [...proposals, proposal];
    await persist(next);
    setEditing(proposal.id);
    setView("editor");
  }

  async function saveProposal(updated) {
    if (backendOn()) {
      try {
        const saved = await API.updateProposal(updated.id, updated);
        setProposals(proposals.map((p) => p.id === updated.id ? saved : p));
        return;
      } catch (e) {
        window.alert(e.message || "Não foi possível salvar.");
        return;
      }
    }
    const next = proposals.map((p) => p.id === updated.id ? updated : p);
    await persist(next);
  }

  async function duplicate(id) {
    const src = proposals.find((p) => p.id === id);
    if (!src) return;
    const base = JSON.parse(JSON.stringify(src));
    if (backendOn()) {
      try {
        const { id: _i, created_at: _c, updated_at: _u, ...rest } = base;
        const saved = await API.createProposal({
          ...rest,
          title: src.title + " (cópia)", status: "rascunho",
          public_link: `fechei.ia/p/${uid()}`, public_enabled: false,
        });
        setProposals([saved, ...proposals]);
        return;
      } catch (e) {
        window.alert(e.message || "Não foi possível duplicar.");
        return;
      }
    }
    const copy = { ...base, id: uid(),
      title: src.title + " (cópia)", status: "rascunho",
      public_link: `fechei.ia/p/${uid()}`, public_enabled: false,
      created_at: todayStr(), updated_at: todayStr() };
    await persist([...proposals, copy]);
  }

  async function remove(id) {
    if (!window.confirm("Excluir esta proposta? Esta ação não pode ser desfeita.")) return;
    if (backendOn()) {
      try {
        await API.deleteProposal(id);
        setProposals(proposals.filter((p) => p.id !== id));
        return;
      } catch (e) {
        window.alert(e.message || "Não foi possível excluir.");
        return;
      }
    }
    await persist(proposals.filter((p) => p.id !== id));
  }

  function exportFromDash(id) {
    setEditing(id);
    setView("editor");
  }

  async function upgrade(planId) {
    const u = { ...user, plan: planId };
    setUser(u);
    if (backendOn()) {
      await DB.set("pp_profile", u);
      setView("dashboard");
      return;
    }
    const users = await DB.get("pp_users", {});
    users[u.email] = u;
    await DB.set("pp_users", users);
    setView("dashboard");
  }

  async function updateUser(f) {
    const u = { ...user, ...f };
    setUser(u);
    if (backendOn()) {
      try {
        const saved = await API.updateProfile(f);
        const merged = { ...u, ...saved };
        setUser(merged);
        await DB.set("pp_profile", merged);
      } catch (e) {
        window.alert(e.message || "Não foi possível salvar o perfil.");
      }
      return;
    }
    const users = await DB.get("pp_users", {});
    users[u.email] = { ...users[u.email], ...u };
    await DB.set("pp_users", users);
  }

  const go = (v) => {
    if (v === "create") return startCreate();
    setView(v);
  };

  if (booting) {
    return (
      <>
        <GlobalStyle />
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.paper }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 18 }}><Logo size={26} /></div>
            <Spinner size={28} color={C.ai} />
          </div>
        </div>
      </>
    );
  }

  /* rotas públicas */
  if (view === "landing")
    return <><GlobalStyle /><Landing go={go} /></>;
  if (view === "login")
    return <><GlobalStyle /><Login go={go} onAuth={handleAuth} /></>;
  if (view === "signup")
    return <><GlobalStyle /><Signup go={go} onAuth={handleAuth} /></>;
  if (view === "recover")
    return <><GlobalStyle /><Recover go={go} /></>;
  if (view === "privacy" || view === "terms")
    return <><GlobalStyle /><LegalPage kind={view} go={go} /></>;
  if (view === "public")
    return <><GlobalStyle /><PublicView proposal={publicProp} go={go} /></>;

  /* rotas autenticadas */
  if (!user)
    return <><GlobalStyle /><Login go={go} onAuth={handleAuth} /></>;

  const editProp = proposals.find((p) => p.id === editing);

  return (
    <>
      <GlobalStyle />
      <AppShell user={user} view={view} go={go} onLogout={logout}>
        {view === "dashboard" && (
          <Dashboard user={user} proposals={proposals} go={go}
            onOpen={(id) => { setEditing(id); setView("editor"); }}
            onDuplicate={duplicate} onDelete={remove} onExport={exportFromDash} />
        )}
        {view === "create" && (
          <Wizard user={user} draft={draft}
            onCancel={() => setView("dashboard")}
            onGenerated={onGenerated} />
        )}
        {view === "editor" && editProp && (
          <Editor user={user} proposal={editProp}
            onSave={saveProposal}
            onClose={() => setView("dashboard")} />
        )}
        {view === "editor" && !editProp && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <p style={{ color: C.mute }}>Proposta não encontrada.</p>
            <Btn kind="soft" style={{ marginTop: 16 }} onClick={() => setView("dashboard")}>Voltar ao painel</Btn>
          </div>
        )}
        {view === "plans" && <PlansPage user={user} onUpgrade={upgrade} />}
        {view === "settings" && <Settings user={user} onUpdate={updateUser} go={go} />}
      </AppShell>
    </>
  );
}
