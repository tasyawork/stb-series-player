import { memo } from "react";
import type { IviEpisode } from "../ivi/types";
import type { PlayheadStore } from "./playhead";
import { usePlayhead } from "./playhead";
import { formatMinutes } from "./time";

const CARD_W = 178;
const GAP = 16;
const CARD_STEP = CARD_W + GAP;
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
}: EpisodeRailProps) {
  const trackWidth = episodes.length * CARD_STEP - GAP;
  // На конце списка ряд упирается правым краем постера в границу окна
  const maxOffset = Math.max(0, trackWidth - WINDOW);
  // Серия в фокусе встаёт на первую позицию ряда, пройденные уходят за левый край плеера
  const offset = Math.min(Math.max(0, anchorIndex) * CARD_STEP, maxOffset);

  return (
    <div className="rail-viewport">
      <div className="rail" style={{ transform: `translateX(${-offset}px)` }}>
        {episodes.map((episode, index) => {
          const current = episode.id === currentId;
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
              <p>{episode.episode} серия</p>
              <small className={episode.availability !== "available" || episode.isLocked ? "empty" : ""}>
                {episode.availability === "available" && !episode.isLocked
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
