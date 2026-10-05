import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "SenhaForte#2026";

// Erros do navegador aparecem no relatório quando um teste falha.
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ""}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
  browserErrors.set(page, errors);
});
test.afterEach(({ page }, info) => {
  const errors = browserErrors.get(page) ?? [];
  if (info.status !== info.expectedStatus && errors.length) console.log(`Erros do navegador:\n${errors.join("\n")}`);
});
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.com.br`;

async function signup(page: Page, email: string) {
  await page.goto("/cadastro");
  await page.fill("#name", "Ana Teste");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL("**/onboarding");
}

test("página inicial e páginas legais", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("100% API oficial da Meta")).toBeVisible();
  await page.getByRole("link", { name: "Privacidade" }).click();
  await expect(page).toHaveURL(/\/privacidade$/);
  await page.goto("/rota-que-nao-existe");
  await expect(page.getByText(/não encontrada/i).first()).toBeVisible();
});

test("área logada exige login", async ({ page }) => {
  await page.goto("/app/automacoes");
  await expect(page).toHaveURL(/\/login/);
});

test("cadastro → automação rascunho → simulador → sair e entrar de novo", async ({ page }) => {
  const email = uniqueEmail();
  await signup(page, email);

  await page.getByRole("button", { name: "Pular e ir para o painel" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Criação rápida: palavra-chave + resposta com link (salva como rascunho; publicar exige Instagram conectado).
  await page.goto("/app/automacoes/nova");
  await page.getByPlaceholder("Link do produto").fill("Link da loja");
  const keyword = page.getByPlaceholder("Digite uma palavra e pressione Enter");
  await keyword.fill("link");
  await keyword.press("Enter");
  await page.getByPlaceholder("Claro! 😊").fill("Oi {{primeiro_nome|tudo bem}}! Aqui está o link 👇");
  await page.getByPlaceholder("https://", { exact: true }).fill("https://exemplo.com.br/produto");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page).toHaveURL(/\/app\/automacoes\/[0-9a-f-]{36}$/);

  // O simulador roda o mesmo motor de produção, sem enviar nada ao Instagram.
  const input = page.getByLabel("Mensagem de teste");
  await input.fill("me manda o LINK por favor");
  const simulated = page.waitForResponse((r) => r.url().endsWith("/test") && r.request().method() === "POST");
  await input.press("Enter");
  const response = await simulated;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByText("Palavra detectada: LINK")).toBeVisible();
  await expect(page.getByText("Fluxo concluído.")).toBeVisible();

  await input.fill("bom dia");
  await input.press("Enter");
  await expect(page.getByText("Nenhuma automação respondeu")).toBeVisible();

  await page.goto("/app/automacoes");
  await expect(page.getByText("Link da loja")).toBeVisible();

  // Sessão: sem cookie volta para o login; entrar de novo leva ao painel.
  await page.context().clearCookies();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/app/);
});

test("senha errada mostra erro amigável", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", uniqueEmail());
  await page.fill("#password", "senha-incorreta-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/e-mail ou senha/i).first()).toBeVisible();
});
