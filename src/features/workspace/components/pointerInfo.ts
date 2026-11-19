// What is under the pointer in the preview: its position in the composition
// and the colour of the picture there (the Info panel shows it).

export type PointerInfo = {
  x: number;
  y: number;
  inside: boolean;
  r: number;
  g: number;
  b: number;
  a: number;
} | null;

let current: PointerInfo = null;
const listeners = new Set<() => void>();

export function getPointerInfo(): PointerInfo {
  return current;
}

export function subscribePointerInfo(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function setPointerInfo(next: PointerInfo): void {
  if (
    current &&
    next &&
    current.x === next.x &&
    current.y === next.y &&
    current.inside === next.inside &&
    current.r === next.r &&
    current.g === next.g &&
    current.b === next.b &&
    current.a === next.a
  ) {
    return;
  }

  current = next;
  listeners.forEach((listener) => listener());
}

let probe: CanvasRenderingContext2D | null = null;

/**
 * The colour of one pixel of the picture. It is copied into a tiny canvas of
 * its own first, so reading it never slows the preview canvas down.
 */
export function readPixel(
  source: HTMLCanvasElement,
  u: number,
  v: number,
): [number, number, number, number] | null {
  if (!probe) {
    const canvas = document.createElement('canvas');

    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext('2d', { willReadFrequently: true });
  }

  if (!probe || source.width < 1 || source.height < 1) {
    return null;
  }

  const x = Math.min(source.width - 1, Math.max(0, Math.floor(u * source.width)));
  const y = Math.min(source.height - 1, Math.max(0, Math.floor(v * source.height)));

  probe.clearRect(0, 0, 1, 1);
  probe.drawImage(source, x, y, 1, 1, 0, 0, 1, 1);

  const data = probe.getImageData(0, 0, 1, 1).data;

  return [data[0], data[1], data[2], data[3]];
}
