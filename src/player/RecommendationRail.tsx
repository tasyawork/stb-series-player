import { memo } from "react";
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
}: RecommendationRailProps) {
  const cardStep = cardWidth + gap;
  const trackWidth = items.length * cardStep - gap;
  const maxOffset = Math.max(0, trackWidth - WINDOW);
  const offset = Math.min(Math.max(0, anchorIndex) * cardStep, maxOffset);

  return (
    <div className="rail-viewport">
      <div className="rail" style={{ transform: `translateX(${-offset}px)` }}>
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
