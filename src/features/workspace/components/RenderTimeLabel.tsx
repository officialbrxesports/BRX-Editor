import { useSyncExternalStore } from 'react';

import { getRenderTime, subscribeRenderTime } from './renderStats';

/** The measured time to draw one preview frame, e.g. "7 ms". */
export default function RenderTimeLabel() {
  const milliseconds = useSyncExternalStore(subscribeRenderTime, getRenderTime);

  return <b>{milliseconds} ms</b>;
}
