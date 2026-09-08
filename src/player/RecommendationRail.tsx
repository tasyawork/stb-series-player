import { memo, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { IviRecommendation } from "../ivi/types";

/** Те же размеры, что у ряда серий: держим синхронно с --poster-w/--poster-gap */
const DEFAULT_CARD_W = 224;
const DEFAULT_GAP = 16;
/** Полоса от 68px до 68px от правого края плеера (960 − 68 × 2) */
const WINDOW = 824;

type RecommendationRailProps = {
  items: IviRecommendation[];
  focusedIndex: number | null;
  anchorIndex: number;
  cardWidth?: number;
  gap?: number;
  /* Сетка (фильм «Вертикаль»): 4 карточки в ряд, вертикальный скролл вниз */
  grid?: boolean;
  columns?: number;
  /* Прокрутка сетки активна только при открытой шторке */
  scrollActive?: boolean;
};

/*
  Галерея «Смотрят вместе с …»: похожие по жанру тайтлы с реального API.
  Карточка повторяет геометрию карточки серии (постер + две строки подписи),
  чтобы высота ряда совпадала и расчёт двухступенчатой шторки не менялся.
*/
export const RecommendationRail = memo(function RecommendationRail({
  items,
  focusedIndex,
  anchorIndex,
  cardWidth = DEFAULT_CARD_W,
  gap = DEFAULT_GAP,
  grid = false,
  columns = 4,
  scrollActive = true,
}: RecommendationRailProps) {
  const cardStep = cardWidth + gap;
  const trackWidth = items.length * cardStep - gap;
  const maxOffset = Math.max(0, trackWidth - WINDOW);
  const offset = Math.min(Math.max(0, anchorIndex) * cardStep, maxOffset);

  const railRef = useRef<HTMLDivElement | null>(null);
  const gridScroll = useRef(0);
  const wasActive = useRef(false);

  // Сетка: держим фокусную карточку в видимой области (мгновенно при открытии)
  useLayoutEffect(() => {
    if (!grid) return;
    const el = railRef.current;
    const vp = el?.parentElement;
    if (!el || !vp) return;
    const animate = scrollActive && wasActive.current;
    wasActive.current = scrollActive;
    const place = (y: number) => {
      if (animate) {
        el.style.transform = `translateY(${y}px)`;
        return;
      }
      el.style.transition = "none";
      el.style.transform = `translateY(${y}px)`;
      void el.offsetHeight;
      el.style.transition = "";
    };
    if (!scrollActive) {
      gridScroll.current = 0;
      place(0);
      return;
    }
    const vh = vp.clientHeight;
    const idx = focusedIndex ?? anchorIndex ?? 0;
    const card = el.children[idx] as HTMLElement | undefined;
    if (!card) return;
    const M = 10;
    const top = card.offsetTop;
    const bottom = top + card.offsetHeight;
    let scroll = gridScroll.current;
    if (bottom + M > scroll + vh) scroll = bottom + M - vh;
    if (top - M < scroll) scroll = top - M;
    const maxScroll = Math.max(0, el.scrollHeight - vh);
    scroll = Math.max(0, Math.min(scroll, maxScroll));
    gridScroll.current = scroll;
    place(-scroll);
  }, [grid, focusedIndex, anchorIndex, items.length, scrollActive]);

  return (
    <div className="rail-viewport">
      <div
        ref={railRef}
        className={grid ? "rail grid" : "rail"}
        style={
          grid
            ? ({ "--grid-cols": columns } as CSSProperties)
            : { transform: `translateX(${-offset}px)` }
        }
      >
        {items.map((item, index) => (
          <div key={item.id} className={`rec-card${focusedIndex === index ? " focused" : ""}`}>
            <div className="poster">
              {item.poster ? <img src={item.poster} alt="" loading="lazy" /> : null}
            </div>
            {/* Вариант с рекомом: в 1-й строке — краткое описание, не название */}
            <p>{item.description || item.title}</p>
            {item.author !== undefined ? (
              /* Блогерский ролик: имя автора и когда вышло (Figma 300:23272) */
              <small className="rec-meta rec-meta-blogger">
                {item.author ? <span className="rec-author">{item.author}</span> : null}
                {item.released ? <span>{item.released}</span> : null}
                {item.author || item.released ? null : " "}
              </small>
            ) : (
              /* Вторая строка меты: основной жанр, затем длительность (Figma 299:21939) */
              <small className="rec-meta">
                {item.genre ? <span>{item.genre}</span> : null}
                {item.runtime ? <span>{item.runtime}</span> : null}
                {item.genre || item.runtime ? null : " "}
              </small>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
