import type { EditorLayerProperties } from '../../project/project.types';

/**
 * Calculates the timeline duration of one layer.
 *
 * stretch = 100 -> normal speed
 * stretch = 200 -> twice the timeline duration
 * stretch = 50  -> half the timeline duration
 */
export function getLayerTimelineDuration(
  layer: EditorLayerProperties,
): number {
  const startTime =
    typeof layer.startTime === 'number' &&
    Number.isFinite(layer.startTime)
      ? Math.max(0, layer.startTime)
      : 0;

  const inPoint =
    typeof layer.inPoint === 'number' &&
    Number.isFinite(layer.inPoint)
      ? Math.max(0, layer.inPoint)
      : 0;

  const outPoint =
    typeof layer.outPoint === 'number' &&
    Number.isFinite(layer.outPoint)
      ? Math.max(inPoint, layer.outPoint)
      : inPoint;

  const stretch =
    typeof layer.stretch === 'number' &&
    Number.isFinite(layer.stretch) &&
    layer.stretch > 0
      ? layer.stretch
      : 100;

  return startTime + (outPoint - inPoint) * (stretch / 100);
}

/**
 * Calculates composition duration from all current layers.
 * Empty composition = 0 seconds.
 */
export function getCompositionDuration(
  layers: EditorLayerProperties[],
): number {
  let maximumDuration = 0;

  for (const layer of layers) {
    const endTime = getLayerTimelineDuration(layer);

    if (Number.isFinite(endTime)) {
      maximumDuration = Math.max(maximumDuration, endTime);
    }
  }

  return maximumDuration;
}

/**
 * Recalculates the duration instead of retaining stale duration.
 */
export function expandCompositionDuration(
  _currentDuration: number,
  layers: EditorLayerProperties[],
): number {
  return getCompositionDuration(layers);
}