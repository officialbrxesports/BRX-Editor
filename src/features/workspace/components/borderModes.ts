// Border modes for image and video layers (Step 7B, Part 2A).
//
// clamp  : nothing outside the layer rectangle.
// extend : the outermost edge pixels are stretched out to the canvas edges
//          (streaks); the corner areas take the corner pixel colour.
// mirror : tiles across the whole canvas; neighbouring tiles are mirrored in
//          x and y, centred on the layer. A mirrored 2x2 tile is built once
//          per source and drawn with a pattern (no drawImage loops).

export type BorderMode = 'clamp' | 'extend' | 'mirror';

export type BorderSource = HTMLImageElement | HTMLVideoElement;

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const MAX_TILE_SIDE = 2048;

const tileCache = new WeakMap<
  BorderSource,
  { canvas: HTMLCanvasElement; key: string }
>();

function getSourceSize(media: BorderSource): { w: number; h: number } {
  if (media instanceof HTMLVideoElement) {
    return { w: media.videoWidth, h: media.videoHeight };
  }
  return { w: media.naturalWidth, h: media.naturalHeight };
}

// The visible canvas area, expressed in the layer's local coordinates.
function getLocalViewBounds(
  context: CanvasRenderingContext2D,
): Bounds | null {
  const inverse = context.getTransform().inverse();
  const width = context.canvas.width;
  const height = context.canvas.height;

  const points = [
    new DOMPoint(0, 0),
    new DOMPoint(width, 0),
    new DOMPoint(width, height),
    new DOMPoint(0, height),
  ].map((point) => inverse.transformPoint(point));

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 };
}

function drawExtended(
  context: CanvasRenderingContext2D,
  media: BorderSource,
  sourceWidth: number,
  sourceHeight: number,
  layerWidth: number,
  layerHeight: number,
  bounds: Bounds,
): void {
  const left = Math.min(bounds.minX, 0);
  const top = Math.min(bounds.minY, 0);
  const right = Math.max(bounds.maxX, layerWidth);
  const bottom = Math.max(bounds.maxY, layerHeight);
  const overlap = 0.5; // hides hairline seams; the centre is drawn last

  // Edge strips: a 1px column or row of the source, stretched outward.
  if (left < 0) {
    context.drawImage(
      media, 0, 0, 1, sourceHeight,
      left, 0, -left + overlap, layerHeight,
    );
  }
  if (right > layerWidth) {
    context.drawImage(
      media, sourceWidth - 1, 0, 1, sourceHeight,
      layerWidth - overlap, 0, right - layerWidth + overlap, layerHeight,
    );
  }
  if (top < 0) {
    context.drawImage(
      media, 0, 0, sourceWidth, 1,
      0, top, layerWidth, -top + overlap,
    );
  }
  if (bottom > layerHeight) {
    context.drawImage(
      media, 0, sourceHeight - 1, sourceWidth, 1,
      0, layerHeight - overlap, layerWidth, bottom - layerHeight + overlap,
    );
  }

  // Corner areas: one corner pixel, stretched.
  if (left < 0 && top < 0) {
    context.drawImage(media, 0, 0, 1, 1, left, top, -left, -top);
  }
  if (right > layerWidth && top < 0) {
    context.drawImage(
      media, sourceWidth - 1, 0, 1, 1,
      layerWidth, top, right - layerWidth, -top,
    );
  }
  if (left < 0 && bottom > layerHeight) {
    context.drawImage(
      media, 0, sourceHeight - 1, 1, 1,
      left, layerHeight, -left, bottom - layerHeight,
    );
  }
  if (right > layerWidth && bottom > layerHeight) {
    context.drawImage(
      media, sourceWidth - 1, sourceHeight - 1, 1, 1,
      layerWidth, layerHeight, right - layerWidth, bottom - layerHeight,
    );
  }

  context.drawImage(media, 0, 0, layerWidth, layerHeight);
}

// Builds (or reuses) the mirrored 2x2 tile for a source.
function getMirrorTile(
  media: BorderSource,
  sourceWidth: number,
  sourceHeight: number,
): { canvas: HTMLCanvasElement; tileWidth: number; tileHeight: number } | null {
  const shrink = Math.min(1, MAX_TILE_SIDE / Math.max(sourceWidth, sourceHeight));
  const tileWidth = Math.max(1, Math.round(sourceWidth * shrink));
  const tileHeight = Math.max(1, Math.round(sourceHeight * shrink));

  // Videos change every frame, images only when their size changes.
  const key =
    `${tileWidth}x${tileHeight}:` +
    (media instanceof HTMLVideoElement ? media.currentTime : 'still');

  const cached = tileCache.get(media);
  if (cached && cached.key === key) {
    return { canvas: cached.canvas, tileWidth, tileHeight };
  }

  const canvas = cached?.canvas ?? document.createElement('canvas');
  canvas.width = tileWidth * 2;
  canvas.height = tileHeight * 2;

  const tile = canvas.getContext('2d');
  if (!tile) return null;

  tile.drawImage(media, 0, 0, tileWidth, tileHeight);

  tile.save();
  tile.translate(tileWidth * 2, 0);
  tile.scale(-1, 1);
  tile.drawImage(media, 0, 0, tileWidth, tileHeight);
  tile.restore();

  tile.save();
  tile.translate(0, tileHeight * 2);
  tile.scale(1, -1);
  tile.drawImage(media, 0, 0, tileWidth, tileHeight);
  tile.restore();

  tile.save();
  tile.translate(tileWidth * 2, tileHeight * 2);
  tile.scale(-1, -1);
  tile.drawImage(media, 0, 0, tileWidth, tileHeight);
  tile.restore();

  tileCache.set(media, { canvas, key });
  return { canvas, tileWidth, tileHeight };
}

function drawMirrored(
  context: CanvasRenderingContext2D,
  media: BorderSource,
  sourceWidth: number,
  sourceHeight: number,
  layerWidth: number,
  layerHeight: number,
  bounds: Bounds,
): boolean {
  const tile = getMirrorTile(media, sourceWidth, sourceHeight);
  if (!tile) return false;

  const pattern = context.createPattern(tile.canvas, 'repeat');
  if (!pattern) return false;

  // One tile pixel = layerWidth / tileWidth layer units, so the unmirrored
  // quarter of the tile lands exactly on the layer rectangle.
  pattern.setTransform(
    new DOMMatrix().scale(
      layerWidth / tile.tileWidth,
      layerHeight / tile.tileHeight,
    ),
  );

  context.save();
  context.fillStyle = pattern;
  context.fillRect(
    bounds.minX,
    bounds.minY,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  );
  context.restore();
  return true;
}

/**
 * Draws an image or video frame into the layer rectangle (0,0,w,h) of the
 * current transform, honouring the layer's border mode.
 */
export function drawMediaWithBorder(
  context: CanvasRenderingContext2D,
  media: BorderSource,
  layerWidth: number,
  layerHeight: number,
  mode: BorderMode,
): void {
  if (mode === 'clamp') {
    context.drawImage(media, 0, 0, layerWidth, layerHeight);
    return;
  }

  const { w, h } = getSourceSize(media);
  const bounds = getLocalViewBounds(context);

  if (w < 1 || h < 1 || !bounds) {
    context.drawImage(media, 0, 0, layerWidth, layerHeight);
    return;
  }

  if (mode === 'extend') {
    drawExtended(context, media, w, h, layerWidth, layerHeight, bounds);
    return;
  }

  if (!drawMirrored(context, media, w, h, layerWidth, layerHeight, bounds)) {
    context.drawImage(media, 0, 0, layerWidth, layerHeight);
  }
}
