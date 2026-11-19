import { useSyncExternalStore } from 'react';

import { getPointerInfo, subscribePointerInfo } from './pointerInfo';

/** The Info panel: colour and position under the pointer in the preview. */
export default function InfoReadout() {
  const info = useSyncExternalStore(subscribePointerInfo, getPointerInfo);
  const channel = (value: number | undefined) =>
    info && info.inside ? String(value) : '—';

  return (
    <div className="ae-info-grid">
      <span className="info-channel is-red">R: {channel(info?.r)}</span>
      <span>X: {info ? info.x : '—'}</span>
      <span className="info-channel is-green">G: {channel(info?.g)}</span>
      <span>Y: {info ? info.y : '—'}</span>
      <span className="info-channel is-blue">B: {channel(info?.b)}</span>
      <span
        className="info-swatch"
        style={{
          background:
            info && info.inside
              ? `rgba(${info.r}, ${info.g}, ${info.b}, ${info.a / 255})`
              : 'transparent',
        }}
        title="Colour under the pointer"
      />
      <span>A: {channel(info?.a)}</span>
    </div>
  );
}
