import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button, Callout, Field, Input } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useSystemStatus } from "../../hooks/useAuth";
import { AuthLayout } from "./AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: status } = useSystemStatus();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Enviaremos um link para você criar uma nova senha."
      footer={
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {status && !status.emailEnabled ? (
        <Callout tone="warning" title="Recuperação por e-mail indisponível">
          O envio de e-mails ainda não foi configurado neste servidor.
          {status.supportEmail ? ` Fale com o suporte: ${status.supportEmail}.` : " Fale com o administrador do sistema."}
        </Callout>
      ) : sent ? (
        <Callout tone="success" title="Verifique seu e-mail">
          Se existir uma conta com <strong>{email}</strong>, você receberá um link para redefinir a senha. O link vale por 1 hora.
        </Callout>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Callout tone="error">{error}</Callout>}
          <Field label="E-mail da conta" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
