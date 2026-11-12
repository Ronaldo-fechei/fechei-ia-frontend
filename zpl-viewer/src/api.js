// Cliente da API HTTP de renderização ZPL (engenharia reversa do viewer).
//
// Contrato observado:
//   POST {host}/v1/printers/{dpmm}dpmm/labels/{larguraPol}x{alturaPol}/{indice}/   (indice omitido => todas as etiquetas)
//     corpo : multipart/form-data  -> file=<ZPL (Blob text/plain)>, _charset_=UTF-8
//     Accept: image/png | application/pdf | application/zpl | application/epl
//     headers opcionais: X-Quality (grayscale|bitonal), X-Linter: On, X-Formatter: On,
//                        X-Rotation, X-Target-Dpmm, X-API-Key
//     resposta: corpo + headers X-Total-Count e X-Warnings (expostos via CORS)
//   POST {host}/v1/graphics   (multipart file=<imagem>, Accept: application/json) -> {totalBytes,rowBytes,data}
//   GET  {host}/version

export const DEFAULT_API = 'https://api.labelary.com';

export const MIME = {
  png: 'image/png',
  pdf: 'application/pdf',
  zpl: 'application/zpl',
  epl: 'application/epl',
  json: 'application/json',
};

export const FACTORS = { inches: 1, cm: 0.393701, mm: 0.0393701 };

export const MSG_UNREACHABLE =
  'ERRO: não foi possível falar com o servidor de renderização (indisponível, bloqueado pela rede ou CORS).';

const MAX_ZPL_BYTES_PUBLIC = 1024 * (1024 - 1); // limite de ~1 MB do proxy público
const MAX_IMAGE_BYTES_PUBLIC = 204800; // 200 KB

export function serverUrl(host) {
  const h = (host || '').trim();
  if (!h) return DEFAULT_API;
  return /^https?:\/\//i.test(h) ? h.replace(/\/+$/, '') : 'https://' + h;
}

export function isPublicApi(host) {
  try {
    const hn = new URL(serverUrl(host)).hostname;
    return hn === 'labelary.com' || hn.endsWith('.labelary.com');
  } catch {
    return false;
  }
}

/** Validações locais, para evitar uma ida ao servidor que certamente falharia. */
export function preflight(zpl, host) {
  if (zpl.length > MAX_ZPL_BYTES_PUBLIC && isPublicApi(host)) {
    return (
      'ERRO: o ZPL excede o tamanho máximo (1 MB). Se houver várias etiquetas, envie em lotes menores; ' +
      'se houver imagens ou fontes embutidas grandes, remova-as ou reduza-as.'
    );
  }
  const u = zpl.toUpperCase();
  const custom = u.includes('~CC') || u.includes('^CC');
  if (!u.includes('^XA') && !u.includes('\x02') && !custom) return 'ERRO: o ZPL não tem o comando inicial ^XA.';
  if (!u.includes('^XZ') && !u.includes('\x03') && !custom) return 'ERRO: o ZPL não tem o comando final ^XZ.';
  return null;
}

// A API pública limita ~5 req/s e responde 429 com Retry-After (segundos). Tentamos de novo até 2 vezes.
async function send(url, init, retries = 2) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    return null; // erro de rede/CORS ("status 0" no XHR original)
  }
  if (res.status === 429 && retries > 0) {
    const wait = Math.min(Math.max(parseFloat(res.headers.get('Retry-After')) || 1, 0.5), 5);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return send(url, init, retries - 1);
  }
  return res;
}

/**
 * Renderiza/transforma ZPL.
 * Retorna { ok, blob?, total, warnings, error? }.
 */
export async function renderZpl(o) {
  const pre = preflight(o.zpl, o.apiHost);
  if (pre) return { ok: false, total: '0', warnings: '', error: pre };

  const factor = FACTORS[o.units] ?? 1;
  const width = Number(o.width) * factor;
  const height = Number(o.height) * factor;
  if (!(width > 0) || !(height > 0)) {
    return { ok: false, total: '0', warnings: '', error: 'ERRO: informe largura e altura válidas para a etiqueta.' };
  }
  const index = Math.max((parseInt(o.index, 10) || 1) - 1, 0); // UI base 1, API base 0
  const url =
    `${serverUrl(o.apiHost)}/v1/printers/${o.density}dpmm/labels/${width}x${height}/` +
    (o.all ? '' : `${index}/`);

  // O ZPL vai dentro de um Blob para que as quebras de linha cheguem como LF (índices de warnings corretos).
  const form = new FormData();
  form.append('file', new Blob([o.zpl], { type: 'text/plain' }));
  form.append('_charset_', 'UTF-8');

  const headers = { Accept: o.accept, 'X-Quality': o.quality, 'X-Linter': 'On' };
  if (o.formatted) headers['X-Formatter'] = 'On';
  if (o.rotation) headers['X-Rotation'] = String(o.rotation);
  if (o.targetDpmm) headers['X-Target-Dpmm'] = String(o.targetDpmm);
  if (o.apiKey) headers['X-API-Key'] = o.apiKey;

  const res = await send(url, { method: 'POST', headers, body: form });
  if (!res) return { ok: false, total: '0', warnings: '', error: MSG_UNREACHABLE };

  const total = res.headers.get('X-Total-Count') || '0';
  const warnings = res.headers.get('X-Warnings') || '';
  if (res.ok) return { ok: true, blob: await res.blob(), total, warnings };
  if (res.status === 429) {
    return { ok: false, total, warnings: '', error: 'ERRO: limite de requisições da API atingido. Aguarde alguns segundos e tente novamente.' };
  }
  const text = (await res.text().catch(() => '')) || `ERRO: HTTP ${res.status}`;
  return { ok: false, total, warnings: '', error: text };
}

/** Converte uma imagem em comando ^GFA via /v1/graphics. */
export async function uploadGraphic({ file, apiHost, apiKey }) {
  if (file.size > MAX_IMAGE_BYTES_PUBLIC && isPublicApi(apiHost)) {
    throw new Error('ERRO: imagem maior que o máximo de 200 KB');
  }
  const form = new FormData();
  form.append('file', file);
  const headers = { Accept: MIME.json };
  if (apiKey) headers['X-API-Key'] = apiKey;
  const res = await send(`${serverUrl(apiHost)}/v1/graphics`, { method: 'POST', headers, body: form });
  if (!res) throw new Error(MSG_UNREACHABLE);
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `ERRO: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error('ERRO: não foi possível interpretar a resposta do servidor');
  }
}

export async function getVersion(apiHost) {
  const res = await send(`${serverUrl(apiHost)}/version`, {});
  return res && res.ok ? (await res.text()).trim() : null;
}
