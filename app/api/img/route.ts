import { NextResponse } from "next/server";

// Proxy de imágenes de cartas para leerlas en canvas sin CORS (hash perceptual).
// Solo hosts conocidos de la base de cartas, para no ser un proxy abierto.
const ALLOWED = /(^|\.)optcgapi\.com$/i;
const MAX = 5 * 1024 * 1024;

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u") || "";
  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return NextResponse.json({ error: "URL no válida" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED.test(target.hostname)) {
    return NextResponse.json({ error: "Host no permitido" }, { status: 403 });
  }
  try {
    const res = await fetch(target, { headers: { "User-Agent": "OnePieceMasterCollector/0.1" }, redirect: "error" });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) return NextResponse.json({ error: "No disponible" }, { status: 502 });
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX) return NextResponse.json({ error: "Demasiado grande" }, { status: 502 });
    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=604800, s-maxage=2592000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "No disponible" }, { status: 502 });
  }
}
