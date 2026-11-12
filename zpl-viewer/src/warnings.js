// Linter: o servidor devolve em X-Warnings uma lista "indice|tamanho|comando|parametro|mensagem|..."
// com índices em BYTES (UTF-8). Aqui convertemos para índices de caracteres da string JS e mantemos
// as faixas alinhadas enquanto o usuário edita o texto.

export function parseWarnings(header, zpl) {
  const v = (header || '').split('|');
  const raw = [];
  for (let i = 0; i + 4 < v.length; i += 5) {
    raw.push({ i: parseInt(v[i], 10), s: parseInt(v[i + 1], 10), c: v[i + 2], p: v[i + 3], m: v[i + 4] });
  }
  if (!raw.length) return [];

  // mapa byte -> índice de char (ponto de início de cada char)
  const byteToChar = new Map();
  let b = 0;
  for (let c = 0; c < zpl.length; c++) {
    byteToChar.set(b, c);
    const code = zpl.charCodeAt(c);
    if (code <= 0x7f) b += 1;
    else if (code <= 0x7ff) b += 2;
    else if (code >= 0xd800 && code <= 0xdfff) b += 2; // 2 surrogates somam 4 bytes
    else b += 3;
  }
  byteToChar.set(b, zpl.length);

  const out = [];
  for (const w of raw) {
    const start = byteToChar.get(w.i);
    const end = byteToChar.get(w.i + w.s);
    if (start === undefined || end === undefined) continue;
    let i = start;
    let s = end - start;
    // sem quebras de linha nas bordas, só por apresentação
    while (s > 0 && zpl[i + s - 1] === '\n') s--;
    while (s > 0 && zpl[i] === '\n') {
      i++;
      s--;
    }
    out.push({ ...w, i, s, linked: true });
  }
  return out;
}

const normLen = (t) => t.length - (t.match(/\r\n/g) || []).length;

/** Ajusta as faixas dos warnings após uma edição (remoção da seleção + inserção de texto). */
export function adjustWarnings(warnings, selStart, selEnd, inserted) {
  return warnings.map((w0) => {
    const w = { ...w0 };
    const overlapStart = Math.max(selStart, w.i);
    const overlapEnd = Math.min(selEnd, w.i + w.s);
    const fullyInside = selStart > w.i && selEnd < w.i + w.s;
    if (selStart < w.i) w.i -= Math.min(selEnd, w.i) - selStart;
    if (overlapStart < overlapEnd) w.s -= overlapEnd - overlapStart;
    if (inserted && selStart <= w.i) w.i += normLen(inserted);
    if (inserted && fullyInside) w.s += normLen(inserted);
    return w;
  });
}
