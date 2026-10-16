// Búsqueda sin distinguir mayúsculas ni acentos.
export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matches(haystack: string, query: string): boolean {
  const h = fold(haystack);
  return fold(query).split(/\s+/).filter(Boolean).every((w) => h.includes(w));
}
