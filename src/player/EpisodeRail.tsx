import { Fragment, memo, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
    Раскладка «сетка» (сезоны слева, серии сеткой справа): 4 колонки, вертикальный
    скролл вниз, без горизонтальной прокрутки и закольцовки. Фокусная карточка
    подскроливается по вертикали.
  */
  grid?: boolean;
  /** Число колонок сетки (для вертикальной прокрутки по рядам) */
  columns?: number;
  /*
    Прижать сетку к низу, когда серий мало и они умещаются в кадр (1 сезон,
    мало серий). Если серий много и они не влезают — обычный скролл сверху.
  */
  bottomAnchor?: boolean;
  /** Прокрутка сетки активна только при открытой шторке; закрытая держится наверху */
  scrollActive?: boolean;
  /*
    Вариант «С рекомом»: невышедшая серия получает «Включить напоминание» и дату
    выхода снизу зелёным. В «Без рекома» этих правок нет — там старый вид с датой
    поверх постера.
  */
  recom?: boolean;
  /*
    Просмотренные серии (все варианты, кроме «Без рекома»): постер затемняется,
    на нём глазик (пропадает в фокусе), а вместо тайминга — «Просмотрено».
  */
  watched?: Set<number>;
  /*
    Непрерывная лента всех сезонов (только сетка): серии всех сезонов идут подряд,
    между сезонами — заголовок-разделитель «N сезон». focusedIndex/anchorIndex —
    сквозной индекс по всем сезонам (с учётом карточки подписки впереди).
  */
  gridSeasons?: { number: number; episodes: IviEpisode[] }[];
  /*
    Начатые, но недосмотренные серии: затемнение и глазик, но в мете вместо
    «Начато» — сколько минут осталось до конца, и неполная полоса прогресса.
  */
  started?: Set<number>;
  /*
    Платный тайтл: перед первой серией показываем карточку подписки вместо
    постера про 1 серию. В мете — название подписки и цена.
  */
  subCard?: boolean;
  subName?: string;
  subPrice?: string;
  /*
    Шильд «смотрят N» перед таймингом у отдельных серий (демо: 7 серия «Холода»).
    Ключ — id серии, значение — счётчик («50K»).
  */
  watching?: Map<number, string>;
};

// Доля серии, оставшаяся у начатой (демо): полоса прогресса стоит на 45%
const STARTED_PROGRESS = 0.45;

function remainingMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

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
  watched,
  started,
  grid = false,
  columns = 4,
  bottomAnchor = false,
  scrollActive = true,
  gridSeasons,
  subCard = false,
  subName = "",
  subPrice = "",
  watching,
}: EpisodeRailProps) {
  const cardStep = cardWidth + gap;
  const count = episodes.length;
  const canLoop = !grid && loop && count > 1 && !subCard;
  // Смещение реальных серий, когда впереди стоит карточка подписки
  const lead = subCard ? 1 : 0;
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
  const gridScroll = useRef(0);
  // Была ли шторка уже открыта — чтобы не анимировать саму первую прокрутку при открытии
  const gridWasActive = useRef(false);
  const hWasActive = useRef(false);

  // Сетка: вертикальная прокрутка — держим фокусную карточку в видимой области
  useLayoutEffect(() => {
    if (!grid) return;
    const el = railRef.current;
    const vp = el?.parentElement;
    if (!el || !vp) return;
    // Анимируем прокрутку только если шторка УЖЕ была открыта. При самом открытии
    // (и в закрытом состоянии) встаём в позицию мгновенно — без резкой перемотки
    // к серии в эфире: она и так по умолчанию первая в фокусе.
    const animate = scrollActive && gridWasActive.current;
    gridWasActive.current = scrollActive;
    const place = (y: number) => {
      if (animate) {
        el.style.transform = `translateY(${y}px)`;
        return;
      }
      el.style.transition = "none";
      el.style.transform = `translateY(${y}px)`;
      void el.offsetHeight; // зафиксировать позицию до восстановления перехода
      el.style.transition = "";
    };
    // Закрытая шторка: держим сетку наверху, чтобы «уши» первого ряда выглядывали
    if (!scrollActive) {
      gridScroll.current = 0;
      place(0);
      return;
    }
    const vh = vp.clientHeight;
    // Мало серий (влезают в кадр) — прижимаем сетку к низу, без прокрутки
    if (bottomAnchor && el.scrollHeight <= vh) {
      gridScroll.current = 0;
      place(vh - el.scrollHeight);
      return;
    }
    const idx = focusedIndex ?? anchorIndex ?? 0;
    const card = el.querySelector<HTMLElement>(`[data-railindex="${idx}"]`);
    if (!card) return;
    // Запас у краёв, чтобы обводка фокусной карточки не упиралась в границу кадра
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
  }, [grid, focusedIndex, anchorIndex, count, bottomAnchor, scrollActive]);

  useLayoutEffect(() => {
    if (grid) return;
    const el = railRef.current;
    if (!el) return;
    const before = prev.current;
    prev.current = { index: anchorIndex, count, mounted: true };
    // Открытие шторки: встаём в позицию мгновенно, без анимированной перемотки
    // к серии в эфире (она и так первая в фокусе по умолчанию)
    const justOpened = scrollActive && !hWasActive.current;
    hWasActive.current = scrollActive;
    const next = baseOffset(anchorIndex);
    const move = (px: number) => (el.style.transform = `translateX(${-px}px)`);

    const wrappedLeft = canLoop && before.index === 0 && anchorIndex === count - 1;
    const wrappedRight = canLoop && before.index === count - 1 && anchorIndex === 0;

    if (!before.mounted || before.count !== count || justOpened) {
      // Монтирование, смена сезона или открытие шторки — встаём в позицию без анимации
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
  }, [anchorIndex, canLoop, count, cardStep, clones, scrollActive]);

  const renderCard = (
    episode: IviEpisode,
    index: number,
    key: string,
    clone: boolean,
    lastInSeason?: boolean,
  ) => {
    const current = !clone && episode.id === currentId;
    const focused = !clone && focusedIndex === index;
    const locked = episode.isLocked; // подписочная серия (вышедшая или ещё нет)
    const upcoming = episode.availability === "upcoming";
    const upcomingFree = upcoming && !locked;
    const reminded = upcomingFree && Boolean(reminders?.has(episode.id));
    // Финал: последняя серия сезона, которая ещё не вышла — иконка на постере и «Финал».
    const isLast = lastInSeason ?? episodes[count - 1]?.id === episode.id;
    const isFinale = !clone && recom && upcoming && isLast;
    // Шильд «По подписке» — только у подписочной серии в фокусе (вместо тайминга)
    const showShield = !clone && paid && focused && locked;
    // Тайминг — у вышедших серий; у подписочной закрытой — только вне фокуса
    const showDuration =
      episode.availability === "available" && (!locked || paid);
    // Просмотренная серия (не та, что сейчас идёт): затемнение, глазик, «Просмотрено»
    const isWatched =
      !clone && episode.availability === "available" && !current && Boolean(watched?.has(episode.id));
    // Начатая, но недосмотренная (и ещё не в «просмотрено»): глазик, но «Начато»
    const isStarted =
      !clone &&
      episode.availability === "available" &&
      !current &&
      !isWatched &&
      Boolean(started?.has(episode.id));
    // Вторая строка: шильд, зелёная дата, «Просмотрено», остаток минут или тайминг
    // (у финала «Финал» пишется на постере, а снизу остаётся дата выхода)
    let secondLine: ReactNode;
    if (showShield) {
      // По подписке — просто белым текстом, без иконки
      secondLine = <small className="paid-shield-text">По подписке</small>;
    } else if (upcoming && recom) {
      // «С рекомом»: дата выхода снизу зелёным (в «Без рекома» она поверх постера)
      secondLine = <small className="release-date">{availabilityLabel(episode)}</small>;
    } else if (current) {
      // Серия «в эфире»: сколько минут осталось до конца (тикает вживую)
      secondLine = <RemainingLabel playhead={playhead} duration={duration} />;
    } else if (isWatched) {
      secondLine = <small className="seen-label">Просмотрено</small>;
    } else if (isStarted) {
      // Начата, но не досмотрена — вместо «Начато» остаток минут до конца
      secondLine = (
        <small>еще {remainingMinutes(episode.durationSec * (1 - STARTED_PROGRESS))} мин</small>
      );
    } else {
      // Шильд «смотрят N» (демо: 7 серия) идёт перед таймингом в той же строке
      const watchCount = !clone ? watching?.get(episode.id) : undefined;
      secondLine = (
        <small className={showDuration || watchCount ? "meta-line" : "empty"}>
          {watchCount ? (
            <span className="watch-badge">
              <img className="watch-badge-icon" src="/icons/watching-eyes.png" alt="" />
              смотрят {watchCount}
            </span>
          ) : null}
          {showDuration ? (
            <span>{formatMinutes(episode.durationSec)}</span>
          ) : watchCount ? null : (
            " "
          )}
        </small>
      );
    }

    return (
      <div
        key={key}
        className={`episode-card${current ? " current" : ""}${focused ? " focused" : ""} availability-${
          episode.availability
        }${locked ? " locked" : ""}${clone ? " clone" : ""}${isWatched ? " watched" : ""}${
          isStarted ? " started" : ""
        }`}
        data-railindex={clone ? undefined : index}
        aria-disabled={episode.availability !== "available" || locked}
        aria-hidden={clone || undefined}
      >
        <div className="poster">
          {episode.thumb ? <img src={episode.thumb} alt="" loading="lazy" /> : null}
          {isFinale && !focused ? (
            // Финал сезона (ещё не вышел): вне фокуса — иконка и подпись «Финал» на
            // постере; в фокусе финал ведёт себя как обычная невышедшая серия ниже
            <div className="availability-overlay finale-overlay">
              <img className="finale-icon" src="/icons/final.svg" alt="" />
              <span className="finale-caption">Финал</span>
            </div>
          ) : locked ? (
            <div className="availability-overlay">
              <img className="lock-icon" src="/icons/locked.svg" alt="По подписке" />
            </div>
          ) : upcomingFree && recom ? (
            // Невышедшая бесплатная серия: вне фокуса — иконка часов, в фокусе —
            // колокольчик с предложением напомнить о выходе
            <div className="availability-overlay notify-overlay">
              {focused ? (
                <>
                  <img className="notify-bell" src="/icons/pull.svg" alt="" />
                  <span>{reminded ? "Напоминание включено" : "Напомнить"}</span>
                </>
              ) : (
                <img className="notify-clock" src="/icons/clock.svg" alt="Скоро" />
              )}
            </div>
          ) : current ? (
            // Серия «в эфире»: на постере контур плея (пропадает в фокусе)
            <div className="availability-overlay onair-overlay">
              <img className="onair-poster-icon" src="/icons/onair-poster.svg" alt="Сейчас в эфире" />
            </div>
          ) : episode.availability !== "available" ? (
            // «Без рекома» (и «Недоступно»): подпись поверх постера, как раньше
            <div className="availability-overlay">{availabilityLabel(episode)}</div>
          ) : null}
          {current ? (
            <PosterProgress playhead={playhead} duration={duration} />
          ) : isWatched ? (
            // Просмотрено полностью — полоса прогресса на всю ширину
            <div className="poster-progress">
              <span style={{ width: "100%" }} />
            </div>
          ) : isStarted ? (
            // Начато — неполная полоса прогресса
            <div className="poster-progress">
              <span style={{ width: "45%" }} />
            </div>
          ) : null}
        </div>
        <EpisodeTitle text={episodeTitle(episode)} focused={focused} />
        {secondLine}
      </div>
    );
  };

  // Карточка подписки перед первой серией у платного тайтла: постер с замком,
  // в мете — название подписки и цена вместо тайминга.
  const renderSubCard = (focused: boolean) => (
    <div
      key="subscription-card"
      className={`episode-card sub-card${focused ? " focused" : ""}`}
      data-railindex={0}
      aria-label={`Подписка ${subName}`}
    >
      <div className="poster sub-poster">
        <div className="availability-overlay">
          <img className="lock-icon" src="/icons/locked.svg" alt="По подписке" />
        </div>
      </div>
      <p className="episode-line">
        <span className="ep-title-clip">
          <span className="ep-title-text">{subName}</span>
        </span>
      </p>
      <small className="sub-price">{subPrice}</small>
    </div>
  );

  // Непрерывная лента всех сезонов: перед каждым сезоном — заголовок-разделитель,
  // затем его серии со сквозным railindex (после карточки подписки, если есть).
  const renderContinuousSeasons = () => {
    const seasons = gridSeasons ?? [];
    let flat = lead;
    return seasons.map((s, si) => {
      const cards = s.episodes.map((ep, i) => {
        const idx = flat;
        flat += 1;
        return renderCard(ep, idx, `${ep.id}`, false, i === s.episodes.length - 1);
      });
      return (
        <Fragment key={`season-${s.number}`}>
          {/* Разделитель — между сезонами (перед первым не нужен: его показывает таб) */}
          {si > 0 ? <div className="season-divider">{s.number} сезон</div> : null}
          {cards}
        </Fragment>
      );
    });
  };

  return (
    <div className="rail-viewport">
      <div
        ref={railRef}
        className={grid ? "rail grid" : "rail"}
        style={grid ? ({ "--grid-cols": columns } as CSSProperties) : undefined}
      >
        {grid ? (
          <>
            {subCard ? renderSubCard(focusedIndex === 0) : null}
            {/* Вертикаль 1 — непрерывная лента (gridSeasons); Вертикаль 2 — только
                серии активного сезона (обычный список с тем же railindex) */}
            {gridSeasons
              ? renderContinuousSeasons()
              : episodes.map((episode, i) =>
                  renderCard(episode, lead + i, `${episode.id}`, false),
                )}
          </>
        ) : (
          <>
            {subCard ? renderSubCard(focusedIndex === 0) : null}
            {canLoop
              ? episodes
                  .slice(count - clones)
                  .map((episode, i) => renderCard(episode, -1, `clone-l-${episode.id}-${i}`, true))
              : null}
            {episodes.map((episode, index) =>
              renderCard(episode, lead + index, `${episode.id}`, false),
            )}
            {canLoop
              ? episodes
                  .slice(0, clones)
                  .map((episode, i) => renderCard(episode, -1, `clone-r-${episode.id}-${i}`, true))
              : null}
          </>
        )}
      </div>
    </div>
  );
});

