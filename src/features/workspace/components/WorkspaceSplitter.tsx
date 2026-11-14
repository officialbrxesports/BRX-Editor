import { useRef } from 'react';
import type { PointerEvent } from 'react';

type Props = {
  axis: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onDoubleClick?: () => void;
};

export default function WorkspaceSplitter({
  axis,
  value,
  min,
  max,
  onChange,
  onDoubleClick,
}: Props) {
  const start = useRef<{ pointerId: number; coordinate: number; value: number } | null>(null);
  const coordinate = (event: PointerEvent<HTMLDivElement>) =>
    axis === 'horizontal' ? event.clientX : event.clientY;

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = {
      pointerId: event.pointerId,
      coordinate: coordinate(event),
      value,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = start.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const direction = axis === 'vertical' ? -1 : 1;
    onChange(Math.max(min, Math.min(max, active.value + (coordinate(event) - active.coordinate) * direction)));
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current?.pointerId !== event.pointerId) return;
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={`workspace-splitter ${axis}`}
      role="separator"
      aria-orientation={axis === 'vertical' ? 'horizontal' : 'vertical'}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onDoubleClick}
    />
  );
}
