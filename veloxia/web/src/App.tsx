import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from "react-router";
import { AppLayout } from "./components/layout/AppLayout";
import { Button, Spinner } from "./components/ui";
import { useAuth } from "./hooks/useAuth";
import { takePostAuthRedirect } from "./lib/authRedirect";

const Landing = lazy(() => import("./pages/public/Landing"));
const Login = lazy(() => import("./pages/public/Login"));
const Signup = lazy(() => import("./pages/public/Signup"));
const ForgotPassword = lazy(() => import("./pages/public/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/public/ResetPassword"));
const Legal = lazy(() => import("./pages/public/Legal"));
const DataDeletionStatus = lazy(() => import("./pages/public/DataDeletionStatus"));
const NotFound = lazy(() => import("./pages/public/NotFound"));
const Onboarding = lazy(() => import("./pages/onboarding/Onboarding"));
const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const AutomationsList = lazy(() => import("./pages/app/automations/AutomationsList"));
const AutomationForm = lazy(() => import("./pages/app/automations/AutomationForm"));
const AutomationDetail = lazy(() => import("./pages/app/automations/AutomationDetail"));
const FlowBuilderPage = lazy(() => import("./pages/app/automations/flow/FlowBuilderPage"));
const FaqPage = lazy(() => import("./pages/app/automations/FaqPage"));
const CommentsPage = lazy(() => import("./pages/app/automations/CommentsPage"));
const StoriesPage = lazy(() => import("./pages/app/automations/StoriesPage"));
const LogsPage = lazy(() => import("./pages/app/automations/LogsPage"));
const KeywordsPage = lazy(() => import("./pages/app/KeywordsPage"));
const InboxPage = lazy(() => import("./pages/app/InboxPage"));
const ContactsPage = lazy(() => import("./pages/app/ContactsPage"));
const ChannelsPage = lazy(() => import("./pages/app/ChannelsPage"));
const ConnectGuidePage = lazy(() => import("./pages/app/ConnectGuidePage"));
const TemplatesPage = lazy(() => import("./pages/app/TemplatesPage"));
const AnalyticsPage = lazy(() => import("./pages/app/AnalyticsPage"));
const SettingsPage = lazy(() => import("./pages/app/SettingsPage"));
const HelpPage = lazy(() => import("./pages/app/HelpPage"));
const AdminPage = lazy(() => import("./pages/app/AdminPage"));

function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<PageLoader />}>{children}</Suspense>;

/** Proteção de rotas: exige sessão válida. */
function RequireAuth() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!me) return <Navigate to={`/login?voltar=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

/** Páginas de login/cadastro redirecionam quem já está autenticado. */
function GuestOnly() {
  const { me, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (me) {
    return <Navigate to={takePostAuthRedirect() ?? "/app"} replace />;
  }
  return <Outlet />;
}

function RootError() {
  const error = useRouteError() as Error | undefined;
  const chunkError = error?.message?.includes("dynamically imported module") || error?.message?.includes("Failed to fetch");
  // O usuário vê só a mensagem amigável; o detalhe fica no console para diagnóstico.
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{chunkError ? "Uma nova versão está disponível" : "Algo deu errado"}</h1>
      <p className="max-w-md text-sm text-zinc-500">
        {chunkError ? "Recarregue a página para continuar." : "Ocorreu um erro inesperado ao exibir esta página. Tente recarregar."}
      </p>
      <Button onClick={() => window.location.reload()}>Recarregar</Button>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RootError />,
    children: [
      { path: "/", element: <S><Landing /></S> },
      { path: "/privacidade", element: <S><Legal kind="privacy" /></S> },
      { path: "/termos", element: <S><Legal kind="terms" /></S> },
      { path: "/exclusao-de-dados", element: <S><DataDeletionStatus /></S> },
      { path: "/redefinir-senha", element: <S><ResetPassword /></S> },
      {
        element: <GuestOnly />,
        children: [
          { path: "/login", element: <S><Login /></S> },
          { path: "/cadastro", element: <S><Signup /></S> },
          { path: "/esqueci-senha", element: <S><ForgotPassword /></S> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { path: "/onboarding", element: <S><Onboarding /></S> },
          {
            path: "/app",
            element: <AppLayout />,
            children: [
              { index: true, element: <S><Dashboard /></S> },
              { path: "automacoes", element: <S><AutomationsList /></S> },
              { path: "automacoes/nova", element: <S><AutomationForm /></S> },
              { path: "automacoes/respostas", element: <S><FaqPage /></S> },
              { path: "automacoes/comentarios", element: <S><CommentsPage /></S> },
              { path: "automacoes/stories", element: <S><StoriesPage /></S> },
              { path: "automacoes/logs", element: <S><LogsPage /></S> },
              { path: "automacoes/:id", element: <S><AutomationDetail /></S> },
              { path: "automacoes/:id/editar", element: <S><AutomationForm /></S> },
              { path: "automacoes/:id/fluxo", element: <S><FlowBuilderPage /></S> },
              { path: "palavras-chave", element: <S><KeywordsPage /></S> },
              { path: "conversas", element: <S><InboxPage /></S> },
              { path: "conversas/:id", element: <S><InboxPage /></S> },
              { path: "contatos", element: <S><ContactsPage /></S> },
              { path: "contatos/:id", element: <S><ContactsPage /></S> },
              { path: "canais", element: <S><ChannelsPage /></S> },
              { path: "como-conectar", element: <S><ConnectGuidePage /></S> },
              { path: "instagram", element: <Navigate to="/app/canais?canal=instagram" replace /> },
              { path: "modelos", element: <S><TemplatesPage /></S> },
              { path: "analytics", element: <S><AnalyticsPage /></S> },
              { path: "configuracoes", element: <S><SettingsPage /></S> },
              { path: "ajuda", element: <S><HelpPage /></S> },
              { path: "admin", element: <S><AdminPage /></S> },
            ],
          },
        ],
      },
      { path: "*", element: <S><NotFound /></S> },
    ],
  },
]);
