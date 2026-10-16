// Extrae el código de carta (OP05-119, ST10-002, EB01-001, PRB01-001, P-001)
// del texto del OCR, corrigiendo confusiones típicas (O/0, S/5, B/8, I/1...).

const DIGIT: Record<string, string> = { O: "0", D: "0", Q: "0", I: "1", L: "1", T: "7", S: "5", B: "8", Z: "2", G: "6", A: "4" };
const toDigits = (s: string) => s.replace(/[ODQILTSBZGA]/g, (c) => DIGIT[c]);

const D = "[0-9ODQILTSBZGA]";
const SEP = "\\s*[-–—~_.=]?\\s*";
// Tras el número suele venir pegada la rareza ("OP05-119SEC"), así que solo
// se descarta si sigue otro dígito real.
const SET_RE = new RegExp(`(PR[B8]|[O0D][PR]|[S5][T7]|E[B8])\\s*(${D}${D})${SEP}(${D}${D}${D})(?![0-9])`, "g");
const PROMO_RE = new RegExp(`(?:^|[^A-Z0-9])P\\s*[-–—~_.=]\\s*(${D}${D}${D})(?![0-9])`, "g");

function prefix(p: string): string {
  if (p.startsWith("PR")) return "PRB";
  if (/^[O0D][PR]$/.test(p)) return "OP";
  if (/^[S5][T7]$/.test(p)) return "ST";
  return "EB";
}

export function extractCodes(text: string): string[] {
  const t = text.toUpperCase();
  const out: string[] = [];
  for (const m of t.matchAll(SET_RE)) out.push(`${prefix(m[1])}${toDigits(m[2])}-${toDigits(m[3])}`);
  for (const m of t.matchAll(PROMO_RE)) out.push(`P-${toDigits(m[1])}`);
  return [...new Set(out)];
}

export function normalizeCode(input: string): string | null {
  const t = input.toUpperCase().replace(/\s+/g, "");
  const direct = t.match(/^(OP|ST|EB|PRB)(\d{1,2})-?(\d{1,3})$/);
  if (direct) return `${direct[1]}${direct[2].padStart(2, "0")}-${direct[3].padStart(3, "0")}`;
  const promo = t.match(/^P-?(\d{1,3})$/);
  if (promo) return `P-${promo[1].padStart(3, "0")}`;
  return extractCodes(t)[0] ?? null;
}
