import { getSettingsWarnings } from '../../utils/deviceProfile';

import './ResolutionWarning.css';

type ResolutionWarningProps = {
  width: number;
  height: number;
  fps: number;
};

/** Yellow, never-blocking warning box shown under the settings row. */
export default function ResolutionWarning({
  width,
  height,
  fps,
}: ResolutionWarningProps) {
  const messages = getSettingsWarnings(width, height, fps);
  if (messages.length === 0) return null;

  return (
    <div className="resolution-warning" role="status">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
