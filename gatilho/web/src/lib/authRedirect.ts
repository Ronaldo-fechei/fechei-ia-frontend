/** Destino após login/cadastro (definido pela página antes de atualizar a sessão). */
let target: string | null = null;

export function setPostAuthRedirect(path: string | null): void {
  target = path;
}

export function takePostAuthRedirect(): string | null {
  const t = target;
  target = null;
  return t;
}
