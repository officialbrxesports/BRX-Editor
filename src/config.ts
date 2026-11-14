// Project-wide limits and device warning thresholds (Step 7B).
// Warning thresholds are placeholders: tune them here, nowhere else.

export const MAX_RESOLUTION = 7680; // 8K per side
export const MIN_RESOLUTION = 1;
export const MAX_FPS = 120;
export const MIN_FPS = 30;

export type DeviceWarningThreshold = {
  /** Warn when width OR height is above this many pixels. */
  resolution: number;
  /** Warn when the frame rate is above this value. */
  fps: number;
};

export const DEVICE_WARNING_THRESHOLDS = {
  mobile: { resolution: 1920, fps: 35 },
  desktopLow: { resolution: 1920, fps: 30 },
  desktopNormal: { resolution: 3840, fps: 60 },
  // High-end desktops: no warning up to 4K and 60 fps; resolution is
  // only capped by MAX_RESOLUTION, so there is no resolution warning.
  desktopHigh: { resolution: MAX_RESOLUTION, fps: 60 },
} as const satisfies Record<string, DeviceWarningThreshold>;

export const WARNING_TEXT = {
  resolution:
    'High resolutions may cause crashes and may not display on some devices after export.',
  fps: 'High FPS will impact the previewing speed',
  desktop: 'Very high settings may be slow on this device',
} as const;

// Preview canvas backing store (Part 2A). The backing store follows the
// on-screen size times devicePixelRatio but never exceeds these caps, so an
// 8K project cannot crash the preview.
export const PREVIEW_MAX_BACKING_SIDE = 4096;
export const PREVIEW_MAX_BACKING_PIXELS = 4096 * 2304;
export const PLAYBACK_BACKING_SIDE = 1920; // lower cap while playing
export const PLAYBACK_MAX_FPS = 60;
