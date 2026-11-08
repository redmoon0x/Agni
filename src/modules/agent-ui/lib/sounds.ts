let context: AudioContext | null = null;
let lastPlayed = 0;
let unlocked = false;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/** Browsers start audio suspended; resume on the first user gesture. */
export function unlockAudio(): void {
  if (unlocked) return;
  const ctx = audioContext();
  if (!ctx) return;
  unlocked = true;
  void ctx.resume().catch(() => {});
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockAudio, { once: true });
}

/**
 * A single short completion chime, coalesced so a burst of events does not
 * stack sounds. The caller decides whether sound is enabled.
 */
export function playCompletionSound(enabled = true): void {
  if (!enabled) return;
  const now = Date.now();
  if (now - lastPlayed < 300) return;
  lastPlayed = now;
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.2);
}
