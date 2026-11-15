import type { Keyframe } from '../project/project.types';

// "Bounce" and "Elastic" settle on the next keyframe like an ease-out.
function easeOutBounce(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x - 1.5 / d1) * (x - 1.5 / d1) + 0.75;
  if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) * (x - 2.25 / d1) + 0.9375;

  return n1 * (x - 2.625 / d1) * (x - 2.625 / d1) + 0.984375;
}

function easeOutElastic(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  return 2 ** (-10 * x) * Math.sin(((x * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
}

export function evaluateProperty(
  keyframes: Keyframe[],
  time: number,
  fallback: number,
): number {
  if (!Number.isFinite(time)) return fallback;

  const sorted = keyframes
    .filter((keyframe) =>
      Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
    )
    .sort((a, b) => a.time - b.time);

  if (sorted.length === 0) return fallback;

  const normalized: Keyframe[] = [];
  for (const keyframe of sorted) {
    const previous = normalized[normalized.length - 1];
    if (previous && Math.abs(previous.time - keyframe.time) < 0.000001) {
      normalized[normalized.length - 1] = keyframe;
    } else {
      normalized.push(keyframe);
    }
  }

  if (time <= normalized[0].time) return normalized[0].value;
  const last = normalized[normalized.length - 1];
  if (time >= last.time) return last.value;

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const from = normalized[index];
    const to = normalized[index + 1];
    if (time < from.time || time > to.time) continue;

    const duration = to.time - from.time;
    if (duration <= 0 || from.interpolation === 'hold') return from.value;

    const rawProgress = Math.max(0, Math.min(1, (time - from.time) / duration));
    let progress = rawProgress;
    switch (from.interpolation) {
      case 'ease-in':
        progress = rawProgress * rawProgress;
        break;
      case 'ease-out':
        progress = 1 - (1 - rawProgress) ** 2;
        break;
      case 'ease-in-out':
        progress = rawProgress < 0.5
          ? 2 * rawProgress * rawProgress
          : 1 - ((-2 * rawProgress + 2) ** 2) / 2;
        break;
      case 'bounce':
        progress = easeOutBounce(rawProgress);
        break;
      case 'elastic':
        progress = easeOutElastic(rawProgress);
        break;
      case 'linear':
      default:
        progress = rawProgress;
    }

    return from.value + (to.value - from.value) * progress;
  }

  return fallback;
}
