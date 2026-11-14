import {
  useCallback,
  useRef,
} from 'react';

import type {
  AnimatedPropertyName,
  EditorLayerProperties,
  EditorTool,
} from '../../project/project.types';

import type { PreviewOverlayApi } from './PreviewOverlay';
import type { WorldTransform } from './previewCanvas';

interface UsePreviewTransformOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  safeWidth: number;
  safeHeight: number;
  activeTool: EditorTool;
  overlayApiRef?: React.RefObject<PreviewOverlayApi | null>;
  // Rotation and scale of the layer this layer is linked to (null = none).
  getParentFrame?: (
    layer: EditorLayerProperties,
  ) => { rotation: number; scaleX: number; scaleY: number } | null;
  onSelectLayer?: (layerId: string | null) => void;
  onBeginLayerEdit: () => () => void;
  onLiveTransform?: (
    layerId: string,
    updates: Partial<EditorLayerProperties>,
    keyframeProperties?: AnimatedPropertyName[],
  ) => void;
}

interface TransformDrag {
  pointerId: number;
  pointerType: string;
  captureElement: HTMLElement;
  layer: EditorLayerProperties;
  mode: 'position' | 'scale' | 'rotate' | 'anchor';
  corner: string;
  startX: number;
  startY: number;
  startAngle: number;
  worldX: number;
  worldY: number;
  worldScaleX: number;
  worldScaleY: number;
  worldRotation: number;
  // Layer bounding box relative to its world position (comp pixels).
  boxMinX: number;
  boxMaxX: number;
  boxMinY: number;
  boxMaxY: number;
  moved: boolean;
  cancelEdit: (() => void) | null;
  pending: Partial<EditorLayerProperties> | null;
  frame: number | null;
}

// Snap distance in screen pixels.
const SNAP_DISTANCE = 6;

function quantizeTransform(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// The most recent sample of a pointer move (coalesced events when possible).
function getLatestSample(event: globalThis.PointerEvent): {
  clientX: number;
  clientY: number;
} {
  const samples =
    typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [];

  return samples.length > 0 ? samples[samples.length - 1] : event;
}

// Smallest distance from any of `features` to any of `targets`.
function findSnap(
  features: number[],
  targets: number[],
  threshold: number,
): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;

  for (const feature of features) {
    for (const target of targets) {
      const delta = target - feature;

      if (
        Math.abs(delta) <= threshold &&
        (!best || Math.abs(delta) < Math.abs(best.delta))
      ) {
        best = { delta, target };
      }
    }
  }

  return best;
}

