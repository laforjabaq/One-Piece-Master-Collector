"use client";
// Pitido corto (Web Audio, sin archivos) + vibración al leer una carta.
let ctx: AudioContext | null = null;

export function scanFeedback() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      ctx ??= new AC();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1320, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  } catch {
    /* sin audio */
  }
  try {
    navigator.vibrate?.(80);
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