/*
  Название серии. Размер шрифта не уменьшаем — длинные названия остаются такими
  же, как короткие. Вне фокуса длинное название обрезается с растушёвкой справа.
  В фокусе на серии оно едет бегущей строкой по кругу: текст продублирован через
  отступ и едет непрерывно влево, без возврата назад — доехав на одну копию,
  строка бесшовно повторяется. Иконка «в эфире» не едет — стоит слева.
*/
// Отступ между копиями названия в бегущей строке (в пикселях)
const MARQUEE_GAP = 24;
// Пауза в начале названия перед каждым прогоном (секунды)
const MARQUEE_HOLD = 3;
// Скорость бегущей строки (пикселей в секунду) — медленно
const MARQUEE_SPEED = 28;

function EpisodeTitle({ text, focused }: { text: string; focused: boolean }) {
  const clipRef = useRef<HTMLSpanElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  // Режим строки: влезает / обрезано (растушёвка справа) / бегущая строка
  const [mode, setMode] = useState<"fit" | "clip" | "marquee">("fit");

  useLayoutEffect(() => {
    const clip = clipRef.current;
    const track = trackRef.current;
    const el = textRef.current;
    if (!clip || !track || !el) return;
    track.style.transform = "translateX(0)";
    const overflow = el.scrollWidth - clip.clientWidth;
    if (overflow <= 1) {
      setMode("fit");
      return;
    }
    // Не в фокусе — просто обрезаем с растушёвкой справа, без анимации
    if (!focused) {
      setMode("clip");
      return;
    }
    // В фокусе — непрерывная бегущая строка по кругу: едем ровно на одну копию
    // (ширина текста + отступ), затем бесшовно повторяем с начала
    setMode("marquee");
    const distance = el.scrollWidth + MARQUEE_GAP;
    const scrollSec = distance / MARQUEE_SPEED;
    const totalSec = MARQUEE_HOLD + scrollSec;
    // 3 c стоим в начале, затем медленно уезжаем ровно на одну копию (текст + отступ)
    // и бесшовно повторяем с начала — снова пауза 3 c и так по кругу
    const animation = track.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: MARQUEE_HOLD / totalSec },
        { transform: `translateX(${-distance}px)`, offset: 1 },
      ],
      { duration: totalSec * 1000, iterations: Infinity, easing: "linear" },
    );
    return () => animation.cancel();
  }, [text, focused]);

  return (
    <p className="episode-line">
      <span
        className={`ep-title-clip${mode === "clip" ? " clipped" : ""}${
          mode === "marquee" ? " marquee" : ""
        }`}
        ref={clipRef}
      >
        <span className="ep-title-track" ref={trackRef}>
          <span className="ep-title-text" ref={textRef}>
            {text}
          </span>
          <span className="ep-title-text ep-title-dup" aria-hidden="true">
            {text}
          </span>
        </span>
      </span>
    </p>
  );
}

// Остаток минут до конца серии для «в эфире»: тикает вживую по playhead
function RemainingLabel({ playhead, duration }: { playhead: PlayheadStore; duration: number }) {
  const current = usePlayhead(playhead);
  const left = Math.max(0, duration - current);
  return <small>еще {remainingMinutes(left)} мин</small>;
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

/*
  Название серии: если на Иви у серии реальное название (не просто «Серия N»),
  показываем его; иначе — стандартное «N серия».
*/
function episodeTitle(episode: IviEpisode): string {
  const title = (episode.title || "").trim();
  // Служебное название — «Серия» и только номера (в т.ч. склейки «1+2», «1-2»).
  // Настоящее название с текстом («Серия 1. Начало») сюда не попадает.
  const generic =
    !title ||
    /^серия\s*[\d+\-–,\s]+$/i.test(title) ||
    /^[\d+\-–,\s]+\s*серия$/i.test(title) ||
    /^эпизод\s*[\d+\-–,\s]+$/i.test(title);
  return generic ? `${episode.episode} серия` : title;
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
