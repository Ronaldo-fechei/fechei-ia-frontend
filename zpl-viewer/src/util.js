import COMMANDS from './commands.json';

export { COMMANDS };

export const SAMPLE_ZPL = `^XA

^FX Cabecalho com caixa e nome da empresa
^CF0,60
^FO50,50^GB100,100,100^FS
^FO75,75^FR^GB100,100,100^FS
^FO220,50^FDMinha Empresa Ltda^FS
^CF0,30
^FO220,115^FDRua das Flores, 100^FS
^FO220,155^FDSao Paulo SP 01000-000^FS
^FO50,250^GB700,3,3^FS

^FX Destinatario
^CFA,30
^FO50,300^FDMaria da Silva^FS
^FO50,340^FDAv. Brasil, 2000^FS
^FO50,380^FDRio de Janeiro RJ 20000-000^FS
^FO50,500^GB700,3,3^FS

^FX Codigo de barras
^BY5,2,270
^FO100,550^BC^FD12345678^FS

^FX Rodape
^FO50,900^GB700,250,3^FS
^FO400,900^GB3,250,3^FS
^CF0,40
^FO100,960^FDPEDIDO 4821^FS
^FO100,1010^FDVOLUME 1/1^FS
^CF0,190
^FO470,955^FDSP^FS

^XZ`;

export const DENSITIES = [
  { value: '6', label: '6 dpmm (152 dpi)' },
  { value: '8', label: '8 dpmm (203 dpi)' },
  { value: '12', label: '12 dpmm (300 dpi)' },
  { value: '24', label: '24 dpmm (600 dpi)' },
];

/** Estilo CSS que gira a imagem da etiqueta, mantendo o layout abaixo dela correto. */
export function rotationStyle(rotation, nat, animate) {
  const quarter = rotation % 360;
  const maxWidth = rotation % 180 === 0 ? 400 : 600;
  const maxHeight = rotation % 180 === 0 ? 600 : 400;
  const nw = nat.w || 1;
  const nh = nat.h || 1;
  const factor = Math.min(maxWidth / nw, maxHeight / nh, 1);

  let x = '0';
  let y = '0';
  if (quarter === 90) y = '-100%';
  else if (quarter === 180) {
    x = '100%';
    y = '-100%';
  } else if (quarter === 270) {
    x = nh * factor + 'px';
    y = (nw - nh) * factor + 'px';
  }
  // o giro via CSS não altera o layout: compensamos com margem inferior
  const marginBottom = quarter === 90 || quarter === 270 ? factor * (nw - nh) : 0;

  return {
    transition: animate ? '0.5s ease-in-out' : '0s',
    transformOrigin: 'left bottom',
    transform: `translateX(${x}) translateY(${y}) rotate(${rotation}deg)`,
    maxWidth,
    maxHeight,
    marginBottom,
  };
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* armazenamento indisponível */
    }
  },
  clearWhere(filter) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.filter(filter).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};

/** Encontra o comando ZPL sob o cursor (ex.: "^FO", "^A0", "~DG"). */
export function commandAtCursor(el) {
  const zpl = el.value;
  const selEnd = el.selectionEnd;
  let selStart = el.selectionStart;
  if (selStart == null) return null;
  if (selStart === selEnd && selStart > 0) selStart--;
  const start = Math.max(zpl.lastIndexOf('^', selStart), zpl.lastIndexOf('~', selStart));
  if (start === -1 || start + 2 >= zpl.length) return null;
  const end = (zpl[start + 1] === 'a' || zpl[start + 1] === 'A') && zpl[start + 2] !== '@' ? start + 2 : start + 3;
  const name = zpl.substring(start, end).toUpperCase();
  return /^[~^][A-Z0-9@]{1,2}$/.test(name) ? name : null;
}
