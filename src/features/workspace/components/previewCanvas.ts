import type { EditorLayerProperties } from '../../project/project.types';

import { drawMediaWithBorder } from './borderModes';

export type WorldTransform = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

export function getWorldTransform(
  layer: EditorLayerProperties,
  layers: EditorLayerProperties[],
  compWidth: number,
  compHeight: number,
  depth = 0,
): WorldTransform {
  const local = {
    x: layer.x,
    y: layer.y,
    rotation: layer.rotation,
    scaleX: (layer.scaleX ?? 100) / 100,
    scaleY: (layer.scaleY ?? 100) / 100,
  };

  if ((!layer.parentId && !layer.groupId) || depth > layers.length) {
    return local;
  }

  // Link To replaces the group's transform; otherwise the group applies.
  const parent =
    layers.find((candidate) => candidate.id === layer.parentId) ??
    layers.find((candidate) => candidate.id === layer.groupId);

  if (!parent) {
    return local;
  }

  const world = getWorldTransform(
    parent,
    layers,
    compWidth,
    compHeight,
    depth + 1,
  );

  const radians = (world.rotation * Math.PI) / 180;
  const offsetX = (local.x - compWidth / 2) * world.scaleX;
  const offsetY = (local.y - compHeight / 2) * world.scaleY;

  return {
    x: world.x + offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
    y: world.y + offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
    rotation: world.rotation + local.rotation,
    scaleX: world.scaleX * local.scaleX,
    scaleY: world.scaleY * local.scaleY,
  };
}

export function quantizeTransform(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function getCssBlendMode(
  mode: EditorLayerProperties['blendMode'],
): string {
  switch (mode) {
    case 'normal':
    case 'dissolve':
      return 'normal';
    case 'linear-burn':
      return 'multiply';
    case 'linear-dodge':
      return 'plus-lighter';
    case 'vivid-light':
    case 'linear-light':
    case 'pin-light':
      return 'hard-light';
    default:
      return mode ?? 'normal';
  }
}

export function getCanvasCompositeMode(
  mode: EditorLayerProperties['blendMode'],
): GlobalCompositeOperation {
  switch (mode) {
    case 'normal':
    case 'dissolve':
      return 'source-over';
    case 'linear-burn':
      return 'multiply';
    case 'linear-dodge':
      return 'lighter';
    case 'vivid-light':
    case 'linear-light':
    case 'pin-light':
      return 'hard-light';
    default:
      return mode ?? 'source-over';
  }
}

export function getLayerCanvasFilter(
  layer: EditorLayerProperties,
  isPlaying: boolean,
  frameBlendingEnabled: boolean,
  motionBlurEnabled: boolean,
): string {
  const filters = [
    motionBlurEnabled && isPlaying && layer.motionBlur
      ? 'blur(0.6px)'
      : '',
    frameBlendingEnabled && isPlaying && layer.frameBlending
      ? 'blur(0.2px)'
      : '',
  ].filter(Boolean);

  return filters.length ? filters.join(' ') : 'none';
}

const lastVideoFrames = new WeakMap<
  HTMLVideoElement,
  { canvas: HTMLCanvasElement; savedAt: number }
>();

const VIDEO_SNAPSHOT_INTERVAL_MS = 200;
const VIDEO_SNAPSHOT_MAX_WIDTH = 640;

// Keeps a small copy of the last good video frame, so the viewer shows
// that frame (instead of black) while the video is seeking.
function rememberVideoFrame(video: HTMLVideoElement): void {
  const now = performance.now();
  let entry = lastVideoFrames.get(video);

  if (entry && now - entry.savedAt < VIDEO_SNAPSHOT_INTERVAL_MS) {
    return;
  }

  if (!entry) {
    entry = { canvas: document.createElement('canvas'), savedAt: 0 };
    lastVideoFrames.set(video, entry);
  }

  const width = Math.max(1, Math.min(video.videoWidth, VIDEO_SNAPSHOT_MAX_WIDTH));
  const height = Math.max(
    1,
    Math.round((width * video.videoHeight) / video.videoWidth),
  );

  if (entry.canvas.width !== width || entry.canvas.height !== height) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  }

  const snapshotContext = entry.canvas.getContext('2d');

  if (!snapshotContext) {
    return;
  }

  try {
    snapshotContext.drawImage(video, 0, 0, width, height);
    entry.savedAt = now;
  } catch {
    // Ignore: the frame is simply not saved this time.
  }
}

export function drawLayerCanvas(
  context: CanvasRenderingContext2D,
  layer: EditorLayerProperties,
  layers: EditorLayerProperties[],
  width: number,
  height: number,
  media: HTMLImageElement | HTMLVideoElement | undefined,
): void {
  const world = getWorldTransform(
    layer,
    layers,
    width,
    height,
  );

  const anchorX = layer.anchorX ?? layer.width / 2;
  const anchorY = layer.anchorY ?? layer.height / 2;
  const is3D = layer.threeDLayer === true;

  const perspectiveScale = is3D
    ? 2000 / Math.max(100, 2000 - (layer.z ?? 0))
    : 1;

  const rotationX =
    ((layer.orientationX ?? 0) + (layer.rotationX ?? 0)) *
    Math.PI / 180;

  const rotationY =
    ((layer.orientationY ?? 0) + (layer.rotationY ?? 0)) *
    Math.PI / 180;

  context.save();

  context.globalAlpha = Math.max(
    0,
    Math.min(1, layer.opacity / 100),
  );

  context.translate(world.x, world.y);

  context.rotate(
    (
      world.rotation +
      (is3D ? layer.orientationZ ?? 0 : 0)
    ) * Math.PI / 180,
  );

  context.scale(
    world.scaleX *
      perspectiveScale *
      (is3D ? Math.cos(rotationY) : 1),
    world.scaleY *
      perspectiveScale *
      (is3D ? Math.cos(rotationX) : 1),
  );

  context.translate(-anchorX, -anchorY);

  if (layer.type === 'image' && media instanceof HTMLImageElement) {
    if (media.complete && media.naturalWidth > 0) {
      drawMediaWithBorder(
        context,
        media,
        layer.width,
        layer.height,
        layer.borderMode ?? 'clamp',
      );
    }
  } else if (
    layer.type === 'video' &&
    media instanceof HTMLVideoElement
  ) {
    if (
      media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      media.videoWidth > 0 &&
      media.videoHeight > 0
    ) {
      drawMediaWithBorder(
        context,
        media,
        layer.width,
        layer.height,
        layer.borderMode ?? 'clamp',
      );

      rememberVideoFrame(media);
    } else {
      const lastFrame = lastVideoFrames.get(media);

      if (lastFrame) {
        context.drawImage(
          lastFrame.canvas,
          0,
          0,
          layer.width,
          layer.height,
        );
      }
    }
  } else if (layer.type === 'text') {
    context.fillStyle = '#fff';
    context.font =
      `700 ${Math.max(48, height * 0.05)}px "Segoe UI", Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.fillText(
      layer.text ?? layer.name,
      layer.width / 2,
      layer.height / 2,
      layer.width,
    );
  } else if (
    layer.type !== 'audio' &&
    layer.type !== 'null' &&
    layer.type !== 'camera' &&
    layer.type !== 'light' &&
    layer.type !== 'image' &&
    layer.type !== 'video'
  ) {
    const gradient = context.createLinearGradient(
      0,
      0,
      layer.width,
      layer.height,
    );

    gradient.addColorStop(0, '#8b5cf6');
    gradient.addColorStop(1, '#5b21b6');

    context.fillStyle = gradient;
    context.fillRect(0, 0, layer.width, layer.height);
  }

  context.restore();
}