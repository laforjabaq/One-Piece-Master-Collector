# One Piece Master Collector

App web instalable (PWA) para escanear cartas de One Piece TCG con la cámara del teléfono y llevar tu colección.

## Fase 1 (MVP) — lo que hace
- **Escanear**: abre la cámara trasera, lee el código de la esquina inferior derecha (OP05-119, ST10-002, EB01-001, PRB01-001, P-041) con OCR en el propio teléfono (Tesseract.js) y abre la carta sola. También acepta una foto o el código escrito a mano.
- **Elegir variante**: muestra todas las versiones que comparten ese código (normal, parallel, etc.) con su imagen y precio de mercado de TCGplayer.
- **Agregar con cantidad** y volver a escanear la siguiente.
- **Colección**: lista con filtros, orden, +/− de cantidad, total de cartas y valor aproximado.
- **Buscar** por nombre o código como respaldo.
- La colección se guarda en el teléfono (localStorage) con exportar/importar respaldo en JSON. La sincronización en la nube (Supabase) viene después.

## Datos
- Cartas e imágenes: [optcgapi.com](https://optcgapi.com) (edición en inglés), consultado desde las rutas `/api/*` del servidor (sin problemas de CORS y con caché de 24 h).
- Precio: `market_price` de optcgapi, que viene de TCGplayer (USD).

## Desarrollo
```bash
npm install      # también copia el motor de OCR a public/tesseract
npm run dev      # http://localhost:3000
npm run build && npm start
```
La cámara del navegador solo funciona en **HTTPS** (o en `localhost`). Para probar en el teléfono hay que publicarla, por ejemplo en Vercel.

## Publicar en Vercel (recomendado)
1. Sube esta carpeta a un repositorio de GitHub.
2. En vercel.com → *Add New Project* → importa el repositorio (Framework: Next.js, sin variables de entorno).
3. Abre la URL `https://…vercel.app` en el teléfono y usa "Agregar a pantalla de inicio".

## Estructura
- `app/escanear` — cámara + OCR
- `app/carta/[code]` — elegir variante y cantidad
- `app/page.tsx` — colección
- `app/buscar` — búsqueda manual
- `app/api/card/[code]`, `app/api/cards` — proxy a optcgapi
- `lib/code.ts` — extracción y corrección del código leído
- `lib/ocr.ts` — preprocesado de imagen y Tesseract
- `lib/collection.ts` — guardado local
- `public/sw.js`, `public/manifest.webmanifest` — PWA

## Reconocimiento por arte (en el dispositivo, gratis)

Cuando un código tiene varias versiones, la app compara la ilustración de la carta
detectada con las imágenes de cada versión usando embeddings de imagen
(DINOv2-small, licencia Apache-2.0) con ONNX Runtime Web en un Web Worker
(WebGPU si hay, si no WASM). Sin API keys ni servicios de pago.

- El modelo se descarga de Hugging Face la primera vez que hace falta (~23 MB int8
  en WASM, ~44 MB fp16 en WebGPU, más el motor ONNX en `/public/ort`) y queda en la
  caché del navegador para funcionar sin conexión.
- Los vectores de las imágenes de referencia se calculan al vuelo (vía `/api/img`)
  y se guardan en IndexedDB.
- Se activa o desactiva con el botón "Reconocimiento por arte" del escáner. Si el
  modelo no carga, se sigue con el código, los sellos y el hash como antes.
- Margen para aceptar sola (similitud coseno de la 1.ª sobre la 2.ª):
  `localStorage["opmc.artMargin.v1"]` (por defecto 0.04).

## Índice de arte de todo el catálogo y escaneo continuo

Ideas tomadas de cómo escanea ManaBox, todo gratis:

- **Índice precalculado** (`public/embeddings/index.bin` + `index.json`): un vector
  DINOv2-small int8 por versión de carta (~2 MB para ~5.000 versiones). Lo genera
  `scripts/build-embeddings.mjs` con el mismo modelo y preprocesado que el worker
  del teléfono, y lo actualiza cada lunes el workflow `.github/workflows/embeddings.yml`
  (o a mano: Actions → *Embeddings index* → *Run workflow*). El Service Worker lo
  cachea. Si no existe, la app sigue calculando los vectores por candidata.
- **Arte primero**: con el índice, los 8 vecinos más cercanos acotan las candidatas
  y el OCR de nombre/código y el sello deciden entre ellas (el embudo lo muestra
  como `Arte top-8: …`). Si no se leen ni nombre ni código, decide el arte.
- **Modo Rápido**: las lecturas seguras se añaden solas (sonido, contador y valor
  TCGplayer acumulado); las dudosas muestran las 3 mejores. Al terminar se revisa
  la lista con edición masiva (set, foil, idioma, cantidad, borrar).
- **Ajustes fijos de la sesión**: sets bloqueados, foil e idioma, en la barra de
  chips sobre el visor.
- **Perspectiva**: si la carta está inclinada se buscan sus 4 esquinas y se
  endereza con una homografía antes de leer y comparar (`lib/warp.ts`).
- Guía de captura en pantalla y aviso de reflejos.

Generar el índice en local: `npm i --no-save onnxruntime-node@1.30.0 sharp@0.35.5 && node scripts/build-embeddings.mjs`.
