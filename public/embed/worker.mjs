// Worker de embeddings de imagen (reconocimiento por arte). Corre en el
// dispositivo con ONNX Runtime Web: WebGPU si hay, si no WASM. El modelo se
// descarga una sola vez y queda en la Cache API para usarlo sin conexión.
// Mensajes: {id, type:"init", models:[{url, backend}]} y {id, type:"embed", rgba, size}.
const MODEL_CACHE = "opmc-models-v1";
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let session = null;
let ort = null;
let info = null;

async function fetchModel(url, report) {
  let cache = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) return { bytes: new Uint8Array(await hit.arrayBuffer()), cached: true };
  } catch {
    cache = null; // sin Cache API (modo privado): se descarga igual
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Modelo no disponible (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    report(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.byteLength;
  }
  try {
    await cache?.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  } catch {
    /* cuota llena: funciona, pero se volverá a descargar */
  }
  return { bytes, cached: false };
}

async function init(id, models) {
  let lastErr = null;
  for (const m of models) {
    try {
      const gpu = m.backend === "webgpu";
      ort = await import(gpu ? "/ort/ort.webgpu.min.mjs" : "/ort/ort.wasm.min.mjs");
      ort.env.wasm.wasmPaths = "/ort/";
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const { bytes, cached } = await fetchModel(m.url, (loaded, total) => postMessage({ id, progress: { loaded, total } }));
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: gpu ? ["webgpu", "wasm"] : ["wasm"],
        graphOptimizationLevel: "all",
      });
      info = { backend: m.backend, url: m.url, bytes: bytes.byteLength, cached };
      return info;
    } catch (e) {
      lastErr = e;
      session = null;
    }
  }
  throw lastErr ?? new Error("Sin modelos");
}

// RGBA (size x size) -> tensor NCHW normalizado como en el preprocesado de DINOv2.
function toTensor(rgba, size) {
  const n = size * size;
  const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) data[c * n + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return new ort.Tensor("float32", data, [1, 3, size, size]);
}

async function embed(rgba, size) {
  const feeds = { [session.inputNames[0]]: toTensor(rgba, size) };
  const out = await session.run(feeds);
  // pooler_output (CLS normalizado) si existe; si no, el token CLS del último estado.
  const t = out.pooler_output ?? out.last_hidden_state ?? out[session.outputNames[0]];
  const dim = t.dims[t.dims.length - 1];
  const v = new Float32Array(t.data.subarray ? t.data.subarray(0, dim) : Array.from(t.data).slice(0, dim));
  let s = 0;
  for (let i = 0; i < dim; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < dim; i++) v[i] /= s;
  return v;
}

let chain = Promise.resolve();
self.onmessage = (e) => {
  const { id, type } = e.data;
  // Una inferencia a la vez: el modelo no es reentrante.
  chain = chain.then(async () => {
    try {
      if (type === "init") postMessage({ id, ok: true, info: info ?? (await init(id, e.data.models)) });
      else if (type === "embed") {
        if (!session) throw new Error("Modelo sin cargar");
        const v = await embed(e.data.rgba, e.data.size);
        postMessage({ id, ok: true, vector: v }, [v.buffer]);
      }
    } catch (err) {
      postMessage({ id, ok: false, error: String(err?.message ?? err) });
    }
  });
};
