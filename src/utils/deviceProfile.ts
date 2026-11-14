import {
  DEVICE_WARNING_THRESHOLDS,
  MAX_FPS,
  MAX_RESOLUTION,
  MIN_FPS,
  MIN_RESOLUTION,
  WARNING_TEXT,
  type DeviceWarningThreshold,
} from '../config';

export type DeviceKind = 'mobile' | 'desktop';
export type DeviceTier = 'low' | 'normal' | 'high';

export type DeviceProfile = {
  kind: DeviceKind;
  tier: DeviceTier;
};

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

let cachedProfile: DeviceProfile | null = null;

function detectKind(): DeviceKind {
  if (typeof window === 'undefined') return 'desktop';
  const coarse =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const touchPhone =
    (navigator.maxTouchPoints ?? 0) > 0 &&
    Math.min(window.innerWidth, window.innerHeight) <= 820;
  return coarse || touchPhone ? 'mobile' : 'desktop';
}

function detectTier(): DeviceTier {
  if (typeof navigator === 'undefined') return 'normal';
  const memory = (navigator as NavigatorWithMemory).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (
    (memory !== undefined && memory <= 2) ||
    (cores !== undefined && cores <= 2)
  ) {
    return 'low';
  }
  if (
    memory !== undefined &&
    cores !== undefined &&
    memory >= 8 &&
    cores >= 8
  ) {
    return 'high';
  }
  return 'normal';
}

export function getDeviceProfile(): DeviceProfile {
  if (!cachedProfile) {
    cachedProfile = { kind: detectKind(), tier: detectTier() };
  }
  return cachedProfile;
}

export function getWarningThreshold(
  profile: DeviceProfile = getDeviceProfile(),
): DeviceWarningThreshold {
  if (profile.kind === 'mobile') return DEVICE_WARNING_THRESHOLDS.mobile;
  if (profile.tier === 'low') return DEVICE_WARNING_THRESHOLDS.desktopLow;
  if (profile.tier === 'high') return DEVICE_WARNING_THRESHOLDS.desktopHigh;
  return DEVICE_WARNING_THRESHOLDS.desktopNormal;
}

export function clampResolution(value: number): number {
  if (!Number.isFinite(value)) return MIN_RESOLUTION;
  return Math.max(MIN_RESOLUTION, Math.min(MAX_RESOLUTION, Math.round(value)));
}

export function clampFps(value: number): number {
  if (!Number.isFinite(value)) return MIN_FPS;
  return Math.max(MIN_FPS, Math.min(MAX_FPS, value));
}

/** Non-blocking warning messages for the given project settings. */
export function getSettingsWarnings(
  width: number,
  height: number,
  fps: number,
  profile: DeviceProfile = getDeviceProfile(),
): string[] {
  const threshold = getWarningThreshold(profile);
  const highResolution = Math.max(width, height) > threshold.resolution;
  const highFps = fps > threshold.fps;
  const messages: string[] = [];

  if (profile.kind === 'mobile') {
    if (highResolution) messages.push(WARNING_TEXT.resolution);
    if (highFps) messages.push(WARNING_TEXT.fps);
  } else if (highResolution || highFps) {
    messages.push(WARNING_TEXT.desktop);
  }
  return messages;
}
