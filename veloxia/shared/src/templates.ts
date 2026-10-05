/**
 * Biblioteca de modelos prontos. Cada modelo gera um fluxo em rascunho que o
 * usuário revisa antes de publicar. URLs ficam em branco de propósito: a
 * validação obriga o preenchimento antes da publicação.
 *
 * Referências a tags usam o prefixo "name:" (ex.: "name:Lead") e são
 * resolvidas pelo servidor para o ID real da tag ao usar o modelo.
 */
import type { Channel } from "./channels";
import { triggerDataSchema, type Flow, type FlowEdge, type FlowNode, type NodeDataMap, type NodeType, type TriggerEvent } from "./flow";

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  triggerEvent: TriggerEvent;
  /** Canais usados pelo modelo (para destacar os que exigem WhatsApp conectado). */
  channels: Channel[];
  /** Nome sugerido para a automação criada. */
  automationName: string;
  highlights: string[];
  build: () => Flow;
}

class FlowBuilder {
  nodes: FlowNode[] = [];
  edges: FlowEdge[] = [];
  private row = 0;

  /** Adiciona um bloco; sem `row`, ocupa a próxima linha da coluna principal. */
  node<T extends NodeType>(id: string, type: T, data: Partial<NodeDataMap[T]>, column = 0, row?: number): string {
    const y = row ?? this.row;
    this.nodes.push({ id, type, data: data as NodeDataMap[T], position: { x: column * 300, y: y * 190 } } as FlowNode);
    if (row === undefined) this.row += 1;
    return id;
  }

  link(source: string, target: string, handle = "out"): this {
    this.edges.push({ id: `e-${source}-${handle}-${target}`, source, sourceHandle: handle, target });
    return this;
  }

  flow(): Flow {
    return { version: 1, nodes: this.nodes, edges: this.edges };
  }
}

const kw = (...words: string[]): NodeDataMap["keyword"]["keywords"] =>
  words.map((text) => ({ text, matchType: "contains_word" as const, caseSensitive: false, ignoreAccents: true }));

