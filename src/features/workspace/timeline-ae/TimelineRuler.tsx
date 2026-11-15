import { useRef } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';

import type { MenuRequest } from '../WorkspaceMenus';

type TimelineRulerProps = {
  currentTime: number;
  duration: number;
  fps: number;
  pixelsPerSecond: number;
  timelineWidth: number;
  scrollLeft: number;
  onSeekTime?: (time: number) => void;
  bookmarks?: Array<{ id: string; time: number }>;
  onOpenContextMenu?: (request: MenuRequest) => void;
  workArea?: { start: number; end: number } | null;
  onWorkAreaChange?: (start: number, end: number, recordHistory: boolean) => void;
  onBeginEdit?: () => void;
};

function getTickSteps(pixelsPerSecond: number, fps: number) {
  const minimumLabelSpacing = 48;

  if (pixelsPerSecond < 25) {
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = candidates.find(
      (step) => step * pixelsPerSecond >= minimumLabelSpacing,
    ) ?? 600;
    return { major, minor: major / 5, frameBased: false };
  }

  const safeFps = Math.max(1, Math.round(fps));
  const frameCandidates = [
    1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 48, 60, 90, 120, 150,
    180, 240, 300,
  ];
  const majorFrames = frameCandidates.find(
    (frames) => (frames / safeFps) * pixelsPerSecond >= minimumLabelSpacing,
  );
  const major = majorFrames
    ? majorFrames / safeFps
    : [1, 2, 5, 10, 15, 30, 60].find(
        (step) => step * pixelsPerSecond >= minimumLabelSpacing,
      ) ?? 60;

  return {
    major,
    minor: majorFrames ? Math.max(1, Math.floor(majorFrames / 5)) / safeFps : major / 5,
    frameBased: Boolean(majorFrames),
  };
}

