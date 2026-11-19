// How long drawing one preview frame takes (shown as "Frame Render Time").
// The number is smoothed, and listeners are told at most four times a second,
// so showing it never costs the speed it measures.

let value = 0;
let lastNotify = 0;
const listeners = new Set<() => void>();

export function reportRenderTime(milliseconds: number): void {
  value = value === 0 ? milliseconds : value * 0.8 + milliseconds * 0.2;

  const now = performance.now();

  if (now - lastNotify < 250) {
    return;
  }

  lastNotify = now;
  listeners.forEach((listener) => listener());
}

export function getRenderTime(): number {
  return Math.round(value);
}

export function subscribeRenderTime(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
