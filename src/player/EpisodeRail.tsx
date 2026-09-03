import { memo } from "react";
import type { IviEpisode } from "../ivi/types";
import type { PlayheadStore } from "./playhead";
import { usePlayhead } from "./playhead";
import { formatMinutes } from "./time";

/** Episode из Figma 1299:10371: постер 152×86, шаг ряда держим синхронно с --poster-w */
const DEFAULT_CARD_W = 152;
const DEFAULT_GAP = 16;
/** Полоса от 68px до 68px от правого края плеера (960 − 68 × 2) */
const WINDOW = 824;

type EpisodeRailProps = {
  episodes: IviEpisode[];
  currentId: number;
  playhead: PlayheadStore;
  duration: number;
  focusedIndex: number | null;
  /** Позиция ряда: сохраняется, когда фокус уходит из серий на кнопки под ними */
  anchorIndex: number;
  /** Ширина карточки и зазор для расчёта прокрутки: держим равными --poster-w/--poster-gap */
  cardWidth?: number;
  gap?: number;
  /** Платный тайтл (recom): у карточки в фокусе шильд «По подписке» перед длительностью */
  paid?: boolean;
};

/*
  Ряд может быть на сотню карточек с картинками, поэтому он не должен зависеть
  от хода времени: полоску прогресса тикает отдельный крошечный подписчик,
  а сам ряд перерисовывается только на смену сезона, серии или фокуса.
*/
export const EpisodeRail = memo(function EpisodeRail({
  episodes,
  currentId,
  playhead,
  duration,
  focusedIndex,
  anchorIndex,
  cardWidth = DEFAULT_CARD_W,
  gap = DEFAULT_GAP,
  paid = false,
}: EpisodeRailProps) {
  const cardStep = cardWidth + gap;
  const trackWidth = episodes.length * cardStep - gap;
  // На конце списка ряд упирается правым краем постера в границу окна
  const maxOffset = Math.max(0, trackWidth - WINDOW);
  // Серия в фокусе встаёт на первую позицию ряда, пройденные уходят за левый край плеера
  const offset = Math.min(Math.max(0, anchorIndex) * cardStep, maxOffset);

  return (
    <div className="rail-viewport">
      <div className="rail" style={{ transform: `translateX(${-offset}px)` }}>
        {episodes.map((episode, index) => {
          const current = episode.id === currentId;
          const focused = focusedIndex === index;
          /*
            Шильд «По подписке» и градиентная рамка — только у серии под замком.
            Доступную серию ничем не метим: у неё в фокусе обычная белая обводка
            и никакого шильда, даже если сам тайтл подписочный.
          */
          const showShield = paid && focused && episode.isLocked;
          // Тайминг показываем у открытых серий, а у закрытых — только в фокусе платного тайтла
          const showDuration =
            episode.availability === "available" && (!episode.isLocked || paid);
          return (
            <div
              key={episode.id}
              className={`episode-card${current ? " current" : ""}${
                focusedIndex === index ? " focused" : ""
              } availability-${episode.availability}${episode.isLocked ? " locked" : ""}`}
              aria-disabled={episode.availability !== "available" || episode.isLocked}
            >
              <div className="poster">
                {episode.thumb ? <img src={episode.thumb} alt="" loading="lazy" /> : null}
                {episode.isLocked ? (
                  <div className="availability-overlay">
                    <img className="lock-icon" src="/icons/locked.svg" alt="По подписке" />
                  </div>
                ) : episode.availability !== "available" ? (
                  <div className="availability-overlay">
                    {availabilityLabel(episode)}
                  </div>
                ) : null}
                {current ? <PosterProgress playhead={playhead} duration={duration} /> : null}
              </div>
              <p>
                {current ? <OnAirIcon /> : null}
                {episode.episode} серия
              </p>
              {showShield ? (
                // Платный тайтл: шильд «По подписке» перед длительностью у карточки в фокусе
                <span className="paid-shield">
                  <img className="paid-shield-icon" src="/icons/subscription-badge.png" alt="" />
                  <span className="paid-shield-text">По подписке</span>
                </span>
              ) : null}
              <small
                className={`${showDuration ? "" : "empty"}${
                  paid && focused ? " episode-paid-duration" : ""
                }`}
              >
                {showDuration
                  ? formatMinutes(episode.durationSec)
                  : "\u00a0"}
              </small>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/*
  Иконка «в эфире сейчас» перед названием текущей серии (Figma 299:21806).
  Заливка currentColor: у серии в фокусе подпись белеет — вместе с ней белеет
  и треугольник, у остальных остаётся приглушённым цветом подписи.
*/
function OnAirIcon() {
  return (
    <svg
      className="onair-icon"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5.40762 2.04457L8.7844 4.07064C10.2204 4.93224 10.9384 5.36304 10.9384 6C10.9384 6.63696 10.2204 7.06776 8.7844 7.92936L5.40762 9.95543C3.89682 10.8619 3.14143 11.3151 2.57071 10.992C2 10.6689 2 9.78794 2 8.02607V3.97393C2 2.21206 2 1.33112 2.57071 1.00799C3.14143 0.684856 3.89682 1.13809 5.40762 2.04457Z"
        fill="currentColor"
      />
    </svg>
  );
}

function PosterProgress({ playhead, duration }: { playhead: PlayheadStore; duration: number }) {
  const current = usePlayhead(playhead);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div className="poster-progress">
      <span style={{ width: `${Math.max(4, progress * 100)}%` }} />
    </div>
  );
}

function availabilityLabel(episode: IviEpisode): string {
  if (episode.availability === "unavailable") return "Недоступно";
  if (episode.availability === "upcoming") {
    if (!episode.releaseDate) return "Скоро";
    const date = new Date(`${episode.releaseDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "Скоро";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
    }).format(date);
  }
  return "";
}
