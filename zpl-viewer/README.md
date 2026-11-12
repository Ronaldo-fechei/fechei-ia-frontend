# Visualizador ZPL

App web (React + Vite) para editar, validar e pré-visualizar etiquetas **ZPL**, com as mesmas funções do
viewer público da Labelary, obtido por engenharia reversa do cliente.

## Rodar

```bash
cd zpl-viewer
npm install
npm run dev      # desenvolvimento
npm run build    # produção (dist/)
```

## Funções

| Função | Como funciona |
|---|---|
| Pré-visualização | PNG renderizado pela API; densidade 6/8/12/24 dpmm, qualidade grayscale/bitonal, tamanho em pol/cm/mm, seletor "etiqueta N de M" |
| Redesenhar | Botão ou `Ctrl+Enter` (editar o ZPL não redesenha sozinho; mudar controles redesenha com debounce) |
| Girar | Rotação só visual (CSS); é enviada em `X-Rotation` nos downloads |
| Imagem | `POST /v1/graphics` converte a imagem em `^GFA` inserido logo após `^XA` |
| Abrir / baixar ZPL | Arquivo local → editor; editor → `etiqueta.zpl` |
| Formatar | `X-Formatter: On`, `Accept: application/zpl`, todas as etiquetas |
| Transformar | Orientação (`X-Rotation` 90/180/270, troca largura×altura) ou densidade (`X-Target-Dpmm`) |
| Downloads | PNG, PDF (uma), PDF (todas), EPL |
| Linter | `X-Warnings` convertido de bytes UTF-8 para caracteres; clique seleciona o trecho; faixas acompanham a edição |
| Ajuda de comandos | 241 comandos ZPL (`src/commands.json`), mostrada conforme o cursor |
| Permalink / lembrar | Parâmetros na query string; "lembrar minha última etiqueta" em `localStorage` |
| API própria | Campos Host e API Key (instâncias privadas) |
| Painéis | Tela cheia e alternar configurações / ajuda / linter |

## Contrato da API (observado no cliente original)

```
POST {host}/v1/printers/{dpmm}dpmm/labels/{largura_pol}x{altura_pol}/{indice}/   (sem índice = todas)
  multipart/form-data: file=<ZPL> (Blob text/plain), _charset_=UTF-8
  Accept: image/png | application/pdf | application/zpl | application/epl
  Headers: X-Quality, X-Linter: On, X-Formatter: On, X-Rotation, X-Target-Dpmm, X-API-Key
  Resposta: X-Total-Count, X-Warnings  ("indice|tamanho|comando|param|mensagem|…", índices em bytes)
POST {host}/v1/graphics   (file=<imagem>, Accept: application/json) -> { totalBytes, rowBytes, data }
GET  {host}/version
```

O índice é base 0 na API e na permalink; a UI usa base 1. A API pública (`api.labelary.com`) tem CORS aberto,
limite de ~5 req/s (HTTP 429 com `Retry-After`), ZPL de até 1 MB e imagens de até 200 KB.

## Observações

- A renderização é feita pelo serviço Labelary; o app não renderiza ZPL localmente. Para uso em produção/volume,
  confira os termos de uso da API ou aponte o campo *Host* para uma instância própria.
- Os textos de ajuda dos comandos (`src/commands.json`) foram extraídos do viewer original; confirme a licença
  antes de redistribuir publicamente.
