import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MIME, getVersion, renderZpl, uploadGraphic } from './api.js';
import { adjustWarnings, parseWarnings } from './warnings.js';
import {
  COMMANDS,
  DENSITIES,
  SAMPLE_ZPL,
  commandAtCursor,
  ls,
  rotationStyle,
  triggerDownload,
} from './util.js';

// ---------- estado inicial: query string > localStorage > padrão ----------
const usp = new URLSearchParams(window.location.search);
const pick = (name) => usp.get(name) || ls.get(name);
const toInt = (v, d) => (Number.isNaN(parseInt(v, 10)) ? d : parseInt(v, 10));

function Icon({ d }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
const I = {
  redraw: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5h.01',
  rotate: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  open: 'M3 7h6l2 2h10v10H3zM3 7v12',
  indent: 'M3 6h18M11 12h10M11 18h10M3 9l3 3-3 3',
  magic: 'M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5L17 5l-3-1-1 2h-2L10 4 7 5l.5 2L6 8.5 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.5 19 7 21l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  down: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
};

export default function App() {
  // ---------- campos ----------
  const [zpl, setZpl] = useState(() => pick('zpl') || SAMPLE_ZPL);
  const [density, setDensity] = useState(() => pick('density') || '8');
  const [quality, setQuality] = useState(() => pick('quality') || 'grayscale');
  const [width, setWidth] = useState(() => pick('width') || '4');
  const [height, setHeight] = useState(() => pick('height') || '6');
  const [units, setUnits] = useState(() => pick('units') || 'inches');
  const [index, setIndex] = useState(() => toInt(pick('index'), 0) + 1); // API/permalink: base 0; UI: base 1
  const [rotation, setRotation] = useState(() => toInt(pick('rotation'), 0));
  const [animateRot, setAnimateRot] = useState(false);
  const [remember, setRemember] = useState(() => ls.get('remember') === 'true');
  const [apiHost, setApiHost] = useState(() => ls.get('apiHost') || '');
  const [apiKey, setApiKey] = useState(() => ls.get('apiKey') || '');

  // ---------- resultado ----------
  const [imageUrl, setImageUrl] = useState('');
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [warnings, setWarnings] = useState([]);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);

  // ---------- layout ----------
  const [hideControls, setHideControls] = useState(() => ls.get('layout.hide.controls') === 'true');
  const [hideHelp, setHideHelp] = useState(() => ls.get('layout.hide.help') === 'true');
  const [hideWarnings, setHideWarnings] = useState(() => ls.get('layout.hide.warnings') === 'true');
  const [fullscreen, setFullscreen] = useState(false);
  const [cmdName, setCmdName] = useState('');
  const [toast, setToast] = useState('');

  const taRef = useRef(null);
  const fileImgRef = useRef(null);
  const fileZplRef = useRef(null);
  const dialogRef = useRef(null);
  const reqId = useRef(0);
  const timer = useRef(null);

  // espelho do estado mais recente, para callbacks assíncronos
  const latest = useRef({});
  latest.current = { zpl, density, quality, width, height, units, index, rotation, apiHost, apiKey };

  // ---------- renderização ----------
  const labelDone = useCallback((totalHeader, warningsHeader, err, zplUsed) => {
    setError(err || '');
    setTotal(parseInt(totalHeader || '0', 10) || 0);
    setWarnings(parseWarnings(warningsHeader || '', zplUsed));
  }, []);

  const refreshLabel = useCallback(async () => {
    const s = latest.current;
    const id = ++reqId.current;
    setBusy(true);
    const r = await renderZpl({ ...s, accept: MIME.png, all: false });
    if (id !== reqId.current) return; // resposta obsoleta
    setBusy(false);
    if (r.ok) {
      setImageUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(r.blob);
      });
      labelDone(r.total, r.warnings, '', s.zpl);
    } else {
      labelDone(r.total, '', r.error, s.zpl);
    }
  }, [labelDone]);

  const scheduleRefresh = useCallback(
    (delay) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(refreshLabel, delay);
    },
    [refreshLabel],
  );
  const [tick, setTick] = useState(0); // pede redesenho imediato após um setState em lote

  // alterar densidade/qualidade/tamanho/índice redesenha (com debounce); editar o ZPL só redesenha em "Redesenhar"
  useEffect(() => {
    scheduleRefresh(350);
    return () => clearTimeout(timer.current);
  }, [density, quality, width, height, units, index, scheduleRefresh]);
  useEffect(() => {
    if (tick) scheduleRefresh(0); // declarado depois: vence o debounce acima quando ambos disparam
  }, [tick, scheduleRefresh]);

  useEffect(() => {
    let alive = true;
    getVersion(apiHost).then((v) => alive && setVersion(v ? `Renderização via API Labelary ${v}` : 'Renderização via API Labelary'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- persistência ----------
  useEffect(() => {
    if (!remember) return;
    ls.set('remember', 'true');
    ls.set('zpl', zpl);
    ls.set('density', density);
    ls.set('quality', quality);
    ls.set('width', width);
    ls.set('height', height);
    ls.set('units', units);
    ls.set('index', String(Math.max(toInt(index, 1) - 1, 0)));
    ls.set('rotation', String(((rotation % 360) + 360) % 360));
  }, [remember, zpl, density, quality, width, height, units, index, rotation]);
  useEffect(() => {
    ls.set('apiHost', apiHost);
    ls.set('apiKey', apiKey);
  }, [apiHost, apiKey]);

  const toggleRemember = (checked) => {
    setRemember(checked);
    if (!checked) ls.clearWhere((k) => !k.startsWith('layout.') && !k.startsWith('api'));
  };

  const toggleLayout = (key, value, setter) => {
    setter(!value);
    ls.set(key, String(!value));
  };

  // ---------- permalink ----------
  const permalink = useMemo(() => {
    const p = new URLSearchParams({
      density,
      quality,
      width,
      height,
      units,
      index: String(Math.max(toInt(index, 1) - 1, 0)),
      rotation: String(((rotation % 360) + 360) % 360),
      zpl,
    });
    return '?' + p.toString();
  }, [density, quality, width, height, units, index, rotation, zpl]);

  // ---------- editor ZPL ----------
  // Mantém as faixas dos avisos do linter alinhadas enquanto o usuário digita.
  // IMPORTANTE: o 'beforeinput' nativo só guarda dados em refs (sem setState). Atualizar estado em um listener
  // nativo de 'input' causaria um re-render antes do React processar o evento e reverteria o texto digitado.
  const editRef = useRef({ start: 0, end: 0, data: null, len: 0 });
  useEffect(() => {
    const el = taRef.current;
    const before = (e) => {
      editRef.current = { start: el.selectionStart, end: el.selectionEnd, data: e.data, len: el.value.length };
    };
    el.addEventListener('beforeinput', before);
    return () => el.removeEventListener('beforeinput', before);
  }, []);

  const onZplInput = (e) => {
    const el = e.currentTarget;
    const { start: s0, end: e0, data: beforeData, len: beforeLen } = editRef.current;
    const type = e.nativeEvent.inputType || '';
    if (type.startsWith('insert')) {
      const data = type !== 'insertLineBreak' ? e.nativeEvent.data || beforeData || '' : '\n';
      setWarnings((w) => adjustWarnings(w, s0, e0, data));
    } else if (type.startsWith('delete')) {
      let start = s0;
      let end = e0;
      if (start === end) {
        const diff = beforeLen - el.value.length;
        if (type === 'deleteContentBackward') start -= diff;
        if (type === 'deleteContentForward') end += diff;
      }
      setWarnings((w) => adjustWarnings(w, start, end, ''));
    } else if (!type.startsWith('format')) {
      setWarnings((w) => w.map((x) => ({ ...x, linked: false }))); // undo/redo: desfaz os links
    }
  };

  const updateHelp = () => {
    const name = commandAtCursor(taRef.current);
    if (name) setCmdName(name);
  };

  const highlightWarning = (w) => {
    const el = taRef.current;
    el.setSelectionRange(w.i, w.i);
    el.blur();
    el.focus(); // força o scroll até o cursor no Chrome
    el.setSelectionRange(w.i, w.i + w.s);
    updateHelp();
  };

  /** Troca o texto do editor preservando o histórico de desfazer quando possível. */
  const updateZpl = (text, preserveUndo) => {
    const el = taRef.current;
    if (el.value === text) return;
    if (preserveUndo && document.execCommand && document.queryCommandSupported?.('insertText')) {
      el.focus();
      el.select();
      document.execCommand('insertText', false, text);
    }
    if (el.value !== text) setZpl(text);
  };

  // ---------- ações ----------
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const doRotate = () => {
    setAnimateRot(true);
    setRotation((r) => r + 90);
  };

  const doFormat = async () => {
    const s = latest.current;
    const r = await renderZpl({ ...s, accept: MIME.zpl, all: true, formatted: true, rotation: 0 });
    if (!r.ok) return showToast(r.error);
    const text = await r.blob.text();
    updateZpl(text, true);
    labelDone(r.total, r.warnings, '', text); // sem redesenhar a imagem, só atualiza avisos
  };

  const doTransform = async ({ mode, degrees, targetDpmm }) => {
    const s = latest.current;
    const targetRotation = mode === 'orientation' ? degrees : null;
    const r = await renderZpl({
      ...s,
      accept: MIME.zpl,
      all: true,
      rotation: targetRotation || 0,
      targetDpmm: mode === 'density' ? targetDpmm : null,
    });
    if (!r.ok) return showToast(r.error);
    const text = await r.blob.text();
    if (targetRotation === '90' || targetRotation === '270') {
      setWidth(s.height);
      setHeight(s.width);
    } else if (targetDpmm) {
      setDensity(targetDpmm);
    }
    updateZpl(text, true);
    setTick((t) => t + 1);
  };

  const download = async (mime, all, ext) => {
    const s = latest.current;
    const r = await renderZpl({ ...s, accept: mime, all, rotation: ((s.rotation % 360) + 360) % 360 });
    if (!r.ok) return showToast(r.error);
    triggerDownload(r.blob, (all ? 'etiquetas.' : 'etiqueta.') + ext);
  };
  const downloadZpl = () => triggerDownload(new Blob([zpl], { type: MIME.zpl }), 'etiqueta.zpl');

  const onImageFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const d = await uploadGraphic({ file, apiHost, apiKey });
      const cmd = `\n\n^FO50,50^GFA,${d.totalBytes},${d.totalBytes},${d.rowBytes},${d.data}^FS\n\n\n`;
      const at = zpl.toUpperCase().indexOf('^XA');
      const next = at === -1 ? cmd + zpl : zpl.slice(0, at + 3) + cmd + zpl.slice(at + 3);
      setZpl(next);
      setTick((t) => t + 1);
    } catch (err) {
      showToast(err.message);
    }
  };

  const onZplFile = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateZpl(String(reader.result), false);
      setTick((t) => t + 1);
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const onZplKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      refreshLabel();
    }
  };

  const maxIndex = Math.max(total, 1);
  const cmd = cmdName ? COMMANDS[cmdName] : null;
  const imgStyle = useMemo(() => rotationStyle(rotation, nat, animateRot), [rotation, nat, animateRot]);

  // evita "pulo" do layout ao carregar uma nova imagem com rotação 90/270
  useLayoutEffect(() => {
    if (!imageUrl) setNat({ w: 0, h: 0 });
  }, [imageUrl]);

  return (
    <>
      <header className="bar">
        <div className="wrap bar-in">
          <span className="brand">
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="currentColor" d="M0 0H12V4H4V12H0zM16 16H4V12H12V4H16zM6 6H10V10H6z" />
            </svg>
            Visualizador ZPL
          </span>
          <span className="muted small">Edite, valide e baixe etiquetas ZPL</span>
        </div>
      </header>

      <main className="wrap grid">
        {/* ---------------- coluna esquerda: editor ---------------- */}
        <section>
          <textarea
            ref={taRef}
            id="zpl"
            value={zpl}
            onChange={(e) => setZpl(e.target.value)}
            onInput={onZplInput}
            onKeyUp={updateHelp}
            onMouseUp={updateHelp}
            onSelect={updateHelp}
            onKeyDown={onZplKeyDown}
            spellCheck={false}
            rows={25}
            aria-label="Código ZPL"
          />

          <div className="buttons">
            <button type="button" onClick={refreshLabel} title="Redesenhar a etiqueta (Ctrl+Enter)">
              <Icon d={I.redraw} /> Redesenhar
            </button>
            <button type="button" onClick={() => fileImgRef.current.click()} title="Inserir uma imagem na etiqueta">
              <Icon d={I.image} /> Imagem
            </button>
            <button type="button" onClick={doRotate} title="Girar a etiqueta">
              <Icon d={I.rotate} /> Girar
            </button>
            <a className="btn" href={permalink} title="Link permanente para esta etiqueta">
              <Icon d={I.link} /> Permalink
            </a>
            <button type="button" onClick={() => fileZplRef.current.click()} title="Abrir um arquivo ZPL">
              <Icon d={I.open} /> Abrir
            </button>
            <button type="button" onClick={doFormat} title="Formatar o ZPL">
              <Icon d={I.indent} /> Formatar
            </button>
            <button type="button" onClick={() => dialogRef.current.open()} title="Transformar o ZPL">
              <Icon d={I.magic} /> Transformar
            </button>
            <span className="group">
              <button type="button" className={fullscreen ? 'on' : ''} onClick={toggleFullscreen} title="Tela cheia" aria-pressed={fullscreen}>
                <Icon d={I.full} />
              </button>
              <button type="button" className={!hideControls ? 'on' : ''} onClick={() => toggleLayout('layout.hide.controls', hideControls, setHideControls)} title="Configurações" aria-pressed={!hideControls}>
                <Icon d={I.cog} />
              </button>
              <button type="button" className={!hideHelp ? 'on' : ''} onClick={() => toggleLayout('layout.hide.help', hideHelp, setHideHelp)} title="Ajuda dos comandos ZPL" aria-pressed={!hideHelp}>
                <Icon d={I.help} />
              </button>
              <button type="button" className={!hideWarnings ? 'on' : ''} onClick={() => toggleLayout('layout.hide.warnings', hideWarnings, setHideWarnings)} title="Linter" aria-pressed={!hideWarnings}>
                <Icon d={I.warn} />
              </button>
            </span>
          </div>
          <input ref={fileImgRef} type="file" accept="image/*" hidden onChange={onImageFile} />
          <input ref={fileZplRef} type="file" hidden onChange={onZplFile} />

          {!hideControls && (
            <div className="panel controls">
              <div className="row">
                <label htmlFor="density">Densidade:</label>
                <select id="density" value={density} onChange={(e) => setDensity(e.target.value)}>
                  {DENSITIES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="row">
                <label htmlFor="quality">Qualidade:</label>
                <select id="quality" value={quality} onChange={(e) => setQuality(e.target.value)}>
                  <option value="grayscale">Tons de cinza</option>
                  <option value="bitonal">Bitonal</option>
                </select>
              </div>
              <div className="row">
                <label htmlFor="width">Tamanho:</label>
                <input id="width" type="number" min="1" step="any" placeholder="largura" value={width} onChange={(e) => setWidth(e.target.value)} />
                <span>×</span>
                <input id="height" type="number" min="1" step="any" placeholder="altura" aria-label="altura" value={height} onChange={(e) => setHeight(e.target.value)} />
                <select value={units} onChange={(e) => setUnits(e.target.value)} aria-label="unidade">
                  <option value="inches">polegadas</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
              </div>
              <div className="row">
                <label htmlFor="index">Etiqueta:</label>
                <input
                  id="index"
                  type="number"
                  min="1"
                  max={maxIndex}
                  step="1"
                  value={index}
                  onChange={(e) => setIndex(Number.isNaN(parseInt(e.target.value, 10)) ? 1 : parseInt(e.target.value, 10))}
                />
                <span>de</span>
                <input type="number" value={total} disabled aria-label="total" />
              </div>
              <div className="row">
                <label htmlFor="apiHost">API:</label>
                <input id="apiHost" type="text" placeholder="Host (padrão api.labelary.com)" value={apiHost} onChange={(e) => setApiHost(e.target.value.trim())} />
                <input type="password" placeholder="API Key" aria-label="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} />
              </div>
              <div className="row">
                <label className="inline">
                  <input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.target.checked)} /> Lembrar minha última etiqueta
                </label>
                <span className="muted small">(guardado só neste navegador)</span>
              </div>
            </div>
          )}

          {!hideHelp && (
            <div className="panel help">
              {!cmdName && <p className="muted note">Clique em um comando ZPL acima para ver a ajuda dele.</p>}
              {cmdName && !(cmd && cmd.desc && cmd.params) && (
                <p className="muted note">Sem informações para o comando {cmdName}.</p>
              )}
              {cmdName && cmd && cmd.desc && cmd.params && (
                <>
                  <div className="sig">{cmdName} {cmd.params.map((p) => p.name).join(', ')}</div>
                  <div>{cmd.desc}</div>
                  {cmd.params.length > 0 && (
                    <>
                      <div>Parâmetros:</div>
                      <ul>
                        {cmd.params.map((p) => (
                          <li key={p.name}><b>{p.name}</b>: {p.desc}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div>Exemplo (uso comum): <i className="mono">{cmd.commonExample}</i></div>
                  <div>Exemplo (uso completo): <i className="mono">{cmd.fullExample}</i></div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ---------------- coluna direita: etiqueta ---------------- */}
        <section>
          <div className="preview" aria-busy={busy}>
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Etiqueta"
                className={error ? 'hidden' : ''}
                style={imgStyle}
                onLoad={(e) => {
                  setAnimateRot(false);
                  setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight });
                }}
              />
            )}
            {error && <div className="error" role="alert">{error}</div>}
          </div>

          <div className="buttons">
            <button type="button" onClick={downloadZpl} title="Baixar como ZPL"><Icon d={I.down} /> ZPL</button>
            <button type="button" onClick={() => download(MIME.png, false, 'png')} title="Baixar como imagem PNG"><Icon d={I.down} /> PNG</button>
            <button type="button" onClick={() => download(MIME.pdf, false, 'pdf')} title="Baixar PDF (uma etiqueta)"><Icon d={I.down} /> PDF</button>
            <button type="button" onClick={() => download(MIME.pdf, true, 'pdf')} title="Baixar PDF (todas as etiquetas)"><Icon d={I.down} /> PDF multi-etiqueta</button>
            <button type="button" onClick={() => download(MIME.epl, true, 'epl')} title="Baixar como EPL"><Icon d={I.down} /> EPL</button>
          </div>

          {!hideWarnings && (
            <div className="panel warnings">
              <label>
                Avisos do linter ({warnings.length}
                {warnings.length === 20 ? '+' : ''}):
              </label>
              {warnings.length === 0 && <div className="muted note">Nenhum</div>}
              {warnings.map((w, i) => (
                <div key={i} className="warn">
                  <Icon d={I.warn} />
                  {w.linked ? (
                    <a href="#" onClick={(e) => { e.preventDefault(); highlightWarning(w); }}>
                      {(w.c ? w.c + ': ' : '') + w.m}
                    </a>
                  ) : (
                    <span>{(w.c ? w.c + ': ' : '') + w.m}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="version">{version}</div>
        </section>
      </main>

      <TransformDialog ref={dialogRef} density={density} onApply={doTransform} />
      {toast && <div className="toast" role="alert" onClick={() => setToast('')}>{toast}</div>}
    </>
  );
}

// ---------------- diálogo de transformação ----------------
const TransformDialog = forwardRef(function TransformDialog({ density, onApply }, ref) {
  const dlg = useRef(null);
  const [mode, setMode] = useState('orientation');
  const [degrees, setDegrees] = useState('90');
  const targets = DENSITIES.filter((d) => d.value !== density);
  const [target, setTarget] = useState(targets[0].value);
  const current = DENSITIES.find((d) => d.value === density);

  useImperativeHandle(ref, () => ({
    open() {
      setMode('orientation');
      setDegrees('90');
      setTarget(DENSITIES.filter((d) => d.value !== density)[0].value);
      dlg.current.showModal();
    },
  }));

  const orient = mode === 'orientation';
  return (
    <dialog ref={dlg}>
      <h3>Aplicar transformação ao ZPL</h3>
      <label className="radio">
        <input type="radio" name="tx" checked={orient} onChange={() => setMode('orientation')} /> Transformar a orientação da etiqueta
      </label>
      <p className={orient ? '' : 'disabled'}>
        Pega uma etiqueta desenhada para uma orientação e atualiza as posições e orientações dos campos para outra direção.
      </p>
      <p className={orient ? '' : 'disabled'}>
        Girar no sentido horário:{' '}
        <select value={degrees} disabled={!orient} onChange={(e) => setDegrees(e.target.value)}>
          <option value="90">90°</option>
          <option value="180">180°</option>
          <option value="270">270°</option>
        </select>
      </p>
      <label className="radio">
        <input type="radio" name="tx" checked={!orient} onChange={() => setMode('density')} /> Transformar a densidade de impressão
      </label>
      <p className={!orient ? '' : 'disabled'}>
        Adapta posições e tamanhos dos campos para que a etiqueta funcione em outro tipo de impressora.
      </p>
      <p className={!orient ? '' : 'disabled'}>
        Converter de <b>{current?.label}</b> para:{' '}
        <select value={target} disabled={orient} onChange={(e) => setTarget(e.target.value)}>
          {targets.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </p>
      <div className="dlg-buttons">
        <button type="button" onClick={() => dlg.current.close()}>Cancelar</button>
        <button
          type="button"
          onClick={() => {
            dlg.current.close();
            onApply({ mode, degrees, targetDpmm: target });
          }}
        >
          OK
        </button>
      </div>
    </dialog>
  );
});
