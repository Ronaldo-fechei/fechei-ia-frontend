import {
  CircleStop,
  Clock,
  GitBranch,
  FileCheck2,
  Headphones,
  Send,
  Image,
  KeyRound,
  Link2,
  ListChecks,
  MessageSquare,
  MousePointerClick,
  Tag,
  Tags,
  Video,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import type { NodeType } from "@veloxia/shared";

export const NODE_STYLE: Record<NodeType, { icon: ReactNode; color: string; bg: string }> = {
  trigger: { icon: <Zap />, color: "text-brand-700", bg: "bg-brand-100" },
  keyword: { icon: <KeyRound />, color: "text-amber-700", bg: "bg-amber-100" },
  message: { icon: <MessageSquare />, color: "text-sky-700", bg: "bg-sky-100" },
  image: { icon: <Image />, color: "text-sky-700", bg: "bg-sky-100" },
  video: { icon: <Video />, color: "text-sky-700", bg: "bg-sky-100" },
  link: { icon: <Link2 />, color: "text-sky-700", bg: "bg-sky-100" },
  buttons: { icon: <MousePointerClick />, color: "text-sky-700", bg: "bg-sky-100" },
  condition: { icon: <GitBranch />, color: "text-violet-700", bg: "bg-violet-100" },
  delay: { icon: <Clock />, color: "text-violet-700", bg: "bg-violet-100" },
  add_tag: { icon: <Tag />, color: "text-emerald-700", bg: "bg-emerald-100" },
  remove_tag: { icon: <Tags />, color: "text-emerald-700", bg: "bg-emerald-100" },
  capture: { icon: <ListChecks />, color: "text-emerald-700", bg: "bg-emerald-100" },
  whatsapp_template: { icon: <FileCheck2 />, color: "text-emerald-700", bg: "bg-emerald-100" },
  whatsapp_handoff: { icon: <Send />, color: "text-emerald-700", bg: "bg-emerald-100" },
  handoff: { icon: <Headphones />, color: "text-zinc-700", bg: "bg-zinc-200" },
  end: { icon: <CircleStop />, color: "text-zinc-700", bg: "bg-zinc-200" },
};

export const PALETTE_GROUPS: { title: string; types: NodeType[] }[] = [
  { title: "Início", types: ["keyword"] },
  { title: "Mensagens", types: ["message", "image", "video", "link", "buttons"] },
  { title: "Lógica", types: ["condition", "delay"] },
  { title: "Contato", types: ["add_tag", "remove_tag", "capture"] },
  { title: "Canais", types: ["whatsapp_template", "whatsapp_handoff"] },
  { title: "Fim", types: ["handoff", "end"] },
];
