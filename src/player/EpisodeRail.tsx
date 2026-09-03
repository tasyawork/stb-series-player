import { memo, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
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
  /*
    Закольцовка длинного сезона: ряд превращается в бесшовную карусель. По краям
    дорисованы клоны серий с другого конца, а переход через край (с 1 на
    последнюю и обратно) — плавный: незаметная телепортация к клону и один шаг
    анимации, без рывка через весь сезон.
  */
  loop?: boolean;
  /** id серий, на которые включено напоминание о выходе */
  reminders?: Set<number>;
  /*
    Вариант «С рекомом»: невышедшая серия получает «Включить напоминание» и дату
    выхода снизу зелёным. В «Без рекома» этих правок нет — там старый вид с датой
    поверх постера.
  */
  recom?: boolean;
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
  loop = false,
  reminders,
  recom = false,
}: EpisodeRailProps) {
  const cardStep = cardWidth + gap;
  const count = episodes.length;
  const canLoop = loop && count > 1;
  // Сколько клонов дорисовываем по краям — чтобы окно всегда было заполнено
  const clones = canLoop ? Math.min(count, Math.ceil(WINDOW / cardStep) + 1) : 0;

  /*
    Карусель: реальные серии сдвинуты на clones карточек вправо. Как и без
    закольцовки, серия у левого поля, а последняя упирается правым краем в окно
    (68px от правого края) — маленький «пин» в конце. Клоны по краям заполняют
    окно и служат двойниками для бесшовного перехода через край.
  */
  const maxLoopOffset = (clones + count - 1) * cardStep + cardWidth - WINDOW;
  const loopOffset = (index: number) =>
    Math.min((clones + Math.max(0, Math.min(count - 1, index))) * cardStep, maxLoopOffset);
  const plainOffset = (index: number) => {
    const trackWidth = count * cardStep - gap;
    const maxOffset = Math.max(0, trackWidth - WINDOW);
    return Math.min(Math.max(0, index) * cardStep, maxOffset);
  };
  const baseOffset = (index: number) => (canLoop ? loopOffset(index) : plainOffset(index));

  /*
    Сдвигом ленты управляем императивно (не через React-стиль), иначе ререндер
    перебивал бы переход через край. React только рисует карточки, а положение и
    анимацию задаёт этот эффект по ref.
  */
  const railRef = useRef<HTMLDivElement | null>(null);
  const prev = useRef({ index: anchorIndex, count, mounted: false });

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const before = prev.current;
    prev.current = { index: anchorIndex, count, mounted: true };
    const next = baseOffset(anchorIndex);
    const move = (px: number) => (el.style.transform = `translateX(${-px}px)`);

    const wrappedLeft = canLoop && before.index === 0 && anchorIndex === count - 1;
    const wrappedRight = canLoop && before.index === count - 1 && anchorIndex === 0;

    if (!before.mounted || before.count !== count) {
      // Монтирование или смена сезона — просто встаём в позицию, без анимации
      el.style.transition = "none";
      move(next);
    } else if (wrappedLeft || wrappedRight) {
      /*
        Телепорт к двойнику у противоположного края (кадр совпадает с текущим —
        незаметно), форс-рефлоу, затем один «экран» анимации к цели: с 1 серии
        последняя уезжает вправо на своё крайнее место, с последней — 1 серия
        приезжает к левому полю. Иначе CSS-переход проехал бы весь сезон.
      */
      const teleport = wrappedLeft
        ? (clones + count) * cardStep
        : (clones - 1) * cardStep - (WINDOW - cardWidth);
      el.style.transition = "none";
      move(teleport);
      void el.offsetWidth;
      el.style.transition = "";
      move(next);
    } else {
      el.style.transition = "";
      move(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorIndex, canLoop, count, cardStep, clones]);

  const renderCard = (episode: IviEpisode, index: number, key: string, clone: boolean) => {
    const current = !clone && episode.id === currentId;
    const focused = !clone && focusedIndex === index;
    const locked = episode.isLocked; // подписочная серия (вышедшая или ещё нет)
    const upcoming = episode.availability === "upcoming";
    const upcomingFree = upcoming && !locked;
    const reminded = upcomingFree && Boolean(reminders?.has(episode.id));
    // Шильд «По подписке» — только у подписочной серии в фокусе (вместо тайминга)
    const showShield = !clone && paid && focused && locked;
    // Тайминг — у вышедших серий; у подписочной закрытой — только вне фокуса
    const showDuration =
      episode.availability === "available" && (!locked || paid);

    // Вторая строка: шильд, либо зелёная дата у невышедшей, либо тайминг
    let secondLine: ReactNode;
    if (showShield) {
      secondLine = (
        <span className="paid-shield">
          <img className="paid-shield-icon" src="/icons/subscription-badge.png" alt="" />
          <span className="paid-shield-text">По подписке</span>
        </span>
      );
    } else if (upcoming && recom) {
      // «С рекомом»: дата выхода снизу зелёным (в «Без рекома» она поверх постера)
      secondLine = <small className="release-date">{availabilityLabel(episode)}</small>;
    } else {
      secondLine = (
        <small className={showDuration ? "" : "empty"}>
          {showDuration ? formatMinutes(episode.durationSec) : " "}
        </small>
      );
    }

    return (
      <div
        key={key}
        className={`episode-card${current ? " current" : ""}${focused ? " focused" : ""} availability-${
          episode.availability
        }${locked ? " locked" : ""}${clone ? " clone" : ""}`}
        aria-disabled={episode.availability !== "available" || locked}
        aria-hidden={clone || undefined}
      >
        <div className="poster">
          {episode.thumb ? <img src={episode.thumb} alt="" loading="lazy" /> : null}
          {locked ? (
            <div className="availability-overlay">
              <img className="lock-icon" src="/icons/locked.svg" alt="По подписке" />
            </div>
          ) : upcomingFree && recom ? (
            // «С рекомом»: невышедшая бесплатная серия — включить напоминание о выходе
            <div className="availability-overlay notify-overlay">
              <img className="notify-bell" src="/icons/pull.svg" alt="" />
              <span>{reminded ? "Напоминание включено" : "Включить напоминание"}</span>
            </div>
          ) : episode.availability !== "available" ? (
            // «Без рекома» (и «Недоступно»): подпись поверх постера, как раньше
            <div className="availability-overlay">{availabilityLabel(episode)}</div>
          ) : null}
          {current ? <PosterProgress playhead={playhead} duration={duration} /> : null}
        </div>
        <p>
          {current ? <OnAirIcon /> : null}
          {episode.episode} серия
        </p>
        {secondLine}
      </div>
    );
  };

  return (
    <div className="rail-viewport">
      <div ref={railRef} className="rail">
        {canLoop
          ? episodes
              .slice(count - clones)
              .map((episode, i) => renderCard(episode, -1, `clone-l-${episode.id}-${i}`, true))
          : null}
        {episodes.map((episode, index) => renderCard(episode, index, `${episode.id}`, false))}
        {canLoop
          ? episodes
              .slice(0, clones)
              .map((episode, i) => renderCard(episode, -1, `clone-r-${episode.id}-${i}`, true))
          : null}
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
