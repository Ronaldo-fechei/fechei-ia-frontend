import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { setPostAuthRedirect } from "../../lib/authRedirect";
import { Button, Callout, Checkbox, Field, Input } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { AuthLayout } from "./AuthLayout";

export default function Signup() {
  const [form, setForm] = useState({ name: "", email: "", password: "", acceptTerms: false });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!form.acceptTerms) {
      setError("Para continuar, aceite os termos de uso e a política de privacidade.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/signup", form);
      setPostAuthRedirect("/onboarding");
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Crie sua conta"
      subtitle="Grátis para começar. Sem cartão de crédito."
      footer={
        <>
          Já tem conta?{" "}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="error">{error}</Callout>}
        <Field label="Seu nome" htmlFor="name" error={fields.name}>
          <Input id="name" autoComplete="name" value={form.name} onChange={(e) => set("name")(e.target.value)} required />
        </Field>
        <Field label="E-mail" htmlFor="email" error={fields.email}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email")(e.target.value)} required />
        </Field>
        <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres." error={fields.password}>
          <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password")(e.target.value)} required />
        </Field>
        <Checkbox
          checked={form.acceptTerms}
          onChange={set("acceptTerms")}
          label={
            <span className="font-normal text-zinc-600">
              Li e aceito os{" "}
              <Link to="/termos" target="_blank" className="font-medium text-brand-700 hover:underline">
                termos de uso
              </Link>{" "}
              e a{" "}
              <Link to="/privacidade" target="_blank" className="font-medium text-brand-700 hover:underline">
                política de privacidade
              </Link>
              .
            </span>
          }
        />
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
