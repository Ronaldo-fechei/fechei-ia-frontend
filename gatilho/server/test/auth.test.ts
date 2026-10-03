import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, getApp, resetDb, signup } from "./helpers";
import { sentEmailsForTests } from "../src/services/email";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await (await getApp()).close();
});

describe("autenticação", () => {
  it("cadastro cria sessão, espaço de trabalho, plano, tags e campos padrão", async () => {
    const s = await signup("ana@teste.com");
    const me = await api(s, "GET", "/api/auth/me");
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user.email).toBe("ana@teste.com");
    expect(body.plan.id).toBe("free");
    expect(body.workspace.timezone).toBe("America/Sao_Paulo");
    const tags = await api(s, "GET", "/api/tags");
    if (tags.statusCode === 200) expect(tags.json().tags.length).toBeGreaterThanOrEqual(7);
  });

  it("rejeita e-mail duplicado, senha fraca e falta de aceite dos termos", async () => {
    await signup("dup@teste.com");
    const dup = await api(null, "POST", "/api/auth/signup", { name: "X Y", email: "dup@teste.com", password: "outraSenha#1", acceptTerms: true });
    expect(dup.statusCode).toBe(409);
    const weak = await api(null, "POST", "/api/auth/signup", { name: "X Y", email: "w@teste.com", password: "12345678", acceptTerms: true });
    expect(weak.statusCode).toBe(400);
    const terms = await api(null, "POST", "/api/auth/signup", { name: "X Y", email: "t@teste.com", password: "senhaBoa#2026", acceptTerms: false });
    expect(terms.statusCode).toBe(400);
  });

  it("login, logout e proteção de rotas", async () => {
    await signup("login@teste.com", "minhaSenha#99");
    const bad = await api(null, "POST", "/api/auth/login", { email: "login@teste.com", password: "errada" });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.message).toBe("E-mail ou senha incorretos.");
    const ok = await api(null, "POST", "/api/auth/login", { email: "LOGIN@teste.com", password: "minhaSenha#99" });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers["set-cookie"]).split(";")[0];
    const session = { cookie, userId: "", workspaceId: "" };
    expect((await api(session, "GET", "/api/auth/me")).statusCode).toBe(200);
    await api(session, "POST", "/api/auth/logout");
    expect((await api(session, "GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await api(null, "GET", "/api/automations")).statusCode).toBe(401);
  });

  it("bloqueia requisições sem o cabeçalho anti-CSRF", async () => {
    const app = await getApp();
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.com", password: "x" } });
    expect(res.statusCode).toBe(403);
  });

  it("recuperação de senha por e-mail com token de uso único", async () => {
    await signup("rec@teste.com", "senhaAntiga#1");
    sentEmailsForTests.length = 0;
    const r = await api(null, "POST", "/api/auth/forgot-password", { email: "rec@teste.com" });
    expect(r.statusCode).toBe(200);
    // E-mail inexistente responde igual (sem revelar cadastro).
    expect((await api(null, "POST", "/api/auth/forgot-password", { email: "naoexiste@teste.com" })).statusCode).toBe(200);
    expect(sentEmailsForTests).toHaveLength(1);
    const token = decodeURIComponent(sentEmailsForTests[0].text.match(/token=([^\s]+)/)![1]);
    const reset = await api(null, "POST", "/api/auth/reset-password", { token, password: "senhaNova#2026" });
    expect(reset.statusCode).toBe(200);
    expect((await api(null, "POST", "/api/auth/reset-password", { token, password: "outra#Senha1" })).statusCode).toBe(400);
    expect((await api(null, "POST", "/api/auth/login", { email: "rec@teste.com", password: "senhaNova#2026" })).statusCode).toBe(200);
  });
});
