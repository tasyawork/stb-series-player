import { memo, useLayoutEffect, useRef, useState } from "react";

// Соседний таб остаётся подсмотренным у границы, как карточки в ряду серий
const PEEK = 48;

type SeasonTabsProps = {
  seasons: { number: number; title: string; episodeCount: number }[];
  activeSeason: number;
  focusedSeason: number | null;
};

export const SeasonTabs = memo(function SeasonTabs({
  seasons,
  activeSeason,
  focusedSeason,
}: SeasonTabsProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const tab = track.querySelector<HTMLElement>(`[data-season="${activeSeason}"]`);
    if (!tab) return;

    const viewportWidth = viewport.clientWidth;
    const maxOffset = Math.max(0, track.scrollWidth - viewportWidth);
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;

    setOffset((current) => {
      let next = current;
      if (right + PEEK > current + viewportWidth) next = right + PEEK - viewportWidth;
      else if (left - PEEK < current) next = left - PEEK;
      return Math.max(0, Math.min(next, maxOffset));
    });
  }, [activeSeason, seasons]);

  if (seasons.length === 0) return null;
  // Один сезон — не таб, а простой некликабельный заголовок
  if (seasons.length === 1) {
    return (
      <div className="season-tabs">
        <div className="season-heading">{seasons[0].number} сезон</div>
      </div>
    );
  }
  return (
    <div className="season-tabs" ref={viewportRef}>
      <div
        className="season-track"
        ref={trackRef}
        role="tablist"
        aria-label="Сезоны"
        style={{ transform: `translateX(${-offset}px)` }}
      >
        {seasons.map((season) => {
          const selected = season.number === activeSeason;
          const focused = season.number === focusedSeason;
          const state = focused ? "Focused" : selected ? "Selected" : "Default";
          return (
            <div
              key={season.number}
              className={`segment-item${selected ? " selected" : ""}${focused ? " focused" : ""}`}
              data-season={season.number}
              data-state={state}
              role="tab"
              aria-selected={selected}
            >
              {season.number} сезон
            </div>
          );
        })}
      </div>
    </div>
  );
});
