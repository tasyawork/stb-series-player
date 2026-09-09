import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IviEpisode, IviSeries } from "../ivi/types";
import { EpisodeRail } from "./EpisodeRail";
import { NotifyButton } from "./NotifyButton";
import { createPlayhead } from "./playhead";
import { RecommendationRail } from "./RecommendationRail";
import { SeasonTabs } from "./SeasonTabs";
import { Seekbar } from "./Seekbar";
import { SubscriptionButton } from "./SubscriptionButton";

const ROWS = [
  ["back"],
  ["prev", "pause", "next", "quality", "audio"],
  ["seek"],
  ["seasons"],
  ["episodes"],
  ["subscription", "notify", "recom"],
] as const;

type Focus =
  | "back"
  | "prev"
  | "pause"
  | "next"
  | "quality"
  | "audio"
  | "seek"
  | "seasons"
  | "episodes"
  | "notify"
  | "subscription"
  | "recom";

const CONTROLS_ROW = 1;
const BROWSE_ROW = 3;

// HTMLMediaElement.HAVE_FUTURE_DATA: с этого момента есть чем показать следующий кадр
const HAVE_FUTURE_DATA = 3;
// Порог, за которым пауза в подкачке считается настоящей, а не рябью между кадрами
const BUFFER_GRACE_MS = 500;
// Если за это время браузер так и не отдал кадр, файл ему не по зубам
const GIVE_UP_MS = 12000;
// timeupdate в разных движках приходит неровно, поэтому движение кадров ещё и опрашиваем
const PLAYBACK_POLL_MS = 200;

type PanelOption = { kind: "quality" | "audio" | "subtitle"; value: string };

// Вариант прототипа: "plain" — базовый, "recom" — с рекомендациями.
// Пока оба ведут себя одинаково; крючок для будущих правок второго варианта.
// "vertical" пока ведёт себя как plain — ветки редизайна завязаны на "recom"
// "vertical" — Вертикаль 1 (табы сверху, непрерывная лента всех сезонов),
// "vertical2" — Вертикаль 2 (табы слева, посезонно, вертикальный скролл)
type PlayerVariant = "plain" | "recom" | "vertical" | "vertical2";

// Тип контента: сериал (серии с табами сезонов) или фильм (две галереи)
type PlayerContent = "series" | "film";

type PlayerScreenProps = {
  series: IviSeries;
  onExit: () => void;
  variant?: PlayerVariant;
  content?: PlayerContent;
  /* Фильм «Вертикаль»: вторая галерея — сетка со скроллом вниз (4 в ряду) */
  filmVertical?: boolean;
};

