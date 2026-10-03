import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BookOpen,
  ChartColumn,
  ChevronDown,
  Contact,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Menu as MenuIcon,
  MessagesSquare,
  Settings,
  Shield,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/format";
import type { InstagramAccount, NotificationItem } from "../../lib/types";
import { useLiveEvents } from "../../lib/useLiveEvents";
import { useAuth, useMe } from "../../hooks/useAuth";
import { InstagramGlyph, Logo } from "../brand/Logo";
import { Avatar, Badge, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  children?: { to: string; label: string; end?: boolean }[];
}

const NAV: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: <LayoutDashboard />, end: true },
  {
    to: "/app/automacoes",
    label: "Automações",
    icon: <Zap />,
    children: [
      { to: "/app/automacoes", label: "Minhas automações", end: true },
      { to: "/app/automacoes/respostas", label: "Respostas automáticas" },
      { to: "/app/automacoes/comentarios", label: "Comentários → DM" },
      { to: "/app/automacoes/stories", label: "Stories" },
      { to: "/app/automacoes/logs", label: "Logs" },
    ],
  },
  { to: "/app/palavras-chave", label: "Palavras-chave", icon: <KeyRound /> },
  { to: "/app/conversas", label: "Conversas", icon: <MessagesSquare /> },
  { to: "/app/contatos", label: "Contatos", icon: <Contact /> },
  { to: "/app/instagram", label: "Instagram", icon: <InstagramGlyph /> },
  { to: "/app/modelos", label: "Modelos", icon: <LayoutTemplate /> },
  { to: "/app/analytics", label: "Analytics", icon: <ChartColumn /> },
  { to: "/app/configuracoes", label: "Configurações", icon: <Settings /> },
  { to: "/app/ajuda", label: "Ajuda", icon: <LifeBuoy /> },
];

function useInstagramAccounts() {
  return useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api.get<{ accounts: InstagramAccount[] }>("/instagram/accounts"), staleTime: 60_000 });
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const me = useMe();
  const items: NavItem[] = me.user.role === "admin" ? [...NAV, { to: "/app/admin", label: "Administração", icon: <Shield /> }] : NAV;
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Menu principal">
      {items.map((item) => {
        const active = item.end ? pathname === item.to : pathname.startsWith(item.to);
        return (
          <div key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&>svg]:size-[18px]",
                active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.children && <ChevronDown className={cn("size-4 transition-transform", !active && "-rotate-90")} />}
            </NavLink>
            {item.children && active && (
              <div className="mt-0.5 mb-1 ml-[22px] flex flex-col border-l border-white/10 pl-3">
                {item.children.map((child) => (
                  <NavLink
                    key={child.to}
                    to={child.to}
                    end={child.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn("rounded-md px-2 py-1.5 text-[13px] transition-colors", isActive ? "font-medium text-white" : "text-zinc-400 hover:text-zinc-100")
                    }
                  >
                    {child.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function PlanBox() {
  const me = useMe();
  const limit = me.plan.limits.messages_per_month;
  const used = me.usage.messages_per_month;
  return (
    <Link to="/app/configuracoes?aba=plano" className="mx-3 block rounded-xl bg-white/5 p-3 text-xs text-zinc-300 hover:bg-white/10">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">Plano {me.plan.name}</span>
        <BookOpen className="size-3.5 opacity-60" />
      </div>
      {limit ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
          </div>
          <p className="mt-1.5">
            {used.toLocaleString("pt-BR")} de {limit.toLocaleString("pt-BR")} mensagens no mês
          </p>
        </>
      ) : (
        <p className="mt-1">Mensagens ilimitadas</p>
      )}
    </Link>
  );
}

function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const content = (
    <div className="flex h-full flex-col gap-4 py-4">
      <div className="flex items-center justify-between px-5">
        <Link to="/app" onClick={onClose}>
          <Logo dark />
        </Link>
        <button className="rounded-lg p-1 text-zinc-400 hover:text-white lg:hidden" onClick={onClose} aria-label="Fechar menu">
          <X className="size-5" />
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <SidebarNav onNavigate={onClose} />
      </div>
      <PlanBox />
    </div>
  );
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-ink-950 lg:block">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink-950 animate-fade-in">{content}</aside>
        </div>
      )}
    </>
  );
}

function ConnectionStatus() {
  const { data } = useInstagramAccounts();
  const account = data?.accounts[0];
  if (!data) return null;
  if (!account) {
    return (
      <Link to="/app/instagram" className="hidden items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-brand-300 hover:text-brand-700 md:flex">
        <InstagramGlyph />
        Conectar Instagram
      </Link>
    );
  }
  const ok = account.status === "connected";
  return (
    <Link to="/app/instagram" className="hidden items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-100 md:flex" title="Conta do Instagram conectada">
      <Avatar src={account.profilePictureUrl} name={account.username} size={28} />
      <div className="text-left leading-tight">
        <p className="text-sm font-medium text-zinc-900">@{account.username}</p>
        <p className={cn("flex items-center gap-1 text-xs", ok ? "text-emerald-600" : "text-red-600")}>
          <span className={cn("size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-red-500")} />
          {ok ? "Conectado" : account.status === "token_expired" ? "Reconectar" : "Com erro"}
        </p>
      </div>
    </Link>
  );
}

function NotificationsMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ notifications: NotificationItem[]; unread: number }>("/notifications?limit=15"),
    refetchInterval: 120_000,
  });
  const markAll = async () => {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const open = async (n: NotificationItem) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (n.linkUrl) navigate(n.linkUrl);
  };
  const tone = { info: "bg-sky-500", success: "bg-emerald-500", warning: "bg-amber-500", error: "bg-red-500" };
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="relative rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label="Notificações">
          <Bell className="size-5" />
          {!!data?.unread && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
              {data.unread > 9 ? "9+" : data.unread}
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent>
        <div className="w-[min(22rem,calc(100vw-2rem))]">
          <div className="flex items-center justify-between px-2.5 py-2">
            <p className="text-sm font-semibold">Notificações</p>
            {!!data?.unread && (
              <button className="text-xs font-medium text-brand-700 hover:underline" onClick={markAll}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          <MenuSeparator />
          <div className="scrollbar-thin max-h-96 overflow-y-auto">
            {!data?.notifications.length && <p className="px-3 py-8 text-center text-sm text-zinc-500">Nenhuma notificação por enquanto.</p>}
            {data?.notifications.map((n) => (
              <MenuItem key={n.id} onSelect={() => open(n)}>
                <div className="flex w-full gap-2.5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-zinc-200" : tone[n.severity])} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", n.readAt ? "text-zinc-600" : "font-medium text-zinc-900")}>{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-zinc-500">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-zinc-400">{relativeTime(n.createdAt)}</p>
                  </div>
                </div>
              </MenuItem>
            ))}
          </div>
        </div>
      </MenuContent>
    </Menu>
  );
}

function AccountMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg py-1 pr-1 pl-1 hover:bg-zinc-100 sm:pr-2" aria-label="Menu da conta">
          <Avatar name={me.user.name} size={32} />
          <span className="hidden max-w-32 truncate text-sm font-medium text-zinc-800 sm:block">{me.user.name}</span>
          <ChevronDown className="hidden size-4 text-zinc-400 sm:block" />
        </button>
      </MenuTrigger>
      <MenuContent>
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium">{me.user.name}</p>
          <p className="text-xs text-zinc-500">{me.user.email}</p>
          <Badge tone="brand" className="mt-1.5">
            Plano {me.plan.name}
          </Badge>
        </div>
        <MenuSeparator />
        <MenuItem icon={<UserRound />} onSelect={() => navigate("/app/configuracoes")}>
          Minha conta
        </MenuItem>
        <MenuItem icon={<InstagramGlyph />} onSelect={() => navigate("/app/instagram")}>
          Instagram
        </MenuItem>
        <MenuItem icon={<LifeBuoy />} onSelect={() => navigate("/app/ajuda")}>
          Ajuda
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<LogOut />}
          danger
          onSelect={async () => {
            await logout();
            navigate("/login");
          }}
        >
          Sair
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

const MOBILE_TABS = [
  { to: "/app", label: "Início", icon: LayoutDashboard, end: true },
  { to: "/app/automacoes", label: "Automações", icon: Zap },
  { to: "/app/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/app/contatos", label: "Contatos", icon: Contact },
];

function MobileTabBar({ onMore }: { onMore: () => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navegação">
      {MOBILE_TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-brand-700" : "text-zinc-500")}>
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
      <button onClick={onMore} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-zinc-500">
        <MenuIcon className="size-5" />
        Mais
      </button>
    </nav>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const fullBleed = pathname.includes("/fluxo") || pathname.startsWith("/app/conversas");
  useLiveEvents(true);
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-dvh">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200/80 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="-ml-1 rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <MenuIcon className="size-5" />
          </button>
          <Link to="/app" className="lg:hidden">
            <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
          </Link>
          <div className="flex-1" />
          <ConnectionStatus />
          <NotificationsMenu />
          <AccountMenu />
        </header>
        <main className={cn(fullBleed ? "pb-[4.5rem] lg:pb-0" : "mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:py-8")}>
          <Outlet />
        </main>
      </div>
      <MobileTabBar onMore={() => setMobileOpen(true)} />
    </div>
  );
}
