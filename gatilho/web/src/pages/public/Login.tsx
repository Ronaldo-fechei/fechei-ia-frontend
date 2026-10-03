import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { setPostAuthRedirect } from "../../lib/authRedirect";
import { Button, Callout, Field, Input } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { AuthLayout } from "./AuthLayout";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const back = params.get("voltar");
  const reset = params.get("senha") === "redefinida";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password });
      setPostAuthRedirect(back && back.startsWith("/") && !back.startsWith("//") ? back : "/app");
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse seu painel de automações."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link to="/cadastro" className="font-medium text-brand-700 hover:underline">
            Criar conta grátis
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {reset && <Callout tone="success">Senha redefinida. Entre com a nova senha.</Callout>}
        {error && <Callout tone="error">{error}</Callout>}
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label={
            <span className="flex items-center justify-between">
              Senha
              <Link to="/esqueci-senha" className="text-xs font-medium text-brand-700 hover:underline">
                Esqueci minha senha
              </Link>
            </span>
          }
          htmlFor="password"
        >
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