function PlayerScreenView({
  series,
  onExit,
  variant = "plain",
  content = "series",
  filmVertical = false,
}: PlayerScreenProps) {
  const [activeSeason, setActiveSeason] = useState(series.loadedSeason);
  /*
    Демо-«история просмотра»:
    — «Холод»: первые 3 серии просмотрены, 4-я начата (но не досмотрена),
      «в эфире» пятая (её таймлайн стоит на середине);
    — «Дар» (много серий): первые 20 серий просмотрены полностью, а сейчас идёт
      21-я — при заходе в серии фокус сразу на ней, а просмотренные уходят вверх.
  */
  const demoWatchedCount =
    series.slug === "holod" ? 3 : series.slug === "dar" ? 20 : 0;
  const demoWatchedIds = demoWatchedCount
    ? series.episodes
        .filter((item) => item.availability === "available")
        .slice(0, demoWatchedCount)
        .map((item) => item.id)
    : [];
  const demoWatched = new Set(demoWatchedIds);
  /*
    Демо: четвёртую вышедшую серию «Холода» показываем начатой, но недосмотренной —
    у неё глазик, «Начато» и неполный таймлайн (сразу после просмотренных 1-3).
  */
  const demoStartedIds =
    series.slug === "holod"
      ? series.episodes
          .filter((item) => item.availability === "available")
          .slice(3, 4)
          .map((item) => item.id)
      : [];
  const demoStarted = new Set(demoStartedIds);
  /*
    Демо-шильд «смотрят 50K»: у «Холода» показываем его на 7-й серии — перед
    таймингом появляется счётчик зрителей с иконкой.
  */
  const demoWatching = new Map<number, string>();
  if (series.slug === "holod") {
    const ep7 = series.episodes.find(
      (item) => item.season === series.loadedSeason && item.episode === 7,
    );
    if (ep7) demoWatching.set(ep7.id, "50K");
  }
  // Открываем сезон на серии, которую действительно можно смотреть: под замком
  // играть нечего, просмотренные и начатую пропускаем — стартуем на седьмой (в эфире)
  const firstEpisode =
    series.episodes.find(
      (item) =>
        item.season === series.loadedSeason &&
        item.availability === "available" &&
        !item.isLocked &&
        !demoWatched.has(item.id) &&
        !demoStarted.has(item.id),
    ) ??
    series.episodes.find(
      (item) =>
        item.season === series.loadedSeason && item.availability === "available" && !item.isLocked,
    ) ??
    series.episodes.find(
      (item) => item.season === series.loadedSeason && item.availability === "available",
    ) ??
    series.episodes[0];
  // Демо: у «Холода» текущую (седьмую) серию открываем на середине таймлайна
  const demoHalfWatchedId = series.slug === "holod" ? firstEpisode?.id : undefined;
  const [episodeId, setEpisodeId] = useState(firstEpisode?.id ?? 0);
  const [playing, setPlaying] = useState(true);
  const [focus, setFocus] = useState<Focus>("pause");
  const [railIndex, setRailIndex] = useState(0);
  // Вертикаль 1: прокручена ли сетка (ряды ушли под шапку) — включает затемнение под табами
  const [gridScrolled, setGridScrolled] = useState(false);
  // Фокус во второй галерее «От того же режиссёра» (только вариант recom)
  const [recomIndex, setRecomIndex] = useState(0);
  const [panel, setPanel] = useState<"quality" | "audio" | null>(null);
  const [panelIndex, setPanelIndex] = useState(0);
  const [quality, setQuality] = useState("Авто");
  const [audio, setAudio] = useState(series.capabilities.audioTracks[0] ?? "Русский");
  const [subtitle, setSubtitle] = useState("Без субтитров");
  const [notify, setNotify] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activity, setActivity] = useState(0);
  const [videoStage, setVideoStage] = useState<"loading" | "ready">("loading");
  const [buffering, setBuffering] = useState(false);
  // Картинка заглушки не загрузилась: в кадре должен остаться ровный тёмный фон,
  // а не значок битого изображения
  const [stillBroken, setStillBroken] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bufferTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const browseOriginRef = useRef<{ season: number; index: number } | null>(null);
  // Разгон листинга серий при удержании стрелки: копим повторы и растим шаг
  const railRepeatRef = useRef<{ dir: number; count: number }>({ dir: 0, count: 0 });
  // Напоминания о выходе невышедших (бесплатных) серий — по id серии
  const [episodeReminders, setEpisodeReminders] = useState<Set<number>>(() => new Set());
  // Полностью просмотренные серии (демо-набор «Холода»): «Просмотрено» + полный таймлайн
  const [watchedEpisodes] = useState<Set<number>>(() => new Set(demoWatchedIds));
  // Начатые, но недосмотренные: те, что открывали в этом сеансе, плюс демо-набор
  const [startedEpisodes, setStartedEpisodes] = useState<Set<number>>(
    () => new Set(demoStartedIds),
  );
  // Последняя замеченная позиция и факт того, что кадры уже реально ехали:
  // по ним отличаем идущее воспроизведение от замершего первого кадра
  const playbackTimeRef = useRef<number | null>(null);
  const playbackStartedRef = useRef(false);
  // Предохранитель уже сработал: спиннер больше не поднимаем, показываем видео как есть
  const gaveUpRef = useRef(false);
  // Копии стадии и буферизации: события видео идут пачками несколько раз в
  // секунду, и по рефам видно, что состояние менять не нужно, без ререндера
  const videoStageRef = useRef(videoStage);
  const bufferingRef = useRef(false);

  // Позиция воспроизведения обновляется вне состояния: см. playhead.ts
  const playheadRef = useRef<ReturnType<typeof createPlayhead> | null>(null);
  playheadRef.current ??= createPlayhead();
  const playhead = playheadRef.current;

  const applyVideoStage = useCallback((next: "loading" | "ready") => {
    if (videoStageRef.current === next) return;
    videoStageRef.current = next;
    setVideoStage(next);
  }, []);

  const applyBuffering = useCallback((next: boolean) => {
    if (bufferingRef.current === next) return;
    bufferingRef.current = next;
    setBuffering(next);
  }, []);

  const episodesBySeason = useMemo(
    () =>
      series.episodes.reduce<Record<number, IviEpisode[]>>((groups, item) => {
        (groups[item.season] ??= []).push(item);
        return groups;
      }, {}),
    [series.episodes],
  );
  const seasonEpisodes = episodesBySeason[activeSeason] ?? [];
  const playlist = series.episodes;
  const playableEpisodes = useMemo(
    () => playlist.filter((item) => item.availability === "available" && !item.isLocked),
    [playlist],
  );
  const episode = useMemo(
    () => playlist.find((item) => item.id === episodeId) ?? playlist[0],
    [episodeId, playlist],
  );
  // Локальные MP4 есть только у пресетов: настоящий контент Иви закрыт DRM.
  // Для произвольной ссылки videoUrl пустой, и вместо кадра играет заглушка-скрин
  const src = episode?.videoUrl;
  const still = src ? "" : episode?.thumb || episode?.poster || series.backdrop || "";
  const duration = episode?.durationSec ?? 0;

  // WebKit принимает решение об автоплее при назначении src. Поэтому сначала
  // синхронно закрепляем muted как свойство и атрибут, и лишь затем даём источник.
  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      videoRef.current = video;
      if (!video) return;
      video.defaultMuted = true;
      video.muted = true;
      video.setAttribute("muted", "");
      video.playsInline = true;
      if (src) video.src = src;
    },
    [src],
  );

  const focusRow = ROWS.findIndex((row) => (row as readonly string[]).includes(focus));
  const browsing = focusRow >= BROWSE_ROW;
  // Замок на карточке без предложения подписки — тупик: кнопка нужна и когда
  // права размечены только на сезонах, и когда в выдаче есть запертые серии
  const hasLockedEpisodes = useMemo(() => playlist.some((item) => item.isLocked), [playlist]);
  const showSubscriptionOffer =
    !series.subscriptionActive && (series.subscriptionRequired || hasLockedEpisodes);

  // Вариант «С рекомом»: постеры крупнее (224×126), нижних кнопок нет, а под
  // рядом серий добавлена полка «От того же режиссёра». variant приходит из App
  // и не меняется в течение монтирования (смена вкладки перемонтирует плеер).
  /*
    Фильм показывает две галереи вместо серий, поэтому наследует раскладку
    «С рекомом» (крупные постеры, двухступенчатая шторка) независимо от левого
    переключателя. Обе галереи наполнены рекомендациями «Смотрят вместе с».
  */
  const isFilm = content === "film";
  const isRecom = variant === "recom" || isFilm;
  // Один сезон — таб становится некликабельным заголовком, фокус на него не идёт
  const singleSeason = series.seasons.length <= 1;
  // Ряд серий всегда 152 (как в «Без рекома»), галереи рекомендаций — 224
  const EPISODE_CARD_W = 152;
  const RECOM_CARD_W = 224;
  // Сетка серий (вертикальный скролл) — оба вертикальных режима:
  //  gridTop  (Вертикаль 1): табы сверху, непрерывная лента всех сезонов;
  //  gridLeft (Вертикаль 2): табы слева, посезонно (прежняя раскладка).
  const gridTop = content === "series" && variant === "vertical";
  const gridLeft = content === "series" && variant === "vertical2";
  const gridLayout = gridTop || gridLeft;
  const GRID_COLUMNS = 4;
  // Платный тайтл без активной подписки: перед первой серией — карточка подписки.
  // Она занимает ячейку 0 ряда, сдвигая индексы реальных серий на subOffset.
  const showSubCard =
    (isRecom || gridLayout) &&
    series.subscriptionRequired &&
    !series.subscriptionActive;
  const subOffset = showSubCard ? 1 : 0;
  const SUB_NAME = "ИВИ + Амедиатека";
  const SUB_PRICE = "399 ₽";
  /*
    Вертикальная сетка — непрерывная лента всех сезонов: серии всех сезонов идут
    подряд, между сезонами — заголовок-разделитель «N сезон». Индекс ряда
    (railIndex) в сетке нумерует карточки-фокусы подряд: 0 — карточка подписки
    (если есть), дальше серии всех сезонов по порядку. Разделители не фокусируются.
  */
  const gridSeasons = useMemo(
    () =>
      series.seasons.map((s) => ({
        number: s.number,
        year: s.year,
        episodes: episodesBySeason[s.number] ?? [],
      })),
    [series.seasons, episodesBySeason],
  );
  // Плоский список серий всех сезонов и индекс серии, с которой начинается сезон
  const gridFlat = useMemo(() => gridSeasons.flatMap((s) => s.episodes), [gridSeasons]);
  const seasonFlatStart = useMemo(() => {
    const map = new Map<number, number>();
    let acc = 0;
    for (const s of gridSeasons) {
      map.set(s.number, acc);
      acc += s.episodes.length;
    }
    return map;
  }, [gridSeasons]);
  // Число фокусируемых ячеек ряда: карточка подписки + все серии всех сезонов
  // Вертикаль 1 — сквозь все сезоны; Вертикаль 2 — только активный сезон
  const railCount = subOffset + (gridTop ? gridFlat.length : seasonEpisodes.length);
  /*
    Две галереи фильма: берём готовые именованные подборки (series.galleries),
    а если их нет — откатываемся на общий ряд рекомендаций (вторую полку
    разворачиваем, чтобы она не читалась как дубль первой).
  */
  const filmTop = isFilm ? series.galleries?.[0] : undefined;
  const filmBottom = isFilm ? series.galleries?.[1] : undefined;
  const filmTopItems = filmTop?.items ?? series.recommendations;
  const filmBottomRow = useMemo(
    () => (isFilm ? [...series.recommendations].reverse() : series.recommendations),
    [isFilm, series.recommendations],
  );
  const filmBottomItems = filmBottom?.items ?? filmBottomRow;
  const filmTopTitle = filmTop?.title ?? `Смотрят вместе с «${series.title}»`;
  const filmBottomTitle = filmBottom?.title ?? "Похожие фильмы";
  // Платный тайтл в recom: у постера в фокусе градиентная рамка вместо белой
  // обводки и шильд «По подписке» в подписи. Триггер — подписочный контент
  // (SVOD/платные сезоны); тариф (Старт, Медиатека…) роли не играет.
  const paidBadge = (isRecom || gridLayout) && series.subscriptionRequired;

  const qualityOptions = useMemo(
    () => ["Авто", ...series.capabilities.qualities.filter((item) => item !== "Авто")],
    [series.capabilities.qualities],
  );
  const subtitleOptions = useMemo(
    () => ["Без субтитров", ...series.capabilities.subtitles],
    [series.capabilities.subtitles],
  );
  // Плоский список пунктов открытой панели: по нему ходят стрелки вверх-вниз
  const panelOptions = useMemo<PanelOption[]>(() => {
    if (panel === "quality") {
      return qualityOptions.map((value) => ({ kind: "quality" as const, value }));
    }
    if (panel === "audio") {
      return [
        ...series.capabilities.audioTracks.map((value) => ({ kind: "audio" as const, value })),
        ...subtitleOptions.map((value) => ({ kind: "subtitle" as const, value })),
      ];
    }
    return [];
  }, [panel, qualityOptions, series.capabilities.audioTracks, subtitleOptions]);

  const applyPanelOption = useCallback((option: PanelOption) => {
    if (option.kind === "quality") setQuality(option.value);
    if (option.kind === "audio") setAudio(option.value);
    if (option.kind === "subtitle") setSubtitle(option.value);
    setPanel(null);
  }, []);

  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    setActivity((value) => value + 1);
  }, []);

  const clearBufferTimer = useCallback(() => {
    if (bufferTimerRef.current === null) return;
    window.clearTimeout(bufferTimerRef.current);
    bufferTimerRef.current = null;
  }, []);

  const markVideoReady = useCallback(() => {
    clearBufferTimer();
    applyBuffering(false);
    applyVideoStage("ready");
  }, [applyBuffering, applyVideoStage, clearBufferTimer]);

  // Готовность — это не декодированный первый кадр, а поехавшие кадры:
  // пока currentTime стоит на месте, лоадер остаётся
  const trackPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const previous = playbackTimeRef.current;
    const position = video.currentTime;
    playbackTimeRef.current = position;
    if (video.paused || previous === null || position <= previous) return;
    playbackStartedRef.current = true;
    // timeupdate приходит четыре раза в секунду: пока лоадеру нечего менять,
    // до состояния не доходим вообще
    const settled =
      videoStageRef.current === "ready" && !bufferingRef.current && bufferTimerRef.current === null;
    if (settled) return;
    markVideoReady();
  }, [markVideoReady]);

  // playing только обещает движение. Для уже игравшей серии обещанию верим
  // (иначе лоадер мигал бы после каждой паузы), для первого старта — ждём кадров
  const handleVideoPlaying = useCallback(() => {
    playbackTimeRef.current = videoRef.current?.currentTime ?? 0;
    if (playbackStartedRef.current) markVideoReady();
  }, [markVideoReady]);

  // Короткие подкачки на ходу лоадером не показываем: он всплывает,
  // только если кадры не двигаются дольше порога
  const markVideoBuffering = useCallback(() => {
    if (gaveUpRef.current || bufferTimerRef.current !== null) return;
    const positionAtStart = videoRef.current?.currentTime ?? null;
    bufferTimerRef.current = window.setTimeout(() => {
      bufferTimerRef.current = null;
      const video = videoRef.current;
      if (!video) return;
      // Пауза по пульту — это не ожидание данных
      if (video.paused && playbackStartedRef.current) return;
      const advanced = positionAtStart !== null && video.currentTime > positionAtStart;
      if (advanced && video.readyState >= HAVE_FUTURE_DATA) return;
      applyBuffering(true);
    }, BUFFER_GRACE_MS);
  }, [applyBuffering]);

  // Спиннер снимаем и когда кадры так и не поехали: <video> остаётся в разметке,
  // подменять его постером нечем — заглушка перед видео на первом экране запрещена
  const stopWaiting = useCallback(() => {
    gaveUpRef.current = true;
    markVideoReady();
  }, [markVideoReady]);

  useEffect(() => {
    // Демо: седьмую серию «Холода» открываем на середине таймлайна, будто её
    // досмотрели до половины; остальные серии стартуют с нуля. Условие
    // идемпотентно (одинаково при повторном прогоне эффекта в StrictMode).
    const seedHalf = episodeId === demoHalfWatchedId && (episode?.durationSec ?? 0) > 0;
    playhead.set(seedHalf ? (episode?.durationSec ?? 0) / 2 : 0);
    setPlaying(true);
    // Ждать нечего, когда видео и нет: серия без источника сразу «готова»
    applyVideoStage(src ? "loading" : "ready");
    applyBuffering(false);
    clearBufferTimer();
    setStillBroken(false);
    playbackTimeRef.current = null;
    playbackStartedRef.current = false;
    gaveUpRef.current = false;
    if (videoRef.current) videoRef.current.currentTime = 0;
  }, [
    applyBuffering,
    applyVideoStage,
    clearBufferTimer,
    demoHalfWatchedId,
    episode?.durationSec,
    episodeId,
    playhead,
    src,
  ]);

  useEffect(
    () => () => {
      clearBufferTimer();
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [clearBufferTimer],
  );

  // Открытая серия считается начатой: помечаем её id, чтобы дальше показать
  // затемнение, глазик и «Начато» (если её не досмотрели полностью)
  useEffect(() => {
    setStartedEpisodes((seen) => (seen.has(episodeId) ? seen : new Set(seen).add(episodeId)));
  }, [episodeId]);

  // Кадры так и не поехали: дальше крутить спиннер бессмысленно
  useEffect(() => {
    if (videoStage !== "loading" || !src) return;
    const timer = window.setTimeout(stopWaiting, GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [src, stopWaiting, videoStage]);

  // Демо-видео короче серии, поэтому крутится в цикле, но реагирует на паузу.
  // В WebKit ранний play() может быть отклонён до появления декодируемых данных:
  // повторяем попытку на loadeddata/canplay, не объявляя застывший кадр готовым.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) {
      video.pause();
      // Кадр стоит по воле пользователя — ждать настоящего playing больше нечего
      if (video.readyState >= HAVE_FUTURE_DATA) markVideoReady();
      return;
    }
    let abandoned = false;
    const tryPlay = () => {
      if (abandoned) return;
      video.defaultMuted = true;
      video.muted = true;
      video.setAttribute("muted", "");
      void video.play().catch(() => {
        // Следующий media event повторит попытку, а 12-секундный предохранитель
        // в любом случае уберёт спиннер и оставит на экране сам <video>.
      });
    };
    tryPlay();
    video.addEventListener("loadeddata", tryPlay);
    video.addEventListener("canplay", tryPlay);
    const retryId = window.setInterval(() => {
      if (video.paused) tryPlay();
    }, PLAYBACK_POLL_MS);
    return () => {
      abandoned = true;
      window.clearInterval(retryId);
      video.removeEventListener("loadeddata", tryPlay);
      video.removeEventListener("canplay", tryPlay);
    };
  }, [markVideoReady, playing, episodeId]);

  // Пока лоадер на экране, сами приглядываем за позицией: событий timeupdate
  // на замершем кадре может не быть вовсе
  useEffect(() => {
    if (videoStage !== "loading" || !playing || !src) return;
    const id = window.setInterval(trackPlayback, PLAYBACK_POLL_MS);
    return () => window.clearInterval(id);
  }, [playing, src, trackPlayback, videoStage]);

  // Ход времени пишем в playhead, а не в состояние: иначе каждый тик
  // перерисовывал бы весь экран вместе с рельсой серий
  useEffect(() => {
    if (!playing || !duration) return;
    const id = window.setInterval(() => {
      const next = playhead.get() + 0.25;
      if (next >= duration) {
        playhead.set(duration);
        setPlaying(false);
        return;
      }
      playhead.set(next);
    }, 250);
    return () => window.clearInterval(id);
  }, [duration, playhead, playing]);

  useEffect(() => {
    if (browsing) {
      setControlsVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setControlsVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [activity, browsing]);

  const selectSeason = useCallback(
    (season: number) => {
      setActiveSeason(season);
      setRecomIndex(0);
      // В сетке лента непрерывная — прыгаем к первой серии выбранного сезона;
      // в остальных раскладках сезон меняет содержимое ряда, начинаем с начала
      if (gridTop) setRailIndex(subOffset + (seasonFlatStart.get(season) ?? 0));
      else setRailIndex(0);
    },
    [gridTop, subOffset, seasonFlatStart],
  );

  const playableIndex = playableEpisodes.findIndex((item) => item.id === episode?.id);
  const hasPrev = playableIndex > 0;
  const hasNext = playableIndex >= 0 && playableIndex < playableEpisodes.length - 1;

  // Кнопка «вперёд» скрыта на последней серии и во всём фильме — фокус на ней держать нельзя
  useEffect(() => {
    if (focus === "next" && (!hasNext || isFilm)) setFocus("pause");
  }, [focus, hasNext, isFilm]);

  const goRelative = useCallback(
    (delta: number) => {
      const index = playableEpisodes.findIndex((item) => item.id === episode?.id);
      const next = playableEpisodes[index + delta];
      if (next) setEpisodeId(next.id);
    },
    [episode?.id, playableEpisodes],
  );

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2200);
  }, []);

  const activate = useCallback(
    (id: Focus) => {
      if (id === "back") onExit();
      if (id === "pause") setPlaying((value) => !value);
      // На первой серии кнопка остаётся по макету и отматывает текущую серию к началу
      if (id === "prev") {
        if (hasPrev) goRelative(-1);
        else {
          playhead.set(0);
          if (videoRef.current) videoRef.current.currentTime = 0;
        }
      }
      if (id === "next") goRelative(1);
      if (id === "quality") {
        setPanel((value) => (value === "quality" ? null : "quality"));
        setPanelIndex(Math.max(0, qualityOptions.indexOf(quality)));
      }
      if (id === "audio") {
        setPanel((value) => (value === "audio" ? null : "audio"));
        setPanelIndex(Math.max(0, series.capabilities.audioTracks.indexOf(audio)));
      }
      if (id === "notify") setNotify((value) => !value);
      if (id === "subscription") {
        window.open(series.iviUrl, "_blank", "noopener,noreferrer");
      }
      if (id === "episodes") {
        // В фильме галерея — рекомендации-заглушки, выбирать в ней нечего
        if (isFilm) return;
        // Платный тайтл: ячейка 0 — карточка подписки, ОК открывает страницу подписки
        if (showSubCard && railIndex === 0) {
          window.open(series.iviUrl, "_blank", "noopener,noreferrer");
          return;
        }
        // В сетке ряд — непрерывная лента всех сезонов (gridFlat), иначе — серии
        // активного сезона. Карточка подписки (ячейка 0) уже обработана выше.
        const list = gridTop ? gridFlat : seasonEpisodes;
        const chosen = list[railIndex - subOffset];
        if (chosen?.isLocked) {
          showToast("Оформите подписку, чтобы смотреть эту серию");
        } else if (chosen?.availability === "available") {
          setEpisodeId(chosen.id);
        } else if (chosen?.availability === "upcoming") {
          const id = chosen.id;
          // Напоминание — фича «С рекомом»; в «Без рекома» просто сообщаем дату
          if (!isRecom) {
            showToast(
              chosen.releaseDate
                ? `Серия выйдет ${formatReleaseDate(chosen.releaseDate)}`
                : "Серия ещё не вышла",
            );
          } else {
            setEpisodeReminders((selected) => {
              const next = new Set(selected);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
            showToast(
              episodeReminders.has(id)
                ? "Напоминание отключено"
                : chosen.releaseDate
                  ? `Напомним ${formatReleaseDate(chosen.releaseDate)}`
                  : "Напомним о выходе",
            );
          }
        } else if (chosen) {
          showToast("Серия недоступна в текущем регионе");
        }
      }
    },
    [
      audio,
      episodeReminders,
      goRelative,
      gridFlat,
      gridTop,
      hasPrev,
      isFilm,
      isRecom,
      onExit,
      playhead,
      quality,
      qualityOptions,
      railIndex,
      seasonEpisodes,
      series.capabilities.audioTracks,
      series.iviUrl,
      showSubCard,
      subOffset,
      showToast,
    ],
  );

  useEffect(() => {
    function isReachable(id: Focus) {
      if (id === "next") return hasNext && !isFilm;
      if (id === "subscription") return !isRecom && showSubscriptionOffer;
      if (id === "notify") return !isRecom;
      if (id === "recom") return isRecom;
      return true;
    }

    function moveWithinRow(step: number) {
      const row = ROWS[focusRow] as readonly Focus[];
      for (let index = row.indexOf(focus) + step; row[index]; index += step) {
        if (isReachable(row[index])) {
          setFocus(row[index]);
          return;
        }
      }
    }

    function focusEpisodesIn(season: number) {
      // В сетке лента непрерывная: встаём на текущую (играющую) серию по всему
      // списку сезонов. В остальных раскладках — индекс серии внутри сезона.
      let baseIndex: number;
      if (gridTop) {
        const flat = gridFlat.findIndex((item) => item.id === episode?.id);
        baseIndex = flat >= 0 ? flat : (seasonFlatStart.get(season) ?? 0);
      } else {
        const episodes = episodesBySeason[season] ?? [];
        const index = episodes.findIndex((item) => item.id === episode?.id);
        baseIndex = index >= 0 ? index : 0;
      }
      // Платный тайтл: впереди карточка подписки — сдвигаем на неё все индексы
      const targetIndex = baseIndex + subOffset;
      browseOriginRef.current = { season, index: targetIndex };
      setActiveSeason(season);
      setRailIndex(targetIndex);
      setFocus("episodes");
    }

    // Сезон по индексу ряда (для синхронизации табов при навигации по сетке)
    function seasonAtRail(rail: number): number {
      const flat = rail - subOffset;
      if (flat < 0) return activeSeason;
      const found = gridFlat[Math.max(0, Math.min(gridFlat.length - 1, flat))];
      return found?.season ?? activeSeason;
    }

    // Вверх/вниз по сетке — по геометрии: ближайшая карточка ряда выше/ниже.
    // Возвращает railIndex или null (упёрлись/нет ряда в эту сторону).
    function gridNeighbor(dir: 1 | -1): number | null {
      const railEl = document.querySelector<HTMLElement>(".rail.grid");
      if (!railEl) return null;
      const cards = Array.from(railEl.querySelectorAll<HTMLElement>("[data-railindex]"));
      const currentEl = cards.find((c) => Number(c.dataset.railindex) === railIndex);
      if (!currentEl) return null;
      const cr = currentEl.getBoundingClientRect();
      const cx = cr.left + cr.width / 2;
      let best: { idx: number; dx: number; dy: number } | null = null;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        // Ряд ниже (dir 1) или выше (dir -1): центр по вертикали за пределами текущей карточки
        const below = r.top > cr.bottom - 4;
        const above = r.bottom < cr.top + 4;
        if ((dir === 1 && !below) || (dir === -1 && !above)) continue;
        const dx = Math.abs(r.left + r.width / 2 - cx);
        const dy = dir === 1 ? r.top - cr.bottom : cr.top - r.bottom;
        if (!best || dy < best.dy - 1 || (Math.abs(dy - best.dy) <= 1 && dx < best.dx)) {
          best = { idx: Number(c.dataset.railindex), dx, dy };
        }
      }
      return best ? best.idx : null;
    }

    function onKey(event: KeyboardEvent) {
      // Пока пользователь печатает ссылку в панели сверху, плеер не перехватывает клавиши
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.isContentEditable)) return;

      if (!controlsVisible) {
        event.preventDefault();
        wakeControls();
        return;
      }
      wakeControls();

      // Открытая панель настроек забирает управление: пульт умеет только стрелки, ОК и назад
      if (panel) {
        event.preventDefault();
        if (event.key === "Escape" || event.key === "Backspace" || event.key === "Delete") {
          setPanel(null);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1;
          setPanelIndex((value) =>
            Math.max(0, Math.min(panelOptions.length - 1, value + step)),
          );
          return;
        }
        if (event.key === "Enter") {
          const option = panelOptions[panelIndex];
          if (option) applyPanelOption(option);
        }
        return;
      }

      if (event.key === "Escape" || event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        if (browsing) {
          const origin = browseOriginRef.current;
          const movedFromOrigin =
            origin && (activeSeason !== origin.season || railIndex !== origin.index);
          if (origin && movedFromOrigin) {
            setActiveSeason(origin.season);
            setRailIndex(origin.index);
            setFocus("episodes");
            return;
          }
          setFocus("pause");
          return;
        }
        onExit();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        activate(focus);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        if (focus === "seek") {
          playhead.update((value) => Math.min(duration, Math.max(0, value + step * 10)));
          return;
        }
        if (focus === "episodes") {
          if (gridTop) {
            // Вертикаль 1: вправо/влево — соседняя карточка непрерывной ленты; таб
            // сверху подхватывает сезон новой карточки
            const total = railCount;
            const next = Math.max(0, Math.min(total - 1, railIndex + step));
            setRailIndex(next);
            const s = seasonAtRail(next);
            if (s !== activeSeason) setActiveSeason(s);
            return;
          }
          if (gridLeft) {
            // Вертикаль 2: вправо — следующая карточка; влево из левого столбца — к табам
            const total = railCount;
            if (step > 0) {
              setRailIndex((value) => Math.min(total - 1, value + 1));
            } else if (railIndex % GRID_COLUMNS === 0) {
              setFocus("seasons");
            } else {
              setRailIndex((value) => Math.max(0, value - 1));
            }
            return;
          }
          if (isFilm) {
            // В фильме верхняя галерея — карточки подборки, без закольцовки/разгона
            const last = filmTopItems.length - 1;
            setRailIndex((value) => Math.max(0, Math.min(last, value + step)));
            return;
          }
          const total = seasonEpisodes.length + subOffset;
          // Платный тайтл (есть карточка подписки) листаем без закольцовки
          const loop = !showSubCard && seasonEpisodes.length > 15;
          const accel = seasonEpisodes.length >= 30; // разгон при удержании у очень длинных
          // Геометрический разгон только при удержании (event.repeat) и в одну сторону
          const rr = railRepeatRef.current;
          if (!event.repeat || rr.dir !== step) {
            rr.dir = step;
            rr.count = 0;
          } else {
            rr.count += 1;
          }
          const magnitude = accel ? accelerationStep(rr.count) : 1;
          setRailIndex((value) => {
            let next = value + step * magnitude;
            // На разгоне у краёв просто упираемся; закольцовка — только на одиночном шаге
            if (loop && magnitude === 1) {
              if (next < 0) return total - 1;
              if (next > total - 1) return 0;
            }
            return Math.max(0, Math.min(total - 1, next));
          });
          return;
        }
        if (focus === "recom") {
          const last = (isFilm ? filmBottomItems.length : series.recommendations.length) - 1;
          setRecomIndex((value) => Math.max(0, Math.min(last, value + step)));
          return;
        }
        if (focus === "seasons") {
          if (gridLeft) {
            // Вертикаль 2: табы слева — вправо уходим в сетку серий, влево некуда
            if (step > 0) setFocus("episodes");
            return;
          }
          // Горизонталь и Вертикаль 1: горизонтальный ряд табов — влево/вправо меняют сезон
          const index = series.seasons.findIndex((s) => s.number === activeSeason);
          const next = series.seasons[index + step];
          if (next) selectSeason(next.number);
          return;
        }
        moveWithinRow(step);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (event.key === "ArrowDown") {
          if (isFilm && filmVertical && focus === "recom") {
            // Фильм «Вертикаль»: вторая галерея — сетка, вниз на ряд ниже (+колонки)
            const total = filmBottomItems.length;
            setRecomIndex((value) => {
              const below = value + GRID_COLUMNS;
              return below < total ? below : value;
            });
            return;
          }
          if (gridTop && focus === "episodes") {
            // Вертикаль 1: вниз — ближайшая карточка ряда ниже (через разделители
            // сезонов ведёт в следующий сезон); таб сверху подхватывает новый сезон
            const nextRail = gridNeighbor(1);
            if (nextRail !== null) {
              setRailIndex(nextRail);
              const s = seasonAtRail(nextRail);
              if (s !== activeSeason) setActiveSeason(s);
            }
            return;
          }
          if (gridLeft && focus === "episodes") {
            // Вертикаль 2: вниз — на ряд ниже (+колонки), с обработкой неполного ряда
            const total = railCount;
            setRailIndex((value) => {
              const below = value + GRID_COLUMNS;
              const lastRowStart = Math.floor((total - 1) / GRID_COLUMNS) * GRID_COLUMNS;
              const lastRowPartial = total - lastRowStart < GRID_COLUMNS;
              if (lastRowPartial && value < lastRowStart && below >= lastRowStart) {
                return lastRowStart;
              }
              return below < total ? below : value;
            });
            return;
          }
          if (gridTop && focus === "seasons") {
            // Вертикаль 1: табы сверху — вниз в сетку серий
            setFocus("episodes");
            return;
          }
          if (gridLeft && focus === "seasons") {
            // Вертикаль 2: табы слева колонкой — вниз к следующему сезону
            const index = series.seasons.findIndex((s) => s.number === activeSeason);
            const next = series.seasons[index + 1];
            if (next) selectSeason(next.number);
            return;
          }
          if (focus === "back") {
            setFocus("pause");
          } else if (focusRow === CONTROLS_ROW) {
            setFocus("seek");
          } else if (focus === "seek") {
            // В фильме серий и сезонов нет — сразу в верхнюю галерею
            if (isFilm) setFocus("episodes");
            else focusEpisodesIn(episode?.season ?? activeSeason);
          } else if (focus === "seasons") {
            focusEpisodesIn(activeSeason);
          } else if (focus === "episodes") {
            // recom: вниз — во вторую галерею (шторка поднимается выше);
            // обычный вариант: на кнопки подписки/уведомления
            if (isRecom) setFocus("recom");
            else setFocus(showSubscriptionOffer ? "subscription" : "notify");
          }
          return;
        }

        if (isFilm && filmVertical && focus === "recom") {
          // Фильм «Вертикаль»: вверх на ряд выше; из верхнего ряда — в первую галерею
          if (recomIndex >= GRID_COLUMNS) setRecomIndex((value) => value - GRID_COLUMNS);
          else setFocus("episodes");
          return;
        }
        if (gridTop && focus === "episodes") {
          // Вертикаль 1: вверх — ближайшая карточка ряда выше; из самого верха — на табы
          const prevRail = gridNeighbor(-1);
          if (prevRail !== null) {
            setRailIndex(prevRail);
            const s = seasonAtRail(prevRail);
            if (s !== activeSeason) setActiveSeason(s);
          } else {
            setFocus("seasons");
          }
          return;
        }
        if (gridLeft && focus === "episodes") {
          // Вертикаль 2: вверх — на ряд выше; из верхнего ряда — на таймлайн
          if (railIndex >= GRID_COLUMNS) setRailIndex((value) => value - GRID_COLUMNS);
          else setFocus("seek");
          return;
        }
        if (gridTop && focus === "seasons") {
          // Вертикаль 1: табы сверху — вверх обратно на таймлайн плеера
          setFocus("seek");
          return;
        }
        if (gridLeft && focus === "seasons") {
          // Вертикаль 2: табы слева колонкой — вверх к предыдущему сезону, с первого — в плеер
          const index = series.seasons.findIndex((s) => s.number === activeSeason);
          const prev = series.seasons[index - 1];
          if (prev) selectSeason(prev.number);
          else setFocus("seek");
          return;
        }
        if (focus === "notify" || focus === "subscription" || focus === "recom") {
          setFocus("episodes");
        } else if (focus === "episodes") {
          // Нет табов сезонов (только фильм) — уходим сразу на таймлайн
          setFocus(isFilm ? "seek" : "seasons");
        } else if (focus === "seasons") {
          setFocus("seek");
        } else if (focus === "seek") {
          setFocus("pause");
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activate,
    activeSeason,
    applyPanelOption,
    browsing,
    controlsVisible,
    duration,
    episode?.id,
    episode?.season,
    episodesBySeason,
    filmBottomItems.length,
    filmTopItems.length,
    filmVertical,
    focus,
    focusRow,
    gridFlat,
    gridLeft,
    gridTop,
    isFilm,
    isRecom,
    railCount,
    railIndex,
    seasonFlatStart,
    singleSeason,
    onExit,
    panel,
    panelIndex,
    panelOptions,
    playhead,
    recomIndex,
    seasonEpisodes.length,
    selectSeason,
    series.recommendations.length,
    series.seasons,
    showSubCard,
    subOffset,
    showSubscriptionOffer,
    wakeControls,
  ]);

  if (!episode) return null;

  const showLoader = Boolean(src) && (videoStage === "loading" || buffering);

  return (
    <>
      {/* Управление только с пульта: мышь внутри плеера отключена в стилях */}
      <div
        className={`player-wrap${browsing ? " browsing" : ""}${controlsVisible ? "" : " idle"}`}
        data-variant={isRecom ? "recom" : "plain"}
        data-content={content}
        data-paid={paidBadge ? "true" : undefined}
      >
        {/* Есть локальный файл — видео монтируется сразу и без poster: любой статичный
            кадр перед стартом выглядит как заглушка, а ожидание и так показывает спиннер.
            Источника нет — <video> не монтируем вовсе, кадр держит скрин серии */}
        {src ? (
          <video
            ref={attachVideo}
            className="player-video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disableRemotePlayback
            onLoadStart={markVideoBuffering}
            onWaiting={markVideoBuffering}
            onStalled={markVideoBuffering}
            onPlaying={handleVideoPlaying}
            onTimeUpdate={trackPlayback}
            onError={stopWaiting}
          />
        ) : still && !stillBroken ? (
          <img
            className="player-still"
            src={still}
            alt=""
            aria-hidden="true"
            onError={() => setStillBroken(true)}
          />
        ) : null}
        {/* Только индикация ожидания: пульт этот слой не видит и навести на него нечего */}
        {showLoader ? (
          <div className="player-loader" role="presentation" aria-hidden="true">
            <i className="player-spinner" />
          </div>
        ) : null}
        <div className="grad-top" />
        <div className="grad-bottom" />
        {/* Затемнение из макета: linear 180deg, чёрный 0.55 сверху к 1 снизу */}
        <div className="scrim" />

        <div className="controls-layer">
          <div className={`back-btn${focus === "back" ? " focused" : ""}`}>
            <img src="/icons/back.svg" alt="Назад" />
          </div>
          <div className="top-meta">
            {series.titleArt ? (
              <div className="title-art">
                <img src={series.titleArt.logo} alt={series.title} />
                {series.titleArt.caption ? <p>{series.titleArt.caption}</p> : null}
              </div>
            ) : (
              <h2>{series.title}</h2>
            )}
            {/* У фильма нет серий и сезонов — подпись показываем только у сериала */}
            {isFilm ? null : (
              <span>
                Серия {episode.episode} сезон {episode.season}
              </span>
            )}
          </div>
          <div className="transport">
            <div className={`icon-btn${focus === "prev" ? " focused" : ""}`}>
              <img src="/icons/previous.svg" alt="Предыдущая серия" />
            </div>
            <div className={`pause-btn${focus === "pause" ? " focused" : ""}`}>
              <img
                src={playing ? "/icons/pause.svg" : "/icons/play.svg"}
                alt={playing ? "Пауза" : "Пуск"}
              />
            </div>
            {/* У фильма нет следующей серии — кнопку «далее» не показываем */}
            {hasNext && !isFilm ? (
              <div className={`icon-btn${focus === "next" ? " focused" : ""}`}>
                <img src="/icons/next.svg" alt="Следующая серия" />
              </div>
            ) : null}
          </div>
          <div className={`side-controls quality${focus === "quality" ? " focused" : ""}`}>
            <div className="control-btn">
              <img src="/icons/quality.svg" alt="" />
              <span>Качество</span>
            </div>
            <i className="badge green" />
          </div>
          <div className={`side-controls audio${focus === "audio" ? " focused" : ""}`}>
            <div className="control-btn">
              <img src="/icons/volume.svg" alt="" />
              <span>Аудио и Субтитры</span>
            </div>
            <i className="badge blue" />
          </div>
          <Seekbar
            playhead={playhead}
            duration={episode.durationSec}
            markers={episode.markers}
            focused={focus === "seek"}
          />
        </div>

        <div
          className={`series-layer${browsing ? " open" : ""}${
            isRecom && focus === "recom" ? " raised" : ""
          }${gridLayout ? " grid-layout" : ""}${gridTop ? " grid-top" : ""}${
            gridLeft ? " grid-left" : ""
          }${gridTop && gridScrolled ? " grid-scrolled" : ""}${
            isFilm && filmVertical ? " film-vertical" : ""
          }`}
        >
          {isFilm ? (
            /* Верхняя галерея фильма вместо ряда серий */
            <div className="recom-shelf">
              <h3 className="recom-heading">{filmTopTitle}</h3>
              <RecommendationRail
                items={filmTopItems}
                focusedIndex={focus === "episodes" ? railIndex : null}
                anchorIndex={railIndex}
                cardWidth={RECOM_CARD_W}
              />
            </div>
          ) : (
            <>
              <SeasonTabs
                seasons={series.seasons}
                activeSeason={activeSeason}
                focusedSeason={focus === "seasons" ? activeSeason : null}
                vertical={gridLeft}
              />
              <EpisodeRail
                episodes={seasonEpisodes}
                currentId={episode.id}
                playhead={playhead}
                duration={episode.durationSec}
                focusedIndex={focus === "episodes" ? railIndex : null}
                anchorIndex={railIndex}
                cardWidth={EPISODE_CARD_W}
                paid={paidBadge}
                loop={seasonEpisodes.length > 15}
                reminders={episodeReminders}
                recom={variant !== "plain"}
                watched={variant === "plain" ? undefined : watchedEpisodes}
                started={variant === "plain" ? undefined : startedEpisodes}
                grid={gridLayout}
                gridSeasons={gridTop ? gridSeasons : undefined}
                columns={GRID_COLUMNS}
                bottomAnchor={singleSeason}
                scrollActive={browsing}
                subCard={showSubCard}
                subName={SUB_NAME}
                subPrice={SUB_PRICE}
                watching={demoWatching}
                onScrolled={setGridScrolled}
              />
            </>
          )}
          {isRecom ? (
            <div className="recom-shelf">
              <h3 className="recom-heading">
                {isFilm ? filmBottomTitle : `Смотрят вместе с «${series.title}»`}
              </h3>
              <RecommendationRail
                items={isFilm ? filmBottomItems : series.recommendations}
                focusedIndex={focus === "recom" ? recomIndex : null}
                anchorIndex={recomIndex}
                cardWidth={RECOM_CARD_W}
                grid={isFilm && filmVertical}
                columns={GRID_COLUMNS}
                scrollActive={browsing && focus === "recom"}
              />
            </div>
          ) : gridLayout ? null : (
            <div className="series-actions">
              {showSubscriptionOffer ? (
                <SubscriptionButton focused={focus === "subscription"} />
              ) : null}
              <NotifyButton active={notify} focused={focus === "notify"} />
            </div>
          )}
        </div>

        {panel === "quality" ? (
          <div className="panel">
            <h3>Качество</h3>
            {qualityOptions.map((item, index) => (
              <div
                key={item}
                className={`panel-item${item === quality ? " active" : ""}${
                  panelIndex === index ? " focused" : ""
                }`}
              >
                {item}
              </div>
            ))}
            {series.capabilities.has51 ? <p className="panel-note">Доступен звук 5.1</p> : null}
          </div>
        ) : null}
        {panel === "audio" ? (
          <div className="panel">
            <h3>Аудио</h3>
            {series.capabilities.audioTracks.map((item, index) => (
              <div
                key={item}
                className={`panel-item${item === audio ? " active" : ""}${
                  panelIndex === index ? " focused" : ""
                }`}
              >
                {item}
              </div>
            ))}
            <h3 className="panel-section">Субтитры</h3>
            {subtitleOptions.map((item, index) => (
              <div
                key={item}
                className={`panel-item${item === subtitle ? " active" : ""}${
                  panelIndex === series.capabilities.audioTracks.length + index ? " focused" : ""
                }`}
              >
                {item}
              </div>
            ))}
          </div>
        ) : null}
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    </>
  );
}

// Панель выбора сериала над плеером живёт в App и перерисовывается на наведение
// и на каждый символ в поле ссылки: плеер за собой тянуть не должен
export const PlayerScreen = memo(PlayerScreenView);

/*
  Геометрический разгон листинга при удержании стрелки: несколько первых
  повторов идут по одной серии, дальше шаг удваивается — 1,1,1,2,2,2,4,4,4,8…
  (до 16), чтобы по сезону из десятков серий можно было пролистать быстро.
*/
function accelerationStep(repeatCount: number): number {
  return Math.min(16, 2 ** Math.floor(repeatCount / 3));
}

function formatReleaseDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(date);
}

