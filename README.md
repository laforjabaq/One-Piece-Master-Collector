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
