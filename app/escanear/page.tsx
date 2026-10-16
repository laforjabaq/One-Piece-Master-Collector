"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectCard, getWorker, readCardCode, readCardCodeOnce, readCardName, readHints, snapshot } from "@/lib/ocr";
import { loadNameIndex, matchName, nameIndexNow, type NameMatch } from "@/lib/names";
import { decide, funnelLabel, type Funnel } from "@/lib/funnel";
import { normalizeCode } from "@/lib/code";
import { scanFeedback, unlockAudio } from "@/lib/feedback";
import { BulkPanel } from "./bulk";
import { baseVariant, enqueue, getBatchSize, markSeen, queueCount, readQueue, recentlySeen, setBatchSize, useQueue } from "@/lib/bulk";
import { ReadBanner, VariantPicker } from "./confirm";
import type { Variant } from "@/lib/optcg";
import { hintSummary, lastChoice, rankVariants, rememberChoice, saveHints, type Ranking, type ScanHints } from "@/lib/variants";
import { variantHashes } from "@/lib/phash";
import { artMatch, setArtEnabled, useArtEnabled } from "@/lib/embed";
import { ArtModelNotice } from "./art-notice";

type HintSource = (variants: Variant[]) => Promise<ScanHints | null>;
// Las pistas se calculan una sola vez por lectura, aunque se pidan varias veces:
// OCR de rareza/sello y hash (worker de Tesseract) en paralelo con la
// comparación de arte (worker de embeddings) contra las candidatas.
const hintSource = (src: CanvasImageSource, card: { x: number; y: number; w: number; h: number } | null | undefined, code: string): HintSource => {
  let p: Promise<ScanHints | null> | null = null;
  return (variants) =>
    (p ??= card
      ? Promise.all([readHints(src, card, code).catch(() => null), artMatch(src, card, variants)]).then(([h, art]) =>
          h || art ? { stamps: [], ...h, ...(art ? { art } : {}) } : null,
        )
      : Promise.resolve(null));
};

type Rect = { x: number; y: number; w: number; h: number };
type NameStep = { text: string; matches: NameMatch[]; preview?: string };

