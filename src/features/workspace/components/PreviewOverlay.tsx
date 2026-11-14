import { memo, useEffect, useRef } from 'react';

import type { EditorLayerProperties } from '../../project/project.types';

import type { WorldTransform } from './previewCanvas';

// Selection box, handles, rotation circle, snap guides and the live value
// bubble. It lives on its own layer above the composition, is NOT clipped by
// the composition edge, and only re-renders when the selected layer's
// transform changes. Guides and the bubble are updated directly on the DOM
// by the drag code (no React render per pointer move).

export type PreviewOverlayApi = {
  setGuides: (guides: { x: number | null; y: number | null } | null) => void;
  setBubble: (
    bubble: { text: string; clientX: number; clientY: number } | null,
  ) => void;
  setPointerType: (pointerType: string) => void;
};

type PreviewOverlayProps = {
  layer: EditorLayerProperties | null;
  world: WorldTransform | null;
  compWidth: number;
  compHeight: number;
  viewScale: number;
  interactive: boolean;
  apiRef: React.RefObject<PreviewOverlayApi | null>;
  onHandlePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
};

const HANDLES = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
] as const;

const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
const ROTATE_HANDLE_DISTANCE = 26;

// Cursor for a resize handle, following the layer's rotation and flips.
function getResizeCursor(
  dirX: number,
  dirY: number,
  signX: number,
  signY: number,
  rotationDegrees: number,
): string {
  const vx = dirX * signX;
  const vy = dirY * signY;
  const radians = (rotationDegrees * Math.PI) / 180;
  const x = vx * Math.cos(radians) - vy * Math.sin(radians);
  const y = vx * Math.sin(radians) + vy * Math.cos(radians);
  const angle = (((Math.atan2(y, x) * 180) / Math.PI) % 180 + 180) % 180;
  return RESIZE_CURSORS[Math.round(angle / 45) % 4];
}

