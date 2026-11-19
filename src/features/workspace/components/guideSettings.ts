// View aids of the preview: rulers, grid, guides and safe margins.
// They only help you place things; they are never drawn into the picture.
// Guide positions are in composition pixels.

export type PreviewGuides = {
  rulers: boolean;
  grid: boolean;
  safeMargins: boolean;
  snapGuides: boolean;
  snapGrid: boolean;
  guidesLocked: boolean;
  gridSize: number;
  /** x positions of vertical guides */
  v: number[];
  /** y positions of horizontal guides */
  h: number[];
};

export const GRID_SIZES = [25, 50, 100, 200];

const STORAGE_KEY = 'brx-editor-preview-guides';

const DEFAULTS: PreviewGuides = {
  rulers: false,
  grid: false,
  safeMargins: false,
  snapGuides: true,
  snapGrid: false,
  guidesLocked: false,
  gridSize: 100,
  v: [],
  h: [],
};

function readStored(): PreviewGuides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Partial<PreviewGuides>;
    const numbers = (value: unknown): number[] =>
      Array.isArray(value) ? value.filter((item) => Number.isFinite(item)) : [];

    return {
      ...DEFAULTS,
      rulers: parsed.rulers === true,
      grid: parsed.grid === true,
      safeMargins: parsed.safeMargins === true,
      snapGuides: parsed.snapGuides !== false,
      snapGrid: parsed.snapGrid === true,
      guidesLocked: parsed.guidesLocked === true,
      gridSize: GRID_SIZES.includes(parsed.gridSize as number)
        ? (parsed.gridSize as number)
        : DEFAULTS.gridSize,
      v: numbers(parsed.v),
      h: numbers(parsed.h),
    };
  } catch {
    return DEFAULTS;
  }
}

let current: PreviewGuides = readStored();
const listeners = new Set<() => void>();

export function getPreviewGuides(): PreviewGuides {
  return current;
}

export function subscribePreviewGuides(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Changes the view aids. The returned object is new, so React sees the change. */
export function updatePreviewGuides(change: Partial<PreviewGuides>): void {
  current = { ...current, ...change };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Remembering the guides is a convenience only.
  }

  listeners.forEach((listener) => listener());
}

type Axis = 'v' | 'h';

/** Adds a guide and returns its index. */
export function addGuide(axis: Axis, position: number): number {
  const next = [...current[axis], position];

  updatePreviewGuides({ [axis]: next } as Partial<PreviewGuides>);

  return next.length - 1;
}

export function moveGuide(axis: Axis, index: number, position: number): void {
  const next = [...current[axis]];

  if (index < 0 || index >= next.length) return;

  next[index] = position;
  updatePreviewGuides({ [axis]: next } as Partial<PreviewGuides>);
}

export function removeGuide(axis: Axis, index: number): void {
  updatePreviewGuides({
    [axis]: current[axis].filter((_, itemIndex) => itemIndex !== index),
  } as Partial<PreviewGuides>);
}

export function clearGuides(): void {
  updatePreviewGuides({ v: [], h: [] });
}
