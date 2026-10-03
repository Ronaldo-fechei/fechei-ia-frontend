import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, Callout, Field, Input } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { AuthLayout } from "./AuthLayout";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      navigate("/login?senha=redefinida", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Criar nova senha" subtitle="Escolha uma senha forte que você não usa em outros sites.">
      {!token ? (
        <Callout tone="error" title="Link inválido">
          Abra o link enviado por e-mail ou <Link to="/esqueci-senha" className="underline">solicite um novo</Link>.
        </Callout>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Callout tone="error">{error}</Callout>}
          <Field label="Nova senha" htmlFor="password" hint="Mínimo de 8 caracteres.">
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Field label="Confirme a nova senha" htmlFor="confirm">
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Salvar nova senha
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
