"use client";
// Sonido de confirmación (Web Audio, sin archivos) + vibración al leer una carta.
let ctx: AudioContext | null = null;

export function scanFeedback() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      ctx ??= new AC();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      // "check" de éxito: dos notas cortas ascendentes (Mi6 → La6, quinta justa aprox.)
      const t = ctx.currentTime;
      const notes: [number, number][] = [[1318.5, 0], [1760, 0.09]];
      for (const [f, dt] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, t + dt);
        gain.gain.setValueAtTime(0.0001, t + dt);
        gain.gain.exponentialRampToValueAtTime(0.22, t + dt + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dt + (dt ? 0.22 : 0.1));
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + dt);
        osc.stop(t + dt + 0.24);
      }
    }
  } catch {
    /* sin audio */
  }
  try {
    navigator.vibrate?.([40, 40, 60]);
  } catch {
    /* sin vibración */
  }
}

// Desbloquea el audio en iOS/Chrome con el primer toque del usuario.
export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    /* nada */
  }
}
