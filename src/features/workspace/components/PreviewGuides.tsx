import { useSyncExternalStore } from 'react';

import {
  getPreviewGuides,
  moveGuide,
  removeGuide,
  subscribePreviewGuides,
} from './guideSettings';

import './PreviewGuides.css';

// Grid, safe margins and guide lines, drawn over the composition. They sit
// in the same unclipped layer as the selection box, so a guide can be
// dragged even when it lies outside the picture.

type PreviewGuidesLayerProps = {
  compWidth: number;
  compHeight: number;
  viewScale: number;
};

const RULER_SIZE = 18;

export default function PreviewGuidesLayer({
  compWidth,
  compHeight,
  viewScale,
}: PreviewGuidesLayerProps) {
  const view = useSyncExternalStore(subscribePreviewGuides, getPreviewGuides);
  const width = compWidth * viewScale;
  const height = compHeight * viewScale;
  const gridStep = view.gridSize * viewScale;

  const beginGuideDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    axis: 'v' | 'h',
    index: number,
  ) => {
    if (view.guidesLocked || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const frame = event.currentTarget.parentElement;
    const stage = frame?.closest('.preview-stage');

    if (!frame || !stage) {
      return;
    }

    const target = event.currentTarget;
    const frameBounds = frame.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();

    target.setPointerCapture(event.pointerId);

    const positionOf = (clientX: number, clientY: number) =>
      axis === 'v'
        ? (clientX - frameBounds.left) / viewScale
        : (clientY - frameBounds.top) / viewScale;

    // Dragged back onto the ruler = delete the guide.
    const onRuler = (clientX: number, clientY: number) =>
      axis === 'v'
        ? clientX < stageBounds.left + RULER_SIZE
        : clientY < stageBounds.top + RULER_SIZE;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      moveGuide(axis, index, Math.round(positionOf(moveEvent.clientX, moveEvent.clientY)));
    };

    const onUp = (upEvent: globalThis.PointerEvent) => {
      target.releasePointerCapture?.(event.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);

      if (view.rulers && onRuler(upEvent.clientX, upEvent.clientY)) {
        removeGuide(axis, index);
      }
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className="preview-guides-layer"
      style={{ width, height }}
      aria-hidden="true"
    >
      {view.grid && gridStep >= 4 && (
        <div
          className="preview-grid"
          style={{
            width,
            height,
            backgroundSize: `${gridStep}px ${gridStep}px`,
          }}
        />
      )}

      {view.safeMargins && (
        <>
          <div
            className="preview-safe-margin"
            title="Action safe (90%)"
            style={{
              left: width * 0.05,
              top: height * 0.05,
              width: width * 0.9,
              height: height * 0.9,
            }}
          />
          <div
            className="preview-safe-margin is-title"
            title="Title safe (80%)"
            style={{
              left: width * 0.1,
              top: height * 0.1,
              width: width * 0.8,
              height: height * 0.8,
            }}
          />
        </>
      )}

      {view.v.map((position, index) => (
        <div
          key={`v-${index}`}
          className={'preview-guide-line is-vertical' + (view.guidesLocked ? ' is-locked' : '')}
          style={{ left: position * viewScale, height }}
          title={`Guide x = ${Math.round(position)} (drag to move, double-click to delete)`}
          onPointerDown={(event) => beginGuideDrag(event, 'v', index)}
          onDoubleClick={() => {
            if (!view.guidesLocked) removeGuide('v', index);
          }}
        />
      ))}

      {view.h.map((position, index) => (
        <div
          key={`h-${index}`}
          className={'preview-guide-line is-horizontal' + (view.guidesLocked ? ' is-locked' : '')}
          style={{ top: position * viewScale, width }}
          title={`Guide y = ${Math.round(position)} (drag to move, double-click to delete)`}
          onPointerDown={(event) => beginGuideDrag(event, 'h', index)}
          onDoubleClick={() => {
            if (!view.guidesLocked) removeGuide('h', index);
          }}
        />
      ))}
    </div>
  );
}
