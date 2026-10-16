"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getWorker, readCardCode, readCardCodeOnce } from "@/lib/ocr";
import { normalizeCode } from "@/lib/code";
import { scanFeedback, unlockAudio } from "@/lib/feedback";
import { BulkPanel } from "./bulk";
import { enqueue, getBatchSize, queueCount, readQueue, setBatchSize, useQueue } from "@/lib/bulk";
import type { Variant } from "@/lib/optcg";

type Mode = "single" | "bulk";
const MODE_KEY = "opmc.scanMode.v1";

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

  // Rectángulo guía (proporción de carta) dentro del visor.
  const layout = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const W = box.clientWidth, H = box.clientHeight;
    let h = H * 0.86, w = h * CARD_RATIO;
    if (w > W * 0.86) { w = W * 0.86; h = w / CARD_RATIO; }
    setFrame({ x: (W - w) / 2, y: (H - h) / 2, w, h });
  }, []);

  useEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === "bulk") setModeState("bulk");
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

  // Modo bulk: cada lectura válida va a la cola y se sigue escaneando.
  // Devuelve true solo cuando se llena el lote (para detener el bucle).
  const variantsCache = useRef(new Map<string, Variant[]>());
  const queueCode = useCallback(async (code: string, force = false) => {
    let variants = variantsCache.current.get(code);
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
    if (enqueue(code, variants, { force })) {
      scanFeedback();
      setFound(true);
      setTimeout(() => setFound(false), 400);
      setStatus({ text: `✓ ${variants[0].name} (${code}) en la cola`, tone: "ok" });
    }
    if (queueCount(readQueue()) >= batchRef.current) {
      runningRef.current = false;
      setReviewing(true);
      return true;
    }
    return false;
  }, []);

  const goTo = useCallback(
    async (code: string) => {
      if (modeRef.current === "bulk") return queueCode(code);
      if (triedRef.current.has(code)) return false;
      triedRef.current.add(code);
      setStatus({ text: `Leí ${code}, buscando…` });
      const res = await fetch(`/api/card/${encodeURIComponent(code)}`).catch(() => null);
      if (res?.ok) {
        setFound(true);
        scanFeedback();
        runningRef.current = false;
        router.push(`/carta/${code}`);
        return true;
      }
      setStatus({ text: `${code} no aparece en la base, sigo intentando…`, tone: "error" });
      setTimeout(() => triedRef.current.delete(code), 4000);
      return false;
    },
    [router, queueCode],
  );

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
        try {
          const { codes, text, preview } = await readCardCodeOnce(video, card, n++);
          if (text.trim()) setLastText(text.trim());
          if (preview && n % 3 === 1) setPreview(preview);
          for (const c of codes) if (await goTo(c)) return;
        } catch (e) {
          setStatus({ text: "Error del lector: " + (e as Error).message, tone: "error" });
        }
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }, [goTo]);

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
  }, [layout, loop]);

  useEffect(() => {
    getWorker().catch(() => {}); // precarga el OCR
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
      const { codes, text } = await readCardCode(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
      setLastText(text.trim());
      for (const c of codes) if (await goTo(c)) return;
      if (modeRef.current === "bulk" && codes.length) return;
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
      </div>

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

      {lastText && (
        <>
          <div className="spacer" />
          <details>
            <summary>Lo último que leyó el OCR</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--muted)" }}>{lastText}</pre>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="Zona que analiza el lector" id="ocr-preview" style={{ width: "100%", borderRadius: 8, background: "#fff" }} />}
          </details>
        </>
      )}
    </>
  );
}
