import { Check, CircleCheck, CircleX, Copy, Mail } from "lucide-react";
import { useState, type ReactNode } from "react";
import { APP_NAME } from "@veloxia/shared";
import { Button, Callout, Card, CardTitle, Input, PageHeader, Skeleton } from "../../components/ui";
import { useSystemStatus } from "../../hooks/useAuth";
import { cn } from "../../lib/cn";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-zinc-600">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          variant="secondary"
          size="md"
          aria-label={`Copiar ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* sem permissão de área de transferência */
            }
          }}
        >
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

function Check2({ ok, label, hint }: { ok: boolean; label: string; hint?: ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm">
      {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-red-500" />}
      <div>
        <p className={cn("font-medium", !ok && "text-zinc-800")}>{label}</p>
        {hint && !ok && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
    </li>
  );
}

/** Guia técnico de configuração do app da Meta (para quem administra o servidor). */
export function SetupGuide() {
  const { data, isLoading } = useSystemStatus();
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const s = data.setup;
  if (!s) return null;
  return (
    <Card>
      <CardTitle title="Configuração técnica (administrador do servidor)" description="O que precisa estar configurado para a integração oficial funcionar." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <ul className="space-y-2.5">
            <Check2 ok={s.meta.appConfigured} label="App da Meta configurado" hint="Defina INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET (Instagram → Configuração da API com login do Instagram)." />
            <Check2 ok={s.meta.webhookConfigured} label="Webhook configurado" hint="Defina META_WEBHOOK_VERIFY_TOKEN e cadastre a URL de callback abaixo no painel da Meta." />
            <Check2 ok={s.meta.httpsOk} label="Endereço público com HTTPS" hint="A Meta exige HTTPS. Defina APP_URL com o domínio público (https://…)." />
            <Check2 ok={s.email.configured} label="E-mail (recuperação de senha)" hint="Defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM." />
            <Check2 ok={s.ai.configured} label="IA (opcional)" hint="Defina ANTHROPIC_API_KEY para habilitar a geração de automações com IA." />
          </ul>
          <div className="mt-5 space-y-2 text-sm text-zinc-600">
            <p className="font-medium text-zinc-800">Passo a passo no painel da Meta (developers.facebook.com):</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Crie um app do tipo “Empresa” e adicione o produto <strong>Instagram</strong>.</li>
              <li>Em “Configuração da API com login do Instagram”, copie o ID e a chave secreta do app do Instagram.</li>
              <li>Em “Configurar login comercial do Instagram”, cadastre a URL de redirecionamento abaixo.</li>
              <li>
                Em “Configurar webhooks”, cadastre a URL de callback e o token de verificação; assine os campos: <code>{s.meta.webhookFields.join(", ")}</code>.
              </li>
              <li>Cadastre as URLs de política de privacidade, desautorização e exclusão de dados.</li>
              <li>
                Em modo de desenvolvimento, só contas com função no app (testadores do Instagram) conseguem conectar. Para o público, solicite a Análise do
                App com as permissões: <code>{s.meta.scopes.join(", ")}</code>.
              </li>
            </ol>
            <p className="text-xs text-zinc-500">Versão da Graph API em uso: {s.meta.graphApiVersion}.</p>
          </div>
        </div>
        <div className="space-y-3">
          <CopyField label="URL de redirecionamento do OAuth" value={s.meta.oauthRedirectUrl} />
          <CopyField label="URL de callback do webhook" value={s.meta.webhookUrl} />
          <CopyField label="URL de desautorização" value={s.meta.deauthorizeUrl} />
          <CopyField label="URL de exclusão de dados" value={s.meta.dataDeletionUrl} />
          <CopyField label="Política de privacidade" value={s.meta.privacyPolicyUrl} />
          <CopyField label="Termos de uso" value={s.meta.termsUrl} />
        </div>
      </div>
    </Card>
  );
}

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Por que a automação não respondeu?",
    a: "Confira em Automações → Logs: lá aparece o motivo (fora da janela de 24h, intervalo de repetição, atendimento humano ativo, limite do plano…). Verifique também se a automação está ATIVA e se a palavra-chave corresponde (use o botão “Testar”).",
  },
  {
    q: "O que é a janela de 24 horas?",
    a: "Pela regra da Meta, você só pode enviar mensagens até 24 horas depois da última mensagem da pessoa. Por isso, esperas longas nos fluxos são limitadas e mensagens fora da janela não são enviadas.",
  },
  {
    q: "Como funciona o Comentário → Direct?",
    a: "Quando alguém comenta, enviamos uma resposta privada oficial (uma por comentário, até 7 dias). As próximas mensagens só podem ser enviadas depois que a pessoa responder — por isso use botões de resposta para continuar a conversa.",
  },
  {
    q: "Dá para responder quem começa a me seguir?",
    a: "Não. A API oficial do Instagram não envia eventos de novos seguidores, e nós não usamos métodos não oficiais. O gatilho fica indisponível até a Meta oferecer o evento.",
  },
  {
    q: "Como pauso as automações para uma pessoa?",
    a: "Na Caixa de entrada, clique em “Assumir conversa”. As automações ficam pausadas para esse contato até você clicar em “Retomar automação”.",
  },
  {
    q: "Vocês guardam minha senha do Instagram?",
    a: `Não. O ${APP_NAME} usa somente o login oficial do Instagram. Guardamos apenas o token de acesso, criptografado.`,
  },
];

export default function HelpPage() {
  const { data } = useSystemStatus();
  return (
    <div className="space-y-6">
      <PageHeader title="Ajuda" description="Tudo para colocar seu robô no ar e entender as regras do Instagram." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle title="Comece aqui" />
          <ol className="space-y-4">
            {[
              ["Conecte o Instagram", "Menu Instagram → Conectar. Use uma conta profissional e ative “Permitir acesso às mensagens” no app."],
              ["Crie uma automação", "Automações → Nova automação. Escolha as palavras-chave e escreva a resposta."],
              ["Teste", "Use “Testar automação” para ver qual palavra é detectada e o que será enviado."],
              ["Publique", "Clique em Publicar. A partir daí, cada mensagem com a palavra-chave recebe a resposta."],
              ["Acompanhe", "Veja conversas na Caixa de entrada, contatos no CRM e resultados em Analytics."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{i + 1}</span>
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="text-sm text-zinc-500">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardTitle title="Requisitos do Instagram" />
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-600">
            <li>Conta profissional (Comercial ou Criador de conteúdo).</li>
            <li>“Permitir acesso às mensagens” ativado em Configurações → Mensagens e respostas aos stories → Ferramentas conectadas.</li>
            <li>Enquanto o app estiver em modo de desenvolvimento na Meta, apenas contas adicionadas como testadoras conseguem conectar.</li>
          </ul>
          {data?.supportEmail && (
            <a href={`mailto:${data.supportEmail}`} className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
              <Mail className="size-4" /> {data.supportEmail}
            </a>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle title="Perguntas frequentes" />
        <div className="divide-y divide-zinc-100">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-3">
              <summary className="cursor-pointer list-none font-medium text-zinc-900 select-none">
                <span className="mr-2 inline-block text-brand-600 transition-transform group-open:rotate-90">›</span>
                {f.q}
              </summary>
              <p className="mt-2 pl-5 text-sm leading-relaxed text-zinc-600">{f.a}</p>
            </details>
          ))}
        </div>
      </Card>

      <Callout tone="info" title="Regras da plataforma que respeitamos">
        Janela de 24h para mensagens · 1 resposta privada por comentário (até 7 dias) · limites de envio da Meta · sem automação por senha, navegador ou
        métodos não oficiais.
      </Callout>

      <SetupGuide />
    </div>
  );
}
