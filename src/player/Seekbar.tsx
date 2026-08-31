import type { CSSProperties } from "react";
import { formatTimecode } from "./time";

type SeekbarProps = {
  current: number;
  duration: number;
  markers: number[];
  focused: boolean;
};

export function Seekbar({ current, duration, markers, focused }: SeekbarProps) {
  const ratio = duration > 0 ? current / duration : 0;

  return (
    <div className={`seekbar${focused ? " focused" : ""}`}>
      <time>{formatTimecode(current)}</time>
      <div className="track" role="slider" aria-valuenow={current} aria-valuemax={duration}>
        <div className="track-bg" />
        {markers.map((mark) => (
          <span key={mark} className="marker" style={{ left: `${mark * 100}%` }} />
        ))}
        <div className="track-fill" style={{ width: `${ratio * 100}%` } as CSSProperties} />
        <div className="thumb" style={{ left: `${ratio * 100}%` }} />
      </div>
      <time>{formatTimecode(duration)}</time>
    </div>
  );
}
