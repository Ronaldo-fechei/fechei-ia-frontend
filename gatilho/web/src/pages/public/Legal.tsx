import { APP_NAME } from "@gatilho/shared";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Logo } from "../../components/brand/Logo";
import { useSystemStatus } from "../../hooks/useAuth";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-zinc-700">{children}</div>
    </section>
  );
}

function Privacy({ contact }: { contact: ReactNode }) {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-zinc-500">Em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).</p>
      <Section title="1. Quem somos">
        <p>
          O {APP_NAME} é uma plataforma que permite a empresas e criadores automatizar respostas no Instagram por meio das APIs oficiais da Meta. Para
          dúvidas sobre privacidade, fale com {contact}.
        </p>
      </Section>
      <Section title="2. Dados que tratamos">
        <p>
          <strong>Dados da sua conta:</strong> nome, e-mail, senha (armazenada apenas como hash criptográfico), registros de acesso e configurações.
        </p>
        <p>
          <strong>Dados do Instagram conectado:</strong> com a sua autorização via login oficial do Instagram, recebemos o identificador, nome de
          usuário, nome, foto e tipo da conta profissional, além de um token de acesso que guardamos criptografado. Nunca pedimos nem armazenamos sua
          senha do Instagram.
        </p>
        <p>
          <strong>Dados das pessoas que interagem com sua conta:</strong> mensagens do Direct, comentários e interações com Stories enviados à sua conta
          profissional, identificador com escopo do Instagram, nome de usuário, nome e foto públicos e informações que essas pessoas fornecem nas
          conversas (como e-mail ou telefone, quando você configura a captura). Esses dados são tratados em seu nome, para prestar o serviço.
        </p>
        <p>
          <strong>Dados técnicos:</strong> registros de execução das automações, cliques em links rastreados (sem armazenar o endereço IP em texto) e
          métricas agregadas.
        </p>
      </Section>
      <Section title="3. Para que usamos">
        <p>
          Para executar as automações que você configurou, exibir conversas e contatos no painel, gerar métricas, garantir segurança, prevenir abusos,
          cumprir obrigações legais e prestar suporte. Não vendemos dados pessoais e não usamos as conversas dos seus contatos para publicidade.
        </p>
      </Section>
      <Section title="4. Compartilhamento">
        <p>
          Compartilhamos dados apenas com: a Meta (para enviar e receber mensagens pelas APIs oficiais), provedores de infraestrutura (hospedagem, banco
          de dados e envio de e-mails) e, somente quando você usa os recursos de IA, o provedor do modelo de linguagem, que recebe apenas o texto que
          você envia para gerar sugestões.
        </p>
      </Section>
      <Section title="5. Segurança e retenção">
        <p>
          Usamos conexões criptografadas (HTTPS), criptografia dos tokens de acesso, sessões com cookies seguros e controle de acesso por conta. Cada
          usuário acessa somente os próprios dados. Mantemos os dados enquanto sua conta estiver ativa; eventos técnicos de webhook são apagados após 30
          dias.
        </p>
      </Section>
      <Section title="6. Seus direitos">
        <p>
          Você pode acessar, corrigir, exportar (CSV de contatos) e excluir seus dados. A exclusão da conta, em Configurações → Conta, apaga
          definitivamente seus dados e os dos seus contatos. Ao remover o app nas configurações do Instagram, a conta é desconectada; solicitações de
          exclusão feitas pela Meta são atendidas automaticamente e podem ser acompanhadas na página de{" "}
          <Link to="/exclusao-de-dados" className="text-brand-700 underline">
            exclusão de dados
          </Link>
          .
        </p>
      </Section>
    </>
  );
}

function Terms({ contact }: { contact: ReactNode }) {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Termos de Uso</h1>
      <Section title="1. O serviço">
        <p>
          O {APP_NAME} automatiza respostas no Instagram usando exclusivamente as APIs oficiais da Meta. O funcionamento depende da sua conta
          profissional do Instagram, das permissões que você conceder e da disponibilidade das APIs da Meta.
        </p>
      </Section>
      <Section title="2. Suas responsabilidades">
        <p>
          Você é responsável pelo conteúdo das automações, pelos links enviados e pelo cumprimento das Políticas da Plataforma Meta, dos Termos de Uso
          do Instagram e da legislação aplicável (incluindo o Código de Defesa do Consumidor e a LGPD). É proibido usar o serviço para spam, conteúdo
          enganoso, ilegal ou que viole direitos de terceiros.
        </p>
      </Section>
      <Section title="3. Limites da plataforma">
        <p>
          A Meta impõe regras como a janela de 24 horas para mensagens, uma única resposta privada por comentário e limites de envio. O {APP_NAME}
          respeita essas regras e não oferece métodos para contorná-las. Recursos não disponibilizados oficialmente pela Meta não são oferecidos.
        </p>
      </Section>
      <Section title="4. Planos">
        <p>
          Cada plano possui limites de automações, contatos e mensagens. Ao atingir um limite, as automações afetadas deixam de executar até o próximo
          período ou a mudança de plano.
        </p>
      </Section>
      <Section title="5. Disponibilidade e responsabilidade">
        <p>
          Trabalhamos para manter o serviço disponível, mas ele pode sofrer interrupções, inclusive por mudanças nas APIs da Meta. Não nos
          responsabilizamos por perdas decorrentes de indisponibilidade de terceiros.
        </p>
      </Section>
      <Section title="6. Contato">
        <p>Dúvidas sobre estes termos: {contact}.</p>
      </Section>
    </>
  );
}

export default function Legal({ kind }: { kind: "privacy" | "terms" }) {
  const { data } = useSystemStatus();
  const contact = data?.supportEmail ? <a href={`mailto:${data.supportEmail}`} className="text-brand-700 underline">{data.supportEmail}</a> : "o canal de suporte informado no painel";
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link to="/">
        <Logo />
      </Link>
      <article className="mt-10">{kind === "privacy" ? <Privacy contact={contact} /> : <Terms contact={contact} />}</article>
      <p className="mt-12 text-sm text-zinc-400">
        <Link to="/privacidade" className="hover:underline">
          Privacidade
        </Link>{" "}
        ·{" "}
        <Link to="/termos" className="hover:underline">
          Termos
        </Link>
      </p>
    </div>
  );
}