function formatTick(time: number, fps: number, frameBased: boolean) {
  if (!frameBased) {
    const seconds = Math.round(time);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
      seconds % 60,
    ).padStart(2, '0')}s`;
  }

  const totalFrames = Math.round(time * Math.max(1, fps));
  const seconds = Math.floor(totalFrames / Math.max(1, fps));
  const frames = totalFrames % Math.max(1, fps);
  const secondLabel =
    totalFrames === 0 ? '0' : String(seconds).padStart(2, '0');
  return `${secondLabel}:${String(frames).padStart(2, '0')}f`;
}

export default function TimelineRuler({
  currentTime,
  duration,
  fps,
  pixelsPerSecond,
  timelineWidth,
  scrollLeft,
  onSeekTime,
  bookmarks = [],
  onOpenContextMenu,
  workArea = null,
  onWorkAreaChange,
  onBeginEdit,
}: TimelineRulerProps) {
  const workStart = workArea?.start ?? 0;
  const workEnd = workArea?.end ?? duration;

  // Drag a handle (start / end) or the bar itself (move both ends).
  // Times snap to whole frames. One undo step for the whole drag.
  const beginWorkAreaDrag = (
    event: PointerEvent<HTMLElement>,
    mode: 'start' | 'end' | 'move',
  ) => {
    const viewport = event.currentTarget.closest<HTMLElement>('.tl-ruler-viewport');

    if (!onWorkAreaChange || !viewport || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const bounds = viewport.getBoundingClientRect();
    const frame = 1 / Math.max(1, fps);
    const original = { start: workStart, end: workEnd };
    const timeAt = (clientX: number) =>
      (clientX - bounds.left + scrollLeft) / pixelsPerSecond;
    const snap = (value: number) => Math.round(value / frame) * frame;
    const grabbedAt = timeAt(event.clientX);
    let started = false;

    target.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const time = timeAt(moveEvent.clientX);
      let start = original.start;
      let end = original.end;

      if (mode === 'start') {
        start = Math.min(snap(time), end - frame);
      } else if (mode === 'end') {
        end = Math.max(snap(time), start + frame);
      } else {
        const length = end - start;
        start = Math.max(0, Math.min(duration - length, start + snap(time - grabbedAt)));
        end = start + length;
      }

      if (!started) {
        started = true;
        onBeginEdit?.();
      }

      onWorkAreaChange(Math.max(0, start), Math.min(duration, end), false);
    };

    const onUp = () => {
      target.releasePointerCapture?.(event.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const scrubPointer = useRef<number | null>(null);
  const { major, minor, frameBased } = getTickSteps(pixelsPerSecond, fps);
  const tickCount = Math.ceil(duration / minor);
  const majorEvery = Math.max(1, Math.round(major / minor));
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const time = index * minor;
    const isMajor = index % majorEvery === 0;
    return {
      time,
      isMajor,
      label: isMajor ? formatTick(time, fps, frameBased) : '',
      style: { left: `${time * pixelsPerSecond}px` } as CSSProperties,
    };
  });
  const viewWidth = Math.min(100, (800 / timelineWidth) * 100);
  const viewLeft = Math.min(
    100 - viewWidth,
    (scrollLeft / timelineWidth) * 100,
  );
  const navigatorStyle = {
    width: `${viewWidth}%`,
    left: `${viewLeft}%`,
  } as CSSProperties;

  return (
    <div className="tl-ruler-head">
      <div className="tl-navigator">
        <div className="tl-navigator-track">
          <span className="tl-navigator-range" style={navigatorStyle}>
            <i />
            <i />
          </span>
        </div>
      </div>
      <div
        className="tl-ruler-viewport"
        onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
          event.preventDefault();

          const time = Math.max(
            0,
            Math.min(
              duration,
              (event.clientX -
                event.currentTarget.getBoundingClientRect().left +
                scrollLeft) /
                pixelsPerSecond,
            ),
          );

          const near = bookmarks.find(
            (bookmark) => Math.abs(bookmark.time - time) * pixelsPerSecond <= 8,
          );

          onOpenContextMenu?.({
            kind: 'ruler',
            x: event.clientX,
            y: event.clientY,
            time,
            bookmarkId: near?.id,
          });
        }}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubPointer.current = event.pointerId;
          onSeekTime?.(Math.max(0, Math.min(duration, (event.clientX - event.currentTarget.getBoundingClientRect().left + scrollLeft) / pixelsPerSecond)));
        }}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
          if (scrubPointer.current !== event.pointerId) return;
          onSeekTime?.(Math.max(0, Math.min(duration, (event.clientX - event.currentTarget.getBoundingClientRect().left + scrollLeft) / pixelsPerSecond)));
        }}
        onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
          if (scrubPointer.current !== event.pointerId) return;
          scrubPointer.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event: PointerEvent<HTMLDivElement>) => {
          scrubPointer.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div
          className="tl-ruler-content"
          style={{
            width: `${timelineWidth}px`,
            transform: `translateX(-${scrollLeft}px)`,
          }}
        >
          <div className="tl-marker-band">
            {bookmarks.map((bookmark, index) => (
              <span
                className="tl-comp-marker"
                style={{ left: bookmark.time * pixelsPerSecond }}
                key={bookmark.id}
                title="Bookmark (right-click to remove)"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSeekTime?.(bookmark.time);
                }}
              >
                {index + 1}
              </span>
            ))}
          </div>
          <div className="tl-ruler-ticks">
            {ticks.map(({ time, label, isMajor, style }) => (
              <span
                className={`tl-tick ${isMajor ? 'is-major' : 'is-minor'}`}
                style={style}
                key={time}
              >
                <i />
                {isMajor && <b>{label}</b>}
              </span>
            ))}
          </div>
          <div
            className={'tl-work-area' + (workArea ? ' is-set' : '')}
            style={{
              left: workStart * pixelsPerSecond,
              width: Math.max(2, (workEnd - workStart) * pixelsPerSecond),
              right: 'auto',
            }}
            title="Work area: drag the ends to set it, drag the bar to move it"
            onPointerDown={(event) => beginWorkAreaDrag(event, 'move')}
          >
            <span
              className="tl-work-handle tl-work-start"
              onPointerDown={(event) => beginWorkAreaDrag(event, 'start')}
            />
            <span
              className="tl-work-handle tl-work-end"
              onPointerDown={(event) => beginWorkAreaDrag(event, 'end')}
            />
          </div>
          <div className="tl-ruler-playhead" style={{ left: `${currentTime * pixelsPerSecond}px` }}>
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
