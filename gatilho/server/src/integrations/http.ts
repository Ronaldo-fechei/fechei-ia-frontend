/**
 * Ponto único de saída HTTP para integrações externas. Permite substituir o
 * fetch em testes automatizados sem tocar no código das integrações.
 */
type FetchFn = typeof fetch;

let current: FetchFn = (input, init) => fetch(input, init);

export const httpFetch: FetchFn = (input, init) => current(input, init);

export function setHttpFetch(fn: FetchFn | null): void {
  current = fn ?? ((input, init) => fetch(input, init));
}