function PreviewOverlay({
  layer,
  world,
  compWidth,
  compHeight,
  viewScale,
  interactive,
  apiRef,
  onHandlePointerDown,
}: PreviewOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const guideXRef = useRef<HTMLDivElement>(null);
  const guideYRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(viewScale);

  useEffect(() => {
    scaleRef.current = viewScale;
  });

  useEffect(() => {
    apiRef.current = {
      setGuides: (guides) => {
        const lineX = guideXRef.current;
        const lineY = guideYRef.current;

        if (lineX) {
          if (guides && guides.x !== null) {
            lineX.style.display = 'block';
            lineX.style.left = `${guides.x * scaleRef.current}px`;
          } else {
            lineX.style.display = 'none';
          }
        }

        if (lineY) {
          if (guides && guides.y !== null) {
            lineY.style.display = 'block';
            lineY.style.top = `${guides.y * scaleRef.current}px`;
          } else {
            lineY.style.display = 'none';
          }
        }
      },
      setBubble: (bubble) => {
        const element = bubbleRef.current;

        if (!element) {
          return;
        }

        if (!bubble) {
          element.style.display = 'none';
          return;
        }

        element.textContent = bubble.text;
        element.style.display = 'block';
        element.style.left = `${bubble.clientX + 16}px`;
        element.style.top = `${bubble.clientY + 16}px`;
      },
      setPointerType: (pointerType) => {
        const root = rootRef.current;
        const next =
          pointerType === 'touch' || pointerType === 'pen' ? 'touch' : 'mouse';

        if (root && root.dataset.pointer !== next) {
          root.dataset.pointer = next;
        }
      },
    };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  let outline: string | null = null;
  let rotateLine: { x1: number; y1: number; x2: number; y2: number } | null =
    null;
  let rotatePoint: { x: number; y: number } | null = null;
  const handlePoints: Array<{
    key: string;
    x: number;
    y: number;
    cursor: string;
    corner: boolean;
  }> = [];

  if (layer && world) {
    const anchorX = layer.anchorX ?? layer.width / 2;
    const anchorY = layer.anchorY ?? layer.height / 2;
    const rotation = world.rotation + (layer.orientationZ ?? 0);
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const signX = world.scaleX < 0 ? -1 : 1;
    const signY = world.scaleY < 0 ? -1 : 1;

    const toScreen = (localX: number, localY: number) => {
      const relX = (localX - anchorX) * world.scaleX;
      const relY = (localY - anchorY) * world.scaleY;
      return {
        x: (world.x + relX * cos - relY * sin) * viewScale,
        y: (world.y + relX * sin + relY * cos) * viewScale,
      };
    };

    const corners = [
      toScreen(0, 0),
      toScreen(layer.width, 0),
      toScreen(layer.width, layer.height),
      toScreen(0, layer.height),
    ];

    outline = corners.map((point) => `${point.x},${point.y}`).join(' ');

    for (const [key, fractionX, fractionY] of HANDLES) {
      const point = toScreen(fractionX * layer.width, fractionY * layer.height);
      handlePoints.push({
        key,
        x: point.x,
        y: point.y,
        cursor: getResizeCursor(
          fractionX === 0 ? -1 : fractionX === 1 ? 1 : 0,
          fractionY === 0 ? -1 : fractionY === 1 ? 1 : 0,
          signX,
          signY,
          rotation,
        ),
        corner: key.length === 2,
      });
    }

    const top = toScreen(layer.width / 2, 0);
    const centre = toScreen(layer.width / 2, layer.height / 2);
    let normalX = top.x - centre.x;
    let normalY = top.y - centre.y;
    const length = Math.hypot(normalX, normalY);

    if (length > 0.001) {
      normalX /= length;
      normalY /= length;
    } else {
      normalX = 0;
      normalY = -1;
    }

    rotatePoint = {
      x: top.x + normalX * ROTATE_HANDLE_DISTANCE,
      y: top.y + normalY * ROTATE_HANDLE_DISTANCE,
    };
    rotateLine = { x1: top.x, y1: top.y, x2: rotatePoint.x, y2: rotatePoint.y };
  }

  return (
    <div
      ref={rootRef}
      className="preview-overlay"
      data-pointer="mouse"
      style={{
        width: compWidth * viewScale,
        height: compHeight * viewScale,
      }}
    >
      {outline && (
        <svg className="preview-overlay-svg" aria-hidden="true">
          <polygon
            points={outline}
            className={layer?.locked ? 'is-locked' : undefined}
          />
          {interactive && rotateLine && (
            <line
              x1={rotateLine.x1}
              y1={rotateLine.y1}
              x2={rotateLine.x2}
              y2={rotateLine.y2}
            />
          )}
        </svg>
      )}

      {interactive && layer && (
        <>
          {handlePoints.map((handle) => (
            <button
              key={handle.key}
              type="button"
              className={`preview-handle ${handle.corner ? 'is-corner' : 'is-edge'}`}
              style={{
                left: handle.x,
                top: handle.y,
                cursor: handle.cursor,
              }}
              data-transform-handle="scale"
              data-corner={handle.key}
              aria-label={`Scale ${layer.name} from ${handle.key}`}
              onPointerDown={onHandlePointerDown}
            />
          ))}

          {rotatePoint && (
            <button
              type="button"
              className="preview-handle preview-handle-rotate"
              style={{ left: rotatePoint.x, top: rotatePoint.y }}
              data-transform-handle="rotate"
              aria-label={`Rotate ${layer.name}`}
              onPointerDown={onHandlePointerDown}
            />
          )}
        </>
      )}

      <div ref={guideXRef} className="preview-guide preview-guide-x" />
      <div ref={guideYRef} className="preview-guide preview-guide-y" />
      <div ref={bubbleRef} className="preview-drag-bubble" />
    </div>
  );
}

function sameLayer(
  a: EditorLayerProperties | null,
  b: EditorLayerProperties | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.width === b.width &&
    a.height === b.height &&
    a.anchorX === b.anchorX &&
    a.anchorY === b.anchorY &&
    a.orientationZ === b.orientationZ &&
    a.locked === b.locked
  );
}

function sameWorld(a: WorldTransform | null, b: WorldTransform | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.rotation === b.rotation &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY
  );
}

export default memo(
  PreviewOverlay,
  (previous, next) =>
    previous.compWidth === next.compWidth &&
    previous.compHeight === next.compHeight &&
    previous.viewScale === next.viewScale &&
    previous.interactive === next.interactive &&
    previous.apiRef === next.apiRef &&
    previous.onHandlePointerDown === next.onHandlePointerDown &&
    sameLayer(previous.layer, next.layer) &&
    sameWorld(previous.world, next.world),
);
