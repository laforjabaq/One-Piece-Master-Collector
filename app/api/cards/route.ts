import { NextResponse } from "next/server";
import { getAllCards } from "@/lib/optcg";

export const maxDuration = 60;

export async function GET() {
  try {
    const cards = await getAllCards();
    if (!cards.length) return NextResponse.json({ error: "No se pudo cargar la lista de cartas" }, { status: 502 });
    return NextResponse.json(
      { cards },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch {
    return NextResponse.json({ error: "No se pudo cargar la lista de cartas" }, { status: 502 });
  }
}
