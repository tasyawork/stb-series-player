import { memo, useLayoutEffect, useRef, useState } from "react";

// Соседний таб остаётся подсмотренным у границы, как карточки в ряду серий
const PEEK = 48;

type SeasonTabsProps = {
  seasons: { number: number; title: string; episodeCount: number; year?: number }[];
  activeSeason: number;
  focusedSeason: number | null;
  /* Вертикальная колонка (сетка): скролл идёт по вертикали (translateY) */
  vertical?: boolean;
};

export const SeasonTabs = memo(function SeasonTabs({
  seasons,
  activeSeason,
  focusedSeason,
  vertical = false,
}: SeasonTabsProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    // Скроллим к сфокусированному сезону (а вне фокуса — к активному)
    const target = focusedSeason ?? activeSeason;
    const tab = track.querySelector<HTMLElement>(`[data-season="${target}"]`);
    if (!tab) return;

    // По вертикали (сетка) считаем по высоте, по горизонтали — по ширине
    const size = vertical ? viewport.clientHeight : viewport.clientWidth;
    const scroll = vertical ? track.scrollHeight : track.scrollWidth;
    const maxOffset = Math.max(0, scroll - size);
    const start = vertical ? tab.offsetTop : tab.offsetLeft;
    const end = start + (vertical ? tab.offsetHeight : tab.offsetWidth);

    setOffset((current) => {
      let next = current;
      if (end + PEEK > current + size) next = end + PEEK - size;
      else if (start - PEEK < current) next = start - PEEK;
      return Math.max(0, Math.min(next, maxOffset));
    });
  }, [activeSeason, focusedSeason, seasons, vertical]);

  // Год рядом с табом показываем только у длинных сериалов (5 сезонов и больше)
  const showYears = seasons.length >= 5;

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
        style={{ transform: vertical ? `translateY(${-offset}px)` : `translateX(${-offset}px)` }}
      >
        {seasons.map((season) => {
          const selected = season.number === activeSeason;
          const focused = season.number === focusedSeason;
          const state = focused ? "Focused" : selected ? "Selected" : "Default";
          return (
            <div className="season-row" key={season.number}>
              <div
                className={`segment-item${selected ? " selected" : ""}${focused ? " focused" : ""}`}
                data-season={season.number}
                data-state={state}
                role="tab"
                aria-selected={selected}
              >
                {season.number} сезон
              </div>
              {/* Год съёмок — отдельной сущностью справа, только у длинных сериалов (5+ сезонов) */}
              {showYears && season.year ? (
                <span className="season-year">{season.year}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});