export function usePreviewTransform({
  canvasRef,
  safeWidth,
  safeHeight,
  activeTool,
  overlayApiRef,
  getParentFrame,
  onSelectLayer,
  onBeginLayerEdit,
  onLiveTransform,
}: UsePreviewTransformOptions) {
  const transformDragRef = useRef<TransformDrag | null>(null);
  const abortDragRef = useRef<(() => void) | null>(null);

  const callbacksRef = useRef({
    onBeginLayerEdit,
    onLiveTransform,
    getParentFrame,
  });

  callbacksRef.current = {
    onBeginLayerEdit,
    onLiveTransform,
    getParentFrame,
  };

  // Used by pinch zoom: a second finger cancels a drag that already began.
  const cancelActiveTransform = useCallback(() => {
    abortDragRef.current?.();
  }, []);

  const beginLayerTransform = useCallback((
    event: React.PointerEvent<HTMLElement>,
    layer: EditorLayerProperties,
    world: WorldTransform,
    anchorX: number,
    anchorY: number,
  ) => {
    if (
      layer.locked ||
      (activeTool !== 'select' && activeTool !== 'anchor')
    ) {
      return;
    }

    // Only the primary mouse button drags.
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest('textarea')) {
      return;
    }

    const target = event.target as HTMLElement;

    const handle = target.closest<HTMLElement>(
      '[data-transform-handle]',
    );

    const mode =
      activeTool === 'anchor'
        ? 'anchor'
        : handle?.dataset.transformHandle === 'scale'
          ? 'scale'
          : handle?.dataset.transformHandle === 'rotate'
            ? 'rotate'
            : 'position';

    event.preventDefault();
    event.stopPropagation();

    onSelectLayer?.(layer.id);

    const captureElement = event.currentTarget;

    captureElement.setPointerCapture(event.pointerId);

    const bounds = canvasRef.current?.getBoundingClientRect();

    const scale = bounds
      ? bounds.width / safeWidth
      : 1;

    const anchorClientX =
      (bounds?.left ?? 0) +
      (world.x / safeWidth) *
        (bounds?.width ?? safeWidth);

    const anchorClientY =
      (bounds?.top ?? 0) +
      (world.y / safeHeight) *
        (bounds?.height ?? safeHeight);

    const startAngle = Math.atan2(
      event.clientY - anchorClientY,
      event.clientX - anchorClientX,
    );

    // A linked layer keeps its position in the linked layer's own frame, so
    // a movement on screen is converted back into that frame.
    const parentFrame =
      callbacksRef.current.getParentFrame?.(layer) ?? null;

    const toParentFrame = (
      vectorX: number,
      vectorY: number,
    ): { x: number; y: number } => {
      if (!parentFrame) {
        return { x: vectorX, y: vectorY };
      }

      const radians = (parentFrame.rotation * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const parentScaleX =
        Math.abs(parentFrame.scaleX) < 0.0001 ? 1 : parentFrame.scaleX;
      const parentScaleY =
        Math.abs(parentFrame.scaleY) < 0.0001 ? 1 : parentFrame.scaleY;

      return {
        x: (vectorX * cos + vectorY * sin) / parentScaleX,
        y: (-vectorX * sin + vectorY * cos) / parentScaleY,
      };
    };

    // Bounding box of the transformed layer, relative to its position.
    const boxRadians =
      ((world.rotation + (layer.orientationZ ?? 0)) * Math.PI) / 180;
    const boxCos = Math.cos(boxRadians);
    const boxSin = Math.sin(boxRadians);
    let boxMinX = Number.POSITIVE_INFINITY;
    let boxMaxX = Number.NEGATIVE_INFINITY;
    let boxMinY = Number.POSITIVE_INFINITY;
    let boxMaxY = Number.NEGATIVE_INFINITY;

    for (const [localX, localY] of [
      [0, 0],
      [layer.width, 0],
      [layer.width, layer.height],
      [0, layer.height],
    ]) {
      const relX = (localX - anchorX) * world.scaleX;
      const relY = (localY - anchorY) * world.scaleY;
      const px = relX * boxCos - relY * boxSin;
      const py = relX * boxSin + relY * boxCos;
      boxMinX = Math.min(boxMinX, px);
      boxMaxX = Math.max(boxMaxX, px);
      boxMinY = Math.min(boxMinY, py);
      boxMaxY = Math.max(boxMaxY, py);
    }

    transformDragRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      captureElement,
      layer,
      mode,
      corner: handle?.dataset.corner ?? 'se',
      startX: event.clientX,
      startY: event.clientY,
      startAngle,
      worldX: world.x,
      worldY: world.y,
      worldScaleX: world.scaleX,
      worldScaleY: world.scaleY,
      worldRotation: world.rotation,
      boxMinX,
      boxMaxX,
      boxMinY,
      boxMaxY,
      moved: false,
      cancelEdit: null,
      pending: null,
      frame: null,
    };

    const hideFeedback = () => {
      overlayApiRef?.current?.setGuides(null);
      overlayApiRef?.current?.setBubble(null);
    };

    const onMove = (nativeEvent: globalThis.PointerEvent) => {
      const drag = transformDragRef.current;

      if (
        !drag ||
        nativeEvent.pointerId !== drag.pointerId
      ) {
        return;
      }

      const sample = getLatestSample(nativeEvent);

      let dx =
        (sample.clientX - drag.startX) /
        Math.max(0.001, scale);

      let dy =
        (sample.clientY - drag.startY) /
        Math.max(0.001, scale);

      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.01) {
        return;
      }

      drag.moved = true;

      if (!drag.cancelEdit) {
        drag.cancelEdit =
          callbacksRef.current.onBeginLayerEdit();
      }

      // Touch: keep the bubble above the finger.
      const bubbleY =
        drag.pointerType === 'touch'
          ? sample.clientY - 64
          : sample.clientY;

      let updates: Partial<EditorLayerProperties>;

      if (drag.mode === 'position') {
        let guideX: number | null = null;
        let guideY: number | null = null;

        // Snap to the composition centre and edges. Alt or Shift = off.
        if (!nativeEvent.altKey && !nativeEvent.shiftKey) {
          const threshold = SNAP_DISTANCE / Math.max(0.001, scale);
          const positionX = drag.worldX + dx;
          const positionY = drag.worldY + dy;

          const snapX = findSnap(
            [
              positionX,
              positionX + drag.boxMinX,
              positionX + drag.boxMaxX,
              positionX + (drag.boxMinX + drag.boxMaxX) / 2,
            ],
            [0, safeWidth / 2, safeWidth],
            threshold,
          );

          const snapY = findSnap(
            [
              positionY,
              positionY + drag.boxMinY,
              positionY + drag.boxMaxY,
              positionY + (drag.boxMinY + drag.boxMaxY) / 2,
            ],
            [0, safeHeight / 2, safeHeight],
            threshold,
          );

          if (snapX) {
            dx += snapX.delta;
            guideX = snapX.target;
          }

          if (snapY) {
            dy += snapY.delta;
            guideY = snapY.target;
          }
        }

        const moved = toParentFrame(dx, dy);

        updates = {
          x: quantizeTransform(layer.x + moved.x),
          y: quantizeTransform(layer.y + moved.y),
        };

        overlayApiRef?.current?.setGuides({ x: guideX, y: guideY });
        overlayApiRef?.current?.setBubble({
          text: `X: ${Math.round(layer.x + moved.x)}   Y: ${Math.round(layer.y + moved.y)}`,
          clientX: sample.clientX,
          clientY: bubbleY,
        });
      } else if (drag.mode === 'anchor') {
        const radians =
          (drag.worldRotation * Math.PI) / 180;

        const localDX =
          (
            dx * Math.cos(radians) +
            dy * Math.sin(radians)
          ) /
          Math.max(0.001, Math.abs(drag.worldScaleX));

        const localDY =
          (
            -dx * Math.sin(radians) +
            dy * Math.cos(radians)
          ) /
          Math.max(0.001, Math.abs(drag.worldScaleY));

        const nextAnchorX = quantizeTransform(
          anchorX + localDX,
        );

        const nextAnchorY = quantizeTransform(
          anchorY + localDY,
        );

        // How far the anchor move shifts the layer on screen, converted
        // back into the layer's own (linked) frame.
        const shifted = toParentFrame(
          localDX * drag.worldScaleX * Math.cos(radians) -
            localDY * drag.worldScaleY * Math.sin(radians),
          localDX * drag.worldScaleX * Math.sin(radians) +
            localDY * drag.worldScaleY * Math.cos(radians),
        );

        updates = {
          anchorX: nextAnchorX,
          anchorY: nextAnchorY,
          x: quantizeTransform(layer.x + shifted.x),
          y: quantizeTransform(layer.y + shifted.y),
        };
      } else if (drag.mode === 'rotate') {
        const currentAngle = Math.atan2(
          sample.clientY - anchorClientY,
          sample.clientX - anchorClientX,
        );

        let rotation =
          layer.rotation +
          (currentAngle - drag.startAngle) *
            180 /
            Math.PI;

        if (nativeEvent.shiftKey) {
          rotation = Math.round(rotation / 45) * 45;
        }

        updates = {
          rotation: quantizeTransform(rotation),
        };

        overlayApiRef?.current?.setBubble({
          text: `Rotation: ${rotation.toFixed(1)}°`,
          clientX: sample.clientX,
          clientY: bubbleY,
        });
      } else {
        // Scale. Handles: corners (nw ne se sw) and edges (n e s w).
        const signX = drag.corner.includes('w')
          ? -1
          : drag.corner.includes('e')
            ? 1
            : 0;

        const signY = drag.corner.includes('n')
          ? -1
          : drag.corner.includes('s')
            ? 1
            : 0;

        // Pointer movement along the layer's own axes (comp pixels).
        const worldRadians =
          (drag.worldRotation * Math.PI) / 180;

        const axisX =
          dx * Math.cos(worldRadians) +
          dy * Math.sin(worldRadians);

        const axisY =
          -dx * Math.sin(worldRadians) +
          dy * Math.cos(worldRadians);

        // The handle's outward direction flips with a mirrored layer.
        const flipX = drag.worldScaleX < 0 ? -1 : 1;
        const flipY = drag.worldScaleY < 0 ? -1 : 1;

        const shownWidth = Math.max(
          1,
          layer.width * Math.abs(drag.worldScaleX),
        );

        const shownHeight = Math.max(
          1,
          layer.height * Math.abs(drag.worldScaleY),
        );

        let ratioX =
          signX === 0
            ? 1
            : Math.max(
                0.01,
                1 + (signX * flipX * axisX) / shownWidth,
              );

        let ratioY =
          signY === 0
            ? 1
            : Math.max(
                0.01,
                1 + (signY * flipY * axisY) / shownHeight,
              );

        // Shift keeps the proportions (corner handles only).
        if (nativeEvent.shiftKey && signX !== 0 && signY !== 0) {
          const ratio =
            Math.abs(ratioX - 1) >=
            Math.abs(ratioY - 1)
              ? ratioX
              : ratioY;

          ratioX = ratio;
          ratioY = ratio;
        }

        const scaleX = (layer.scaleX ?? 100) * ratioX;
        const scaleY = (layer.scaleY ?? 100) * ratioY;

        // The edge or corner opposite the handle stays where it is.
        const opposite = {
          x: signX < 0 ? layer.width : 0,
          y: signY < 0 ? layer.height : 0,
        };

        const localAnchorX =
          layer.anchorX ?? layer.width / 2;

        const localAnchorY =
          layer.anchorY ?? layer.height / 2;

        const rotation =
          (layer.rotation * Math.PI) / 180;

        const transformedOffset = (
          nextScaleX: number,
          nextScaleY: number,
        ) => {
          const x =
            (opposite.x - localAnchorX) *
            nextScaleX /
            100;

          const y =
            (opposite.y - localAnchorY) *
            nextScaleY /
            100;

          return {
            x:
              x * Math.cos(rotation) -
              y * Math.sin(rotation),

            y:
              x * Math.sin(rotation) +
              y * Math.cos(rotation),
          };
        };

        const oldOffset = transformedOffset(
          layer.scaleX ?? 100,
          layer.scaleY ?? 100,
        );

        const newOffset = transformedOffset(
          scaleX,
          scaleY,
        );

        updates = {
          scaleX: quantizeTransform(scaleX),
          scaleY: quantizeTransform(scaleY),

          ...(nativeEvent.altKey
            ? {}
            : {
                x: quantizeTransform(
                  layer.x +
                    oldOffset.x -
                    newOffset.x,
                ),

                y: quantizeTransform(
                  layer.y +
                    oldOffset.y -
                    newOffset.y,
                ),
              }),
        };

        overlayApiRef?.current?.setBubble({
          text: `Scale: ${Math.round(scaleX)}%, ${Math.round(scaleY)}%`,
          clientX: sample.clientX,
          clientY: bubbleY,
        });
      }

      drag.pending = updates;

      if (drag.frame !== null) {
        cancelAnimationFrame(drag.frame);
      }

      drag.frame = requestAnimationFrame(() => {
        const current = transformDragRef.current;

        if (current?.pending) {
          callbacksRef.current.onLiveTransform?.(
            layer.id,
            current.pending,
          );

          current.frame = null;
        }
      });
    };

    const removeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
    };

    const releaseCapture = (drag: TransformDrag) => {
      if (
        drag.captureElement.hasPointerCapture(
          drag.pointerId,
        )
      ) {
        drag.captureElement.releasePointerCapture(
          drag.pointerId,
        );
      }
    };

    // Throws the drag away and restores the layer (Escape, second finger).
    const abortDrag = () => {
      const drag = transformDragRef.current;

      if (!drag) {
        return;
      }

      if (drag.frame !== null) {
        cancelAnimationFrame(drag.frame);
      }

      drag.cancelEdit?.();
      releaseCapture(drag);
      hideFeedback();

      transformDragRef.current = null;
      abortDragRef.current = null;
      removeListeners();
    };

    abortDragRef.current = abortDrag;

    const finish = (
      nativeEvent: globalThis.PointerEvent,
      cancel: boolean,
    ) => {
      const drag = transformDragRef.current;

      if (
        !drag ||
        nativeEvent.pointerId !== drag.pointerId
      ) {
        return;
      }

      if (drag.frame !== null) {
        cancelAnimationFrame(drag.frame);
      }

      if (cancel) {
        drag.cancelEdit?.();
      } else if (drag.pending) {
        const keyframes: Partial<
          Record<
            keyof EditorLayerProperties,
            AnimatedPropertyName
          >
        > = {
          x: 'positionX',
          y: 'positionY',
          scaleX: 'scaleX',
          scaleY: 'scaleY',
          rotation: 'rotation',
          anchorX: 'anchorX',
          anchorY: 'anchorY',
        };

        const names = Object.keys(drag.pending)
          .map(
            (key) =>
              keyframes[
                key as keyof EditorLayerProperties
              ],
          )
          .filter(
            (name): name is AnimatedPropertyName =>
              Boolean(name),
          );

        callbacksRef.current.onLiveTransform?.(
          layer.id,
          drag.pending,
          names,
        );
      }

      releaseCapture(drag);
      hideFeedback();

      transformDragRef.current = null;
      abortDragRef.current = null;
      removeListeners();
    };

    const onUp = (nativeEvent: globalThis.PointerEvent) => {
      finish(nativeEvent, false);
    };

    const onCancel = (
      nativeEvent: globalThis.PointerEvent,
    ) => {
      finish(nativeEvent, true);
    };

    const onKeyDown = (
      nativeEvent: globalThis.KeyboardEvent,
    ) => {
      if (
        nativeEvent.key === 'Escape' &&
        transformDragRef.current?.moved
      ) {
        nativeEvent.preventDefault();
        abortDrag();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
  }, [
    activeTool,
    canvasRef,
    onSelectLayer,
    overlayApiRef,
    safeHeight,
    safeWidth,
  ]);

  return {
    beginLayerTransform,
    cancelActiveTransform,
  };
}
