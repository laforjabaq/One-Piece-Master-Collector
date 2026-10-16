import { NextResponse } from "next/server";
import { getCard } from "@/lib/optcg";
import { normalizeCode } from "@/lib/code";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeCode(decodeURIComponent(raw));
  if (!code) return NextResponse.json({ error: "Código no válido" }, { status: 400 });
  try {
    const variants = await getCard(code);
    if (!variants.length) return NextResponse.json({ code, variants, error: "No encontrada" }, { status: 404 });
    return NextResponse.json(
      { code, variants },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch {
    return NextResponse.json({ code, error: "No se pudo consultar la base de cartas" }, { status: 502 });
  }
}