const trigger = (event: TriggerEvent, extra: Partial<NodeDataMap["trigger"]> = {}) => triggerDataSchema.parse({ event, ...extra });

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: "envio-de-link",
    name: "Envio de link",
    description: "Quando alguém pedir o link, responde na hora com um botão para o produto.",
    category: "Envio de link",
    triggerEvent: "dm",
    channels: ["instagram"],
    automationName: "Link do produto",
    highlights: ["Palavras: LINK, QUERO, ONDE COMPRAR", "Mensagem + botão com link rastreado"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm"));
      const k = b.node("keywords", "keyword", { keywords: kw("link", "quero", "onde comprar", "me passa o link") });
      const l = b.node("link", "link", {
        text: "Claro, {{primeiro_nome|tudo bem}}! 😊 Aqui está o link para você conferir o produto 👇",
        buttonTitle: "Ver produto",
        url: "",
        track: true,
      });
      const e = b.node("end", "end", {});
      b.link(t, k).link(k, l).link(l, e);
      return b.flow();
    },
  },
  {
    id: "faq",
    name: "FAQ — Perguntas frequentes",
    description: "Responde dúvidas comuns (entrega, prazo, pagamento) com caminhos diferentes por palavra-chave.",
    category: "FAQ",
    triggerEvent: "dm",
    channels: ["instagram"],
    automationName: "Perguntas frequentes",
    highlights: ["Um caminho por assunto", "Entrega, pagamento e prazo"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm"), 1, 0);
      const k1 = b.node("kw-entrega", "keyword", { keywords: kw("entrega", "entregam", "frete") }, 0, 1);
      const m1 = b.node("msg-entrega", "message", {
        text: "Sim! A entrega depende da loja e da sua região. Você pode conferir as condições diretamente no link do produto. 🚚",
      }, 0, 2);
      const k2 = b.node("kw-pagamento", "keyword", { keywords: kw("pagamento", "pix", "parcela", "cartão") }, 1, 1);
      const m2 = b.node("msg-pagamento", "message", {
        text: "Aceitamos Pix e cartão de crédito. As condições de parcelamento aparecem no checkout. 💳",
      }, 1, 2);
      const k3 = b.node("kw-prazo", "keyword", { keywords: kw("prazo", "demora", "quando chega") }, 2, 1);
      const m3 = b.node("msg-prazo", "message", {
        text: "O prazo varia conforme o seu CEP e aparece antes de finalizar a compra. 📦",
      }, 2, 2);
      b.link(t, k1).link(t, k2).link(t, k3).link(k1, m1).link(k2, m2).link(k3, m3);
      return b.flow();
    },
  },
  {
    id: "produto",
    name: "Produto",
    description: "Apresenta um produto com imagem, descrição e botão de compra.",
    category: "Produto",
    triggerEvent: "dm",
    channels: ["instagram"],
    automationName: "Apresentação do produto",
    highlights: ["Imagem do produto", "Espera de 3s para parecer natural", "Botão de compra"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm"));
      const k = b.node("keywords", "keyword", { keywords: kw("produto", "preço", "valor", "quanto custa") });
      const m = b.node("intro", "message", { text: "Oi, {{primeiro_nome|tudo bem}}! Já vou te mostrar o produto 😊" });
      const d = b.node("wait", "delay", { seconds: 3 });
      const i = b.node("image", "image", { url: "" });
      const l = b.node("link", "link", { text: "Confira todos os detalhes e o preço atualizado aqui 👇", buttonTitle: "Comprar agora", url: "", track: true });
      b.link(t, k).link(k, m).link(m, d).link(d, i).link(i, l);
      return b.flow();
    },
  },
  {
    id: "promocao",
    name: "Promoção",
    description: "Envia um cupom e o link da promoção para quem pedir.",
    category: "Promoção",
    triggerEvent: "dm",
    channels: ["instagram"],
    automationName: "Promoção da semana",
    highlights: ["Palavras: PROMO, CUPOM, DESCONTO", "Marca o contato com a tag Interessado"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm"));
      const k = b.node("keywords", "keyword", { keywords: kw("promo", "promoção", "cupom", "desconto") });
      const tag = b.node("tag", "add_tag", { tagId: "name:Interessado" });
      const m = b.node("cupom", "message", { text: "🎉 Use o cupom SEU-CUPOM e garanta seu desconto!" });
      const l = b.node("link", "link", { text: "A promoção é por tempo limitado. Aproveite 👇", buttonTitle: "Ver promoção", url: "", track: true });
      b.link(t, k).link(k, tag).link(tag, m).link(m, l);
      return b.flow();
    },
  },
  {
    id: "captura-de-lead",
    name: "Captura de lead",
    description: "Pergunta se a pessoa quer o catálogo e salva o e-mail no contato.",
    category: "Captura de lead",
    triggerEvent: "dm",
    channels: ["instagram"],
    automationName: "Catálogo por e-mail",
    highlights: ["Botões SIM / NÃO", "Salva o e-mail no campo do contato", "Tag Lead"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm"));
      const k = b.node("keywords", "keyword", { keywords: kw("catálogo", "novidades") });
      const q = b.node("ask", "buttons", {
        text: "Quer receber o nosso catálogo? 📚",
        buttons: [
          { id: "sim", title: "SIM", kind: "reply" },
          { id: "nao", title: "NÃO", kind: "reply" },
        ],
      });
      const c = b.node("email", "capture", {
        question: "Perfeito! Qual é o seu melhor e-mail?",
        fieldKey: "email",
        validation: "email",
        retryMessage: "Hmm, esse e-mail não parece válido. Pode enviar novamente?",
        maxAttempts: 2,
      }, 0);
      const tag = b.node("tag", "add_tag", { tagId: "name:Lead" }, 0);
      const ok = b.node("thanks", "message", { text: "Obrigado! Em breve você recebe o catálogo no e-mail {{email}} 💌" }, 0);
      const no = b.node("no", "message", { text: "Tudo bem! Se mudar de ideia, é só me chamar. 😉" }, 1.2, 3);
      const fail = b.node("fail", "handoff", { message: "Vou chamar alguém da equipe para te ajudar por aqui. 🙋" }, 1.2, 4);
      b.link(t, k).link(k, q).link(q, c, "btn:sim").link(q, no, "btn:nao").link(c, tag, "captured").link(c, fail, "failed").link(tag, ok);
      return b.flow();
    },
  },
  {
    id: "atendimento",
    name: "Atendimento",
    description: "Encaminha para um atendente humano quando a pessoa pede ajuda.",
    category: "Atendimento",
    triggerEvent: "dm",
    channels: ["instagram"],
    automationName: "Falar com atendente",
    highlights: ["Pausa as automações do contato", "Notifica a equipe na Caixa de entrada"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm"));
      const k = b.node("keywords", "keyword", { keywords: kw("atendente", "humano", "ajuda", "falar com alguém") });
      const h = b.node("handoff", "handoff", { message: "Certo! Já avisei nossa equipe. Em breve alguém responde por aqui. 🙋" });
      b.link(t, k).link(k, h);
      return b.flow();
    },
  },
  {
    id: "comentario-dm",
    name: "Comentário → DM",
    description: '"Comente LINK para receber" — envia o link no Direct de quem comentar.',
    category: "Comentário → DM",
    triggerEvent: "comment",
    channels: ["instagram"],
    automationName: "Comentou LINK, recebeu no Direct",
    highlights: ["Resposta privada oficial", "Resposta pública opcional no comentário", "Botão com link rastreado"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node(
        "trigger",
        "trigger",
        trigger("comment", { publicReplyEnabled: true, publicReplies: ["Te enviei no Direct! 📩", "Acabei de te mandar no Direct 😉"] }),
      );
      const k = b.node("keywords", "keyword", { keywords: kw("link", "quero", "eu quero") });
      const l = b.node("link", "link", {
        text: "Oi! 😊 Vi que você pediu o link. Aqui está:",
        buttonTitle: "Ver produto",
        url: "",
        track: true,
      });
      b.link(t, k).link(k, l);
      return b.flow();
    },
  },
  {
    id: "story-dm",
    name: "Story → DM",
    description: "Quando alguém responder ao seu Story, envia uma mensagem com link.",
    category: "Story → DM",
    triggerEvent: "story_reply",
    channels: ["instagram"],
    automationName: "Resposta ao Story",
    highlights: ["Responde a qualquer resposta de Story", "Envia link rastreado", "Tag Interessado"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("story_reply"));
      const tag = b.node("tag", "add_tag", { tagId: "name:Interessado" });
      const l = b.node("link", "link", {
        text: "Que bom que você curtiu o Story! 💜 Aqui está o link que mostrei:",
        buttonTitle: "Abrir link",
        url: "",
        track: true,
      });
      b.link(t, tag).link(tag, l);
      return b.flow();
    },
  },
  {
    id: "mencao-story",
    name: "Agradecer menção em Story",
    description: "Agradece automaticamente quem mencionar sua conta em um Story.",
    category: "Story → DM",
    triggerEvent: "story_mention",
    channels: ["instagram"],
    automationName: "Obrigado pela menção",
    highlights: ["Gatilho de menção oficial", "Mensagem personalizada com o nome"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("story_mention"));
      const m = b.node("thanks", "message", { text: "Muito obrigado pela menção, {{primeiro_nome|tudo bem}}! ❤️ Ficamos muito felizes." });
      b.link(t, m);
      return b.flow();
    },
  },
  {
    id: "atendimento-instagram-whatsapp",
    name: "Atendimento no Instagram e no WhatsApp",
    description: "A mesma automação responde preço, entrega e atendente nos dois canais.",
    category: "Instagram + WhatsApp",
    triggerEvent: "dm",
    channels: ["instagram", "whatsapp"],
    automationName: "Atendimento Instagram + WhatsApp",
    highlights: ["Uma automação para os dois canais", "Botões de resposta", "Encaminha para atendente"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm", { channels: ["instagram", "whatsapp"] }), 1, 0);
      const k = b.node("keywords", "keyword", { keywords: kw("oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "menu") }, 1, 1);
      const menu = b.node(
        "menu",
        "buttons",
        {
          text: "Oi, {{primeiro_nome|tudo bem}}! 👋 Sou o assistente da {{conta|nossa loja}}. Como posso ajudar?",
          buttons: [
            { id: "preco", title: "Preços", kind: "reply" },
            { id: "entrega", title: "Entrega", kind: "reply" },
            { id: "atendente", title: "Falar com atendente", kind: "reply" },
          ],
        },
        1,
        2,
      );
      const preco = b.node("preco", "message", { text: "Nossos preços estão no catálogo atualizado: (cole aqui o link do seu catálogo)" }, 0, 3);
      const entrega = b.node("entrega", "message", { text: "Entregamos para todo o Brasil 🚚 O prazo aparece no carrinho conforme o seu CEP." }, 1, 3);
      const humano = b.node("humano", "handoff", { message: "Certo! Já chamei alguém da equipe para continuar por aqui. 🙋" }, 2, 3);
      b.link(t, k).link(k, menu).link(menu, preco, "btn:preco").link(menu, entrega, "btn:entrega").link(menu, humano, "btn:atendente");
      return b.flow();
    },
  },
  {
    id: "instagram-para-whatsapp",
    name: "Instagram → WhatsApp",
    description: "Quem pedir atendimento no Direct recebe um botão que abre a conversa no seu WhatsApp.",
    category: "Instagram + WhatsApp",
    triggerEvent: "dm",
    channels: ["instagram"],
    automationName: "Levar para o WhatsApp",
    highlights: ["Botão que abre o seu WhatsApp", "Mensagem já digitada para o cliente", "Clique rastreado"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm"));
      const k = b.node("keywords", "keyword", { keywords: kw("whatsapp", "zap", "orçamento", "orcamento", "atendimento") });
      const w = b.node("wa", "whatsapp_handoff", {
        text: "Vamos continuar pelo WhatsApp? É só tocar no botão abaixo 👇",
        buttonTitle: "Abrir WhatsApp",
        prefill: "Olá! Vim pelo Instagram e quero um orçamento 👋",
        accountId: "",
      });
      b.link(t, k).link(k, w);
      return b.flow();
    },
  },
  {
    id: "sequencia-whatsapp",
    name: "Sequência de acompanhamento (WhatsApp)",
    description: "Responde na hora e, se a pessoa não comprar, retoma o contato no dia seguinte com um modelo aprovado.",
    category: "Sequências",
    triggerEvent: "dm",
    channels: ["whatsapp"],
    automationName: "Acompanhamento em 1 dia",
    highlights: ["Resposta imediata", "Espera de 1 dia", "Modelo aprovado pela Meta para retomar a conversa"],
    build: () => {
      const b = new FlowBuilder();
      const t = b.node("trigger", "trigger", trigger("dm", { channels: ["whatsapp"] }));
      const k = b.node("keywords", "keyword", { keywords: kw("preço", "valor", "quanto custa") });
      const m = b.node("resposta", "link", {
        text: "Oi, {{primeiro_nome|tudo bem}}! 😊 Os valores estão aqui:",
        buttonTitle: "Ver preços",
        url: "",
        track: true,
      });
      const tag = b.node("tag", "add_tag", { tagId: "name:Interessado" });
      const d = b.node("espera", "delay", { seconds: 86400 });
      const tpl = b.node("modelo", "whatsapp_template", { templateName: "", language: "pt_BR", bodyParams: [] });
      b.link(t, k).link(k, m).link(m, tag).link(tag, d).link(d, tpl);
      return b.flow();
    },
  },
];

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
