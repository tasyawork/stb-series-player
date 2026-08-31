import { memo } from "react";
import type { CSSProperties } from "react";
import type { PlayheadStore } from "./playhead";
import { usePlayhead } from "./playhead";
import { formatTimecode } from "./time";

type SeekbarProps = {
  playhead: PlayheadStore;
  duration: number;
  markers: number[];
  focused: boolean;
};

/*
  Единственный подписчик позиции среди контролов: перерисовывается четыре раза
  в секунду, но это десяток узлов, а не весь плеер. Дорожка и бегунок ездят по
  --seek-ratio, поэтому в DOM меняется одно свойство на корне полосы.
*/
export const Seekbar = memo(function Seekbar({
  playhead,
  duration,
  markers,
  focused,
}: SeekbarProps) {
  const current = usePlayhead(playhead);
  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div
      className={`seekbar${focused ? " focused" : ""}`}
      style={{ "--seek-ratio": ratio } as CSSProperties}
    >
      <time>{formatTimecode(current)}</time>
      <div
        className="track"
        role="slider"
        aria-valuenow={Math.floor(current)}
        aria-valuemax={duration}
      >
        <div className="track-bg" />
        {markers.map((mark) => (
          <span key={mark} className="marker" style={{ left: `${mark * 100}%` }} />
        ))}
        <div className="track-fill" />
        <div className="thumb" />
      </div>
      <time>{formatTimecode(duration)}</time>
    </div>
  );
});
