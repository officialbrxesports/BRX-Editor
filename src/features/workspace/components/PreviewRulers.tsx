import { useEffect, useRef } from 'react';

import { addGuide, moveGuide, removeGuide, getPreviewGuides } from './previewGuides';

import './PreviewGuides.css';

// Pixel rulers along the top and left edge of the viewer. They follow the
// zoom and scroll of the composition. Drag from a ruler to pull out a guide.

type PreviewRulersProps = {
  stageRef: React.RefObject<HTMLDivElement | null>;
  panelRef: React.RefObject<HTMLElement | null>;
  viewScale: number;
  compWidth: number;
  compHeight: number;
};

const RULER_SIZE = 18;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

function pickStep(scale: number, minPixels: number): number {
  return STEPS.find((step) => step * scale >= minPixels) ?? STEPS[STEPS.length - 1];
}

function drawRuler(
  canvas: HTMLCanvasElement,
  horizontal: boolean,
  origin: number,
  scale: number,
  length: number,
) {
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = horizontal ? length : RULER_SIZE;
  const cssHeight = horizontal ? RULER_SIZE : length;

  canvas.width = Math.max(1, Math.round(cssWidth * ratio));
  canvas.height = Math.max(1, Math.round(cssHeight * ratio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = '#1d1f22';
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.strokeStyle = '#8b9096';
  context.fillStyle = '#b4b8bd';
  context.font = '9px sans-serif';
  context.lineWidth = 1;

  const major = pickStep(scale, 60);
  const minor = pickStep(scale, 8);
  const first = Math.floor((0 - origin) / scale / minor) * minor;
  const last = Math.ceil((length - origin) / scale / minor) * minor;

  context.beginPath();

  for (let value = first; value <= last; value += minor) {
    const position = Math.round(origin + value * scale) + 0.5;
    const isMajor = value % major === 0;
    const size = isMajor ? RULER_SIZE : value % (major / 2) === 0 ? 9 : 5;

    if (horizontal) {
      context.moveTo(position, RULER_SIZE);
      context.lineTo(position, RULER_SIZE - size);
    } else {
      context.moveTo(RULER_SIZE, position);
      context.lineTo(RULER_SIZE - size, position);
    }
  }

  context.stroke();

  for (let value = first; value <= last; value += minor) {
    if (value % major !== 0) continue;

    const position = origin + value * scale;

    if (horizontal) {
      context.fillText(String(value), position + 2, 9);
    } else {
      context.save();
      context.translate(9, position - 2);
      context.rotate(-Math.PI / 2);
      context.fillText(String(value), 0, 0);
      context.restore();
    }
  }
}

export default function PreviewRulers({
  stageRef,
  panelRef,
  viewScale,
  compWidth,
  compHeight,
}: PreviewRulersProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(viewScale);

  useEffect(() => {
    scaleRef.current = viewScale;
  });

  // Redraw on zoom, scroll and resize.
  useEffect(() => {
    const stage = stageRef.current;
    const panel = panelRef.current;
    const container = containerRef.current;

    if (!stage || !panel || !container) {
      return;
    }

    let frame = 0;

    const draw = () => {
      frame = 0;

      const stageBounds = stage.getBoundingClientRect();
      const panelBounds = panel.getBoundingClientRect();
      const comp = stage.querySelector<HTMLElement>('.preview-canvas-frame');

      container.style.left = `${stageBounds.left - panelBounds.left}px`;
      container.style.top = `${stageBounds.top - panelBounds.top}px`;
      container.style.width = `${stage.clientWidth}px`;
      container.style.height = `${stage.clientHeight}px`;

      if (!comp || !topRef.current || !leftRef.current) {
        return;
      }

      const compBounds = comp.getBoundingClientRect();

      drawRuler(
        topRef.current,
        true,
        compBounds.left - stageBounds.left - RULER_SIZE,
        scaleRef.current,
        Math.max(0, stage.clientWidth - RULER_SIZE),
      );
      drawRuler(
        leftRef.current,
        false,
        compBounds.top - stageBounds.top - RULER_SIZE,
        scaleRef.current,
        Math.max(0, stage.clientHeight - RULER_SIZE),
      );
    };

    const request = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(draw);
      }
    };

    request();
    stage.addEventListener('scroll', request);
    window.addEventListener('resize', request);

    const observer = new ResizeObserver(request);

    observer.observe(stage);

    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
      observer.disconnect();
    };
  }, [stageRef, panelRef, viewScale, compWidth, compHeight]);

  // Pull a guide out of a ruler: top = horizontal guide, left = vertical.
  const beginPull = (event: React.PointerEvent<HTMLCanvasElement>, axis: 'v' | 'h') => {
    const stage = stageRef.current;
    const comp = stage?.querySelector<HTMLElement>('.preview-canvas-frame');

    if (!stage || !comp || event.button !== 0 || getPreviewGuides().guidesLocked) {
      return;
    }

    event.preventDefault();

    const target = event.currentTarget;
    const compBounds = comp.getBoundingClientRect();
    const scale = scaleRef.current;

    const positionOf = (clientX: number, clientY: number) =>
      Math.round(
        axis === 'v'
          ? (clientX - compBounds.left) / scale
          : (clientY - compBounds.top) / scale,
      );

    target.setPointerCapture(event.pointerId);

    let index = -1;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const position = positionOf(moveEvent.clientX, moveEvent.clientY);

      if (index < 0) {
        index = addGuide(axis, position);
      } else {
        moveGuide(axis, index, position);
      }
    };

    const onUp = (upEvent: globalThis.PointerEvent) => {
      target.releasePointerCapture?.(event.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);

      // Released back on the ruler: no guide.
      const stageBounds = stage.getBoundingClientRect();
      const overRuler =
        axis === 'v'
          ? upEvent.clientX < stageBounds.left + RULER_SIZE
          : upEvent.clientY < stageBounds.top + RULER_SIZE;

      if (index >= 0 && overRuler) {
        removeGuide(axis, index);
      }
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div ref={containerRef} className="preview-rulers">
      <canvas
        ref={topRef}
        className="preview-ruler is-top"
        style={{ left: RULER_SIZE, top: 0 }}
        title="Drag down to pull out a guide"
        onPointerDown={(event) => beginPull(event, 'h')}
      />
      <canvas
        ref={leftRef}
        className="preview-ruler is-left"
        style={{ left: 0, top: RULER_SIZE }}
        title="Drag right to pull out a guide"
        onPointerDown={(event) => beginPull(event, 'v')}
      />
      <div className="preview-ruler-corner" />
    </div>
  );
}