// Paso 1 del embudo: nombre leído sobre la carta detectada y emparejado con el
// índice de nombres. null si no hay índice, carta o lectura útil.
async function nameStep(src: CanvasImageSource, det: Rect | null): Promise<NameStep | null> {
  if (!det) return null;
  const index = nameIndexNow() ?? (await Promise.race([loadNameIndex(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]));
  if (!index) return null;
  const r = await readCardName(src, det, (t) => matchName(index, t).length > 0).catch(() => null);
  if (!r) return null;
  return { text: r.text, matches: matchName(index, r.text), preview: r.preview };
}

// Sin código, solo se acepta el nombre en vivo si encaja muy bien.
const LIVE_NAME_ONLY = 0.85;
const MAX_NAME_CODES = 8;

type Mode = "single" | "bulk";
const MODE_KEY = "opmc.scanMode.v1";
const SLINGER_KEY = "opmc.slinger.v1";

type Picker = { code: string; variants: Variant[]; ranking: Ranking | null; funnel?: string; resolve: (v: Variant | null) => void };
type Banner = { title: string; detail: string; image?: string; funnel?: string; resolve: (ok: boolean) => void };

type Status = { text: string; tone?: "error" | "ok" };
const CARD_RATIO = 63 / 88;

export default function ScanPage() {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const triedRef = useRef(new Set<string>());
  const [frame, setFrame] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [camera, setCamera] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ text: "Preparando…" });
  const [found, setFound] = useState(false);
  const [manual, setManual] = useState("");
  const [lastText, setLastText] = useState("");
  const [preview, setPreview] = useState("");
  const [namePreview, setNamePreview] = useState("");
  const [lastName, setLastName] = useState("");
  const [mode, setModeState] = useState<Mode>("single");
  const [batch, setBatch] = useState(30);
  const [reviewing, setReviewing] = useState(false);
  const queue = useQueue();
  const modeRef = useRef<Mode>("single");
  const batchRef = useRef(30);
  modeRef.current = mode;
  batchRef.current = batch;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const [slinger, setSlinger] = useState(false);
  const [zoom, setZoom] = useState(1); // zoom de cámara aplicado (1 = sin zoom)
  const [picker, setPicker] = useState<Picker | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const artOn = useArtEnabled();

  const askVariant = (code: string, variants: Variant[], ranking: Ranking | null, funnel?: Funnel) =>
    new Promise<Variant | null>((resolve) => setPicker({ code, variants, ranking, funnel: funnelLabel(funnel), resolve }));
  const confirmRead = (b: Omit<Banner, "resolve">) =>
    new Promise<boolean>((resolve) => setBanner({ ...b, resolve }));

  // Rectángulo guía (proporción de carta) dentro del visor.
  const layout = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const W = box.clientWidth, H = box.clientHeight;
    // En modo slinger la carta queda más lejos (~60% del visor); si la cámara
    // hizo zoom, el marco crece en la misma proporción.
    const k = slinger ? Math.min(0.86, 0.6 * zoom) : 0.86;
    let h = H * k, w = h * CARD_RATIO;
    if (w > W * k) { w = W * k; h = w / CARD_RATIO; }
    setFrame({ x: (W - w) / 2, y: (H - h) / 2, w, h });
  }, [slinger, zoom]);

  useEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === "bulk") setModeState("bulk");
      if (localStorage.getItem(SLINGER_KEY) === "1") setSlinger(true);
    } catch {
      /* nada */
    }
    setBatch(getBatchSize());
  }, []);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* nada */
    }
  };

  // Modo bulk: cada lectura válida va a la cola y se sigue escaneando. Si el
  // código tiene varias versiones se pregunta cuál es; luego, salvo al escribirlo
  // a mano, se muestra el banner de 3 s para cancelar.
  // Devuelve true solo cuando se llena el lote (para detener el bucle).
  const variantsCache = useRef(new Map<string, Variant[]>());
  // `pre`: candidatas ya reunidas por el embudo (varios códigos con el mismo nombre).
  const queueCode = useCallback(async (code: string, manual = false, getHints?: HintSource, funnel?: Funnel, pre?: { key: string; variants: Variant[] }) => {
    const seenKey = pre?.key ?? code;
    if (!manual && recentlySeen(seenKey)) {
      markSeen(seenKey); // la carta sigue frente a la cámara
      return false;
    }
    let variants = pre?.variants ?? variantsCache.current.get(code);
    if (!variants) {
      const res = await fetch(`/api/card/${encodeURIComponent(code)}`).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (!data?.variants?.length) {
        setStatus({ text: `${code} no aparece en la base, sigo intentando…`, tone: "error" });
        return false;
      }
      variants = data.variants as Variant[];
      variantsCache.current.set(code, variants);
    }
    if (funnel && !pre) funnel.code = { code, count: variants.length };
    const label = pre?.key ?? code;
    if (!manual) scanFeedback();
    let chosen = baseVariant(variants);
    let ranking: Ranking | null = null;
    if (variants.length > 1) {
      // Pistas del escaneo (rareza, sello, hash de imagen) + última elección
      const hints = getHints ? await getHints(variants) : null;
      const hashes = hints?.hash ? await variantHashes(variants) : {};
      ranking = rankVariants(variants, hints, hashes, pre ? undefined : lastChoice(code));
      if (funnel) funnel.art = ranking.art;
      // Sin ambigüedad (y con pistas reales) se salta el selector: el banner
      // de 3 s sigue permitiendo cancelar.
      if (hints && !ranking.ambiguous && ranking.best) {
        chosen = ranking.best;
      } else {
        const v = await askVariant(label, variants, ranking, funnel);
        setPicker(null);
        if (!v) {
          markSeen(seenKey);
          setStatus({ text: `Lectura de ${label} descartada` });
          return false;
        }
        chosen = v;
      }
      rememberChoice(chosen.code, chosen.variantId);
    }
    if (pre) {
      code = chosen.code;
      variants = variants.filter((v) => v.code === code);
      markSeen(seenKey);
    }
    const detected = hintSummary(ranking);
    if (!manual) {
      const ok = await confirmRead({
        title: chosen.fullName || chosen.name,
        detail: `${code} · ${chosen.label} · se añadirá a la cola${detected ? ` · ${detected}` : ""}`,
        image: chosen.image,
        funnel: funnelLabel(funnel),
      });
      setBanner(null);
      if (!ok) {
        markSeen(code);
        setStatus({ text: `Cancelado: ${code} no se añadió` });
        return false;
      }
    }
    if (enqueue(code, variants, { force: true, variantId: chosen.variantId })) {
      if (manual) scanFeedback();
      setFound(true);
      setTimeout(() => setFound(false), 400);
      setStatus({ text: `✓ ${chosen.name} (${code}) en la cola`, tone: "ok" });
    }
    if (queueCount(readQueue()) >= batchRef.current) {
      runningRef.current = false;
      setReviewing(true);
      return true;
    }
    return false;
  }, []);

  const goTo = useCallback(
    async (code: string, getHints?: HintSource, funnel?: Funnel) => {
      if (modeRef.current === "bulk") return queueCode(code, false, getHints, funnel);
      if (triedRef.current.has(code)) return false;
      triedRef.current.add(code);
      setStatus({ text: `Leí ${code}, buscando…` });
      const res = await fetch(`/api/card/${encodeURIComponent(code)}`).catch(() => null);
      if (res?.ok) {
        setFound(true);
        scanFeedback();
        const data = await res.json().catch(() => null);
        const hintsP = data?.variants?.length > 1 && getHints ? getHints(data.variants) : null;
        const v = data?.variants?.length ? baseVariant(data.variants as Variant[]) : null;
        if (funnel) funnel.code = { code, count: data?.variants?.length ?? 0 };
        const ok = await confirmRead({ title: v?.name ?? code, detail: `${code} · abriendo la carta`, image: v?.image, funnel: funnelLabel(funnel) });
        setBanner(null);
        setFound(false);
        if (!ok) {
          setStatus({ text: `Cancelado: ${code}. Sigue escaneando` });
          setTimeout(() => triedRef.current.delete(code), 4000);
          return false;
        }
        runningRef.current = false;
        const hints = hintsP ? await hintsP : null;
        if (hints) saveHints(code, hints);
        router.push(`/carta/${code}`);
        return true;
      }
      setStatus({ text: `${code} no aparece en la base, sigo intentando…`, tone: "error" });
      setTimeout(() => triedRef.current.delete(code), 4000);
      return false;
    },
    [router, queueCode],
  );

  // Solo nombre (código ilegible): candidatas = todas las versiones de todos
  // los códigos con ese nombre; el arte y las pistas eligen entre ellas.
  const goName = useCallback(
    async (codes: string[], getHints: HintSource, funnel: Funnel) => {
      const key = `nombre:${funnel.name?.match ?? codes.join(",")}`;
      if (modeRef.current === "single" && triedRef.current.has(key)) return false;
      if (modeRef.current === "bulk" && recentlySeen(key)) {
        markSeen(key);
        return false;
      }
      triedRef.current.add(key);
      setStatus({ text: `Leí el nombre ${funnel.name?.match}, buscando…` });
      const lists = await Promise.all(
        codes.slice(0, MAX_NAME_CODES).map(async (c) => {
          const cached = variantsCache.current.get(c);
          if (cached) return cached;
          const res = await fetch(`/api/card/${encodeURIComponent(c)}`).catch(() => null);
          const data = res?.ok ? await res.json().catch(() => null) : null;
          const vs = (data?.variants ?? []) as Variant[];
          if (vs.length) variantsCache.current.set(c, vs);
          return vs;
        }),
      );
      const all = lists.flat();
      setTimeout(() => triedRef.current.delete(key), 4000);
      if (!all.length) return false;
      if (funnel.name) funnel.name.count = all.length;
      if (modeRef.current === "bulk") return queueCode(all[0].code, false, getHints, funnel, { key: funnel.name?.match ?? key, variants: all });
      scanFeedback();
      const hints = await getHints(all);
      const hashes = hints?.hash ? await variantHashes(all) : {};
      const ranking = rankVariants(all, hints, hashes);
      funnel.art = ranking.art;
      let chosen = ranking.best;
      if (!hints || ranking.ambiguous || !chosen) {
        chosen = await askVariant(funnel.name?.match ?? all[0].name, all, ranking, funnel);
        setPicker(null);
        if (!chosen) {
          setStatus({ text: "Lectura descartada" });
          return false;
        }
      }
      const ok = await confirmRead({ title: chosen.fullName || chosen.name, detail: `${chosen.code} · abriendo la carta`, image: chosen.image, funnel: funnelLabel(funnel) });
      setBanner(null);
      if (!ok) {
        setStatus({ text: "Cancelado. Sigue escaneando" });
        return false;
      }
      runningRef.current = false;
      if (hints) saveHints(chosen.code, hints);
      rememberChoice(chosen.code, chosen.variantId);
      router.push(`/carta/${chosen.code}`);
      return true;
    },
    [router, queueCode],
  );

  // Embudo: Nombre → Código → (Arte en las pistas). Devuelve true si terminó.
  const handleRead = useCallback(
    async (src: CanvasImageSource, card: Rect, codes: string[], codeConf: number, name: NameStep | null, live: boolean) => {
      const d = decide(name?.text ?? "", name?.matches ?? [], codes, codeConf);
      const f = d.funnel;
      if (f.conflict) console.info("[embudo]", f.conflict);
      if (f.source === "name") {
        if (live && !codes.length && (f.name?.score ?? 0) < LIVE_NAME_ONLY) return false;
        return goName(d.codes, hintSource(src, card, ""), f);
      }
      for (const c of d.codes) if (await goTo(c, hintSource(src, card, c), { ...f, name: f.name ? { ...f.name } : undefined })) return true;
      return false;
    },
    [goTo, goName],
  );

  // Zoom de la cámara (si el navegador lo permite) para acercar la carta del slinger.
  const slingerRef = useRef(slinger);
  slingerRef.current = slinger;
  const applyZoom = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } };
    if (!track || !caps.zoom || caps.zoom.max <= caps.zoom.min) {
      setZoom(1);
      return;
    }
    const target = on ? Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1.4)) : caps.zoom.min;
    try {
      await track.applyConstraints({ advanced: [{ zoom: target } as MediaTrackConstraintSet] });
      setZoom(on ? Math.max(1, target / Math.max(1, caps.zoom.min)) : 1);
    } catch {
      setZoom(1);
    }
  }, []);

  const toggleSlinger = () => {
    const next = !slinger;
    setSlinger(next);
    try {
      localStorage.setItem(SLINGER_KEY, next ? "1" : "0");
    } catch {
      /* nada */
    }
    applyZoom(next);
  };

  const stop = useCallback(() => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera(false);
  }, []);

  const loop = useCallback(async () => {
    const video = videoRef.current, box = boxRef.current;
    let n = 0;
    while (runningRef.current && video && box) {
      if (video.readyState >= 2 && video.videoWidth) {
        // Pasar el marco de pantalla a coordenadas del video (object-fit: cover).
        const s = Math.max(box.clientWidth / video.videoWidth, box.clientHeight / video.videoHeight);
        const ox = (box.clientWidth - video.videoWidth * s) / 2;
        const oy = (box.clientHeight - video.videoHeight * s) / 2;
        const f = frameRef.current;
        const card = { x: (f.x - ox) / s, y: (f.y - oy) / s, w: f.w / s, h: f.h / s };
        // zona visible del video: ahí se busca la carta (aunque esté fuera del marco)
        const view = { x: -ox / s, y: -oy / s, w: box.clientWidth / s, h: box.clientHeight / s };
        try {
          // Con carta detectada: nombre y código en paralelo sobre la misma copia del fotograma.
          const seen = detectCard(video, view);
          const shot = seen ? snapshot(video) : null;
          const [{ codes, text, preview, card: det, conf }, name] = await Promise.all([
            readCardCodeOnce(shot ?? video, card, view, n++),
            shot ? nameStep(shot, seen) : Promise.resolve(null),
          ]);
          if (text.trim()) setLastText(text.trim());
          if (name?.text) setLastName(name.text);
          if (preview && n % 3 === 1) setPreview(preview);
          if (name?.preview && n % 3 === 1) setNamePreview(name.preview);
          if (codes.length || name?.matches.length) {
            const src = shot ?? snapshot(video);
            if (await handleRead(src, det ?? seen ?? card, codes, conf ?? 0, name, true)) return;
          }
        } catch (e) {
          setStatus({ text: "Error del lector: " + (e as Error).message, tone: "error" });
        }
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }, [handleRead]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({ text: "Este navegador no permite usar la cámara aquí. Usa la foto o escribe el código.", tone: "error" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCamera(true);
      layout();
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      setTorch(caps.torch ? false : null);
      applyZoom(slingerRef.current);
      if (caps.focusMode?.includes("continuous")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      }
      setStatus({ text: "Cargando lector…" });
      await getWorker();
      setStatus({ text: "Llena el marco con la carta y mantenla quieta" });
      runningRef.current = true;
      loop();
    } catch (e) {
      const name = (e as DOMException).name;
      setStatus({
        text:
          name === "NotAllowedError"
            ? "No hay permiso para la cámara. Actívalo en los ajustes del navegador, o usa la foto."
            : "No se pudo abrir la cámara: " + (e as Error).message,
        tone: "error",
      });
    }
  }, [layout, loop, applyZoom]);

  useEffect(() => {
    getWorker().catch(() => {}); // precarga el OCR
    loadNameIndex().catch(() => {}); // y el índice de nombres
    start();
    return stop;
  }, [start, stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => {});
    setTorch(!torch);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setStatus({ text: "Leyendo la foto…" });
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    try {
      const full = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      const det = detectCard(img, full);
      const [{ codes, text, preview, card, conf }, name] = await Promise.all([readCardCode(img, full), nameStep(img, det)]);
      setLastText(text.trim() || "(sin texto)");
      setLastName(name?.text ?? "");
      if (preview) setPreview(preview);
      if (name?.preview) setNamePreview(name.preview);
      if (await handleRead(img, card ?? det ?? full, codes, conf ?? 0, name, false)) return;
      if (modeRef.current === "bulk" && (codes.length || name?.matches.length)) return;
      setStatus({ text: "No encontré el código en la foto. Acércate más a la carta o escríbelo abajo.", tone: "error" });
    } finally {
      URL.revokeObjectURL(img.src);
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeCode(manual);
    if (!code) {
      setStatus({ text: "Ese código no tiene el formato esperado (ej. OP05-119, ST10-002, P-041).", tone: "error" });
      return;
    }
    if (mode === "bulk") {
      setManual("");
      queueCode(code, true);
      return;
    }
    stop();
    router.push(`/carta/${code}`);
  };

  const openReview = () => {
    runningRef.current = false;
    setReviewing(true);
  };

  const resume = () => {
    setReviewing(false);
    variantsCache.current.clear();
    if (streamRef.current && !runningRef.current) {
      setStatus({ text: "Sigue escaneando el siguiente lote" });
      runningRef.current = true;
      loop();
    }
  };

  const count = queueCount(queue);

  return (
    <>
      <h1>Escanear</h1>
      <p className="sub">Coloca la carta dentro del marco. Se detecta sola. En PC puedes usar la webcam o subir una foto.</p>

      <div className="seg" role="tablist" aria-label="Modo de escaneo" onPointerDown={unlockAudio}>
        <button role="tab" aria-selected={mode === "single"} className={mode === "single" ? "on" : ""} onClick={() => setMode("single")}>1 a 1</button>
        <button role="tab" aria-selected={mode === "bulk"} className={mode === "bulk" ? "on" : ""} onClick={() => setMode("bulk")}>Bulk</button>
      </div>
      {mode === "bulk" && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="pill" data-testid="queue-count" style={{ fontSize: "0.9rem" }}>En cola: {count} / {batch}</span>
          <select
            className="input"
            style={{ flex: "none", width: "auto" }}
            aria-label="Tamaño del lote"
            value={batch}
            onChange={(e) => {
              const n = Number(e.target.value);
              setBatch(n);
              setBatchSize(n);
            }}
          >
            <option value={30}>Lote de 30</option>
            <option value={50}>Lote de 50</option>
          </select>
          <button className="btn primary small" onClick={openReview} disabled={!queue.length}>Revisar</button>
        </div>
      )}
      {reviewing && <BulkPanel onDone={resume} />}
      {picker && <VariantPicker code={picker.code} variants={picker.variants} ranking={picker.ranking} funnel={picker.funnel} onPick={picker.resolve} />}

      <div className="scanner" ref={boxRef}>
        <video ref={videoRef} playsInline muted />
        {frame.w > 0 && (
          <div className={found ? "frame found" : "frame"} style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}>
            <div className="code-zone" />
          </div>
        )}
        {torch !== null && (
          <button className="btn small" style={{ position: "absolute", bottom: 10, right: 10 }} onClick={toggleTorch}>
            {torch ? "Luz ✓" : "Luz"}
          </button>
        )}
        <div className={"scanner-status " + (status.tone === "error" ? "error" : "")}>{status.text}</div>
        {banner && <ReadBanner key={banner.title + banner.detail} title={banner.title} detail={banner.detail} image={banner.image} funnel={banner.funnel} onDone={banner.resolve} />}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className={"btn small" + (slinger ? " primary" : "")}
          aria-pressed={slinger}
          onClick={toggleSlinger}
          style={{ flex: 1 }}
        >
          {slinger ? "Modo slinger / Distancia ✓" : "Modo slinger / Distancia"}
        </button>
        <button
          className={"btn small" + (artOn ? " primary" : "")}
          aria-pressed={artOn}
          onClick={() => setArtEnabled(!artOn)}
          style={{ flex: 1 }}
          title="Compara la ilustración con las versiones del mismo código, en tu dispositivo"
        >
          {artOn ? "Reconocimiento por arte ✓" : "Reconocimiento por arte"}
        </button>
      </div>
      <ArtModelNotice />

      <div className="spacer" />
      <div className="row">
        {!camera && (
          <button className="btn primary" onClick={start}>Abrir cámara</button>
        )}
        <label className="btn" style={{ flex: 1 }}>
          Tomar o subir foto
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        </label>
      </div>

      <div className="spacer" />
      <form className="row" onSubmit={submitManual}>
        <input
          className="input"
          placeholder="Escribe el código (OP05-119)"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="btn primary" type="submit">{mode === "bulk" ? "Añadir" : "Ir"}</button>
      </form>

      {(lastText || lastName) && (
        <>
          <div className="spacer" />
          <details>
            <summary>Lo último que leyó el OCR</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--muted)" }}>{lastText}</pre>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="Zona que analiza el lector" id="ocr-preview" style={{ width: "100%", borderRadius: 8, background: "#fff" }} />}
            {lastName && <p style={{ fontSize: 12, color: "var(--muted)" }} data-testid="ocr-name">Nombre leído: {lastName}</p>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {namePreview && <img src={namePreview} alt="Zona del nombre" id="ocr-name-preview" style={{ width: "100%", borderRadius: 8, background: "#fff" }} />}
          </details>
        </>
      )}
    </>
  );
}
