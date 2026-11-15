// Preview resolution (Step 7B follow-up): how sharp the preview is drawn.
// Auto follows the size on screen; Full / Half / Third / Quarter are a share
// of the composition size. It only affects the preview, never the project.

export type PreviewResolution = 'auto' | 'full' | 'half' | 'third' | 'quarter';

export const PREVIEW_RESOLUTIONS: Array<{ value: PreviewResolution; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'full', label: 'Full' },
  { value: 'half', label: 'Half' },
  { value: 'third', label: 'Third' },
  { value: 'quarter', label: 'Quarter' },
];

const STORAGE_KEY = 'brx-editor-preview-resolution';

function readStored(): PreviewResolution {
  try {
    const value = localStorage.getItem(STORAGE_KEY);

    return PREVIEW_RESOLUTIONS.some((item) => item.value === value)
      ? (value as PreviewResolution)
      : 'auto';
  } catch {
    return 'auto';
  }
}

let current: PreviewResolution = readStored();
const listeners = new Set<() => void>();

export function getPreviewResolution(): PreviewResolution {
  return current;
}

export function setPreviewResolution(value: PreviewResolution): void {
  if (value === current) return;

  current = value;

  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Remembering the choice is a convenience only.
  }

  listeners.forEach((listener) => listener());
}

export function subscribePreviewResolution(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Share of the composition size, or null for Auto. */
export function getResolutionFactor(value: PreviewResolution): number | null {
  switch (value) {
    case 'full':
      return 1;
    case 'half':
      return 0.5;
    case 'third':
      return 1 / 3;
    case 'quarter':
      return 0.25;
    default:
      return null;
  }
}
