import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IviEpisode, IviSeries } from "../ivi/types";
import { EpisodeRail } from "./EpisodeRail";
import { NotifyButton } from "./NotifyButton";
import { SeasonTabs } from "./SeasonTabs";
import { Seekbar } from "./Seekbar";
import { SubscriptionButton } from "./SubscriptionButton";

const ROWS = [
  ["back"],
  ["prev", "pause", "next", "quality", "audio"],
  ["seek"],
  ["seasons"],
  ["episodes"],
  ["subscription", "notify"],
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
  | "subscription";

const CONTROLS_ROW = 1;
const BROWSE_ROW = 3;

type PanelOption = { kind: "quality" | "audio" | "subtitle"; value: string };

type PlayerScreenProps = {
  series: IviSeries;
  onExit: () => void;
};

export function PlayerScreen({ series, onExit }: PlayerScreenProps) {
  const [activeSeason, setActiveSeason] = useState(series.loadedSeason);
  const firstEpisode =
    series.episodes.find(
      (item) => item.season === series.loadedSeason && item.availability === "available",
    ) ?? series.episodes[0];
  const [episodeId, setEpisodeId] = useState(firstEpisode?.id ?? 0);
  const [playing, setPlaying] = useState(true);
  const [current, setCurrent] = useState(0);
  const [focus, setFocus] = useState<Focus>("pause");
  const [railIndex, setRailIndex] = useState(0);
  const [panel, setPanel] = useState<"quality" | "audio" | null>(null);
  const [panelIndex, setPanelIndex] = useState(0);
  const [quality, setQuality] = useState("Авто");
  const [audio, setAudio] = useState(series.capabilities.audioTracks[0] ?? "Русский");
  const [subtitle, setSubtitle] = useState("Без субтитров");
  const [notify, setNotify] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activity, setActivity] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const browseOriginRef = useRef<{ season: number; index: number } | null>(null);

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
  const focusRow = ROWS.findIndex((row) => (row as readonly string[]).includes(focus));
  const browsing = focusRow >= BROWSE_ROW;
  const showSubscriptionOffer = series.subscriptionRequired && !series.subscriptionActive;

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

  useEffect(() => {
    setCurrent(0);
    setPlaying(true);
    if (videoRef.current) videoRef.current.currentTime = 0;
  }, [episodeId]);

  // Демо-видео короче серии, поэтому крутится в цикле, но реагирует на паузу
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, episodeId]);

  useEffect(() => {
    if (!playing || !episode) return;
    const id = window.setInterval(() => {
      setCurrent((value) => {
        const next = value + 0.25;
        if (next >= episode.durationSec) {
          setPlaying(false);
          return episode.durationSec;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [playing, episode]);

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
      setRailIndex(0);
    },
    [],
  );

  const playableIndex = playableEpisodes.findIndex((item) => item.id === episode?.id);
  const hasPrev = playableIndex > 0;
  const hasNext = playableIndex >= 0 && playableIndex < playableEpisodes.length - 1;

  // На последней серии кнопка вперёд скрыта, держать на ней фокус нельзя
  useEffect(() => {
    if (focus === "next" && !hasNext) setFocus("pause");
  }, [focus, hasNext]);

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
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const activate = useCallback(
    (id: Focus) => {
      if (id === "back") onExit();
      if (id === "pause") setPlaying((value) => !value);
      // На первой серии кнопка остаётся по макету и отматывает текущую серию к началу
      if (id === "prev") {
        if (hasPrev) goRelative(-1);
        else {
          setCurrent(0);
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
        const chosen = seasonEpisodes[railIndex];
        if (chosen?.isLocked) {
          showToast("Оформите подписку, чтобы смотреть эту серию");
        } else if (chosen?.availability === "available") {
          setEpisodeId(chosen.id);
        } else if (chosen?.availability === "upcoming") {
          showToast(
            chosen.releaseDate
              ? `Серия выйдет ${formatReleaseDate(chosen.releaseDate)}`
              : "Серия ещё не вышла",
          );
        } else if (chosen) {
          showToast("Серия недоступна в текущем регионе");
        }
      }
    },
    [
      audio,
      goRelative,
      hasPrev,
      onExit,
      quality,
      qualityOptions,
      railIndex,
      seasonEpisodes,
      series.capabilities.audioTracks,
      series.iviUrl,
      showToast,
    ],
  );

  useEffect(() => {
    function isReachable(id: Focus) {
      if (id === "next") return hasNext;
      if (id === "subscription") return showSubscriptionOffer;
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
      const episodes = episodesBySeason[season] ?? [];
      const index = episodes.findIndex((item) => item.id === episode?.id);
      const targetIndex = index >= 0 ? index : 0;
      browseOriginRef.current = { season, index: targetIndex };
      setActiveSeason(season);
      setRailIndex(targetIndex);
      setFocus("episodes");
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
          setCurrent((value) =>
            Math.min(episode?.durationSec ?? 0, Math.max(0, value + step * 10)),
          );
          return;
        }
        if (focus === "episodes") {
          setRailIndex((value) => Math.max(0, Math.min(seasonEpisodes.length - 1, value + step)));
          return;
        }
        if (focus === "seasons") {
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
          if (focus === "back") {
            setFocus("pause");
          } else if (focusRow === CONTROLS_ROW) {
            setFocus("seek");
          } else if (focus === "seek") {
            focusEpisodesIn(episode?.season ?? activeSeason);
          } else if (focus === "seasons") {
            focusEpisodesIn(activeSeason);
          } else if (focus === "episodes") {
            setFocus(showSubscriptionOffer ? "subscription" : "notify");
          }
          return;
        }

        if (focus === "notify" || focus === "subscription") {
          setFocus("episodes");
        } else if (focus === "episodes") {
          setFocus("seasons");
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
    episode?.durationSec,
    episode?.id,
    episode?.season,
    episodesBySeason,
    focus,
    focusRow,
    onExit,
    panel,
    panelIndex,
    panelOptions,
    seasonEpisodes.length,
    selectSeason,
    series.seasons,
    showSubscriptionOffer,
    wakeControls,
  ]);

  if (!episode) return null;

  const progress = episode.durationSec ? current / episode.durationSec : 0;
  const src = episode.videoUrl;

  return (
    <>
      {/* Управление только с пульта: мышь внутри плеера отключена в стилях */}
      <div className={`player-wrap${browsing ? " browsing" : ""}${controlsVisible ? "" : " idle"}`}>
        {src ? (
          <video
            ref={videoRef}
            className="player-video"
            src={src}
            poster={episode.thumb || series.backdrop}
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <div
            className="player-poster"
            style={{ backgroundImage: `url(${episode.thumb || series.backdrop})` }}
          />
        )}
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
            <span>
              Серия {episode.episode} сезон {episode.season}
            </span>
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
            {hasNext ? (
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
            current={current}
            duration={episode.durationSec}
            markers={episode.markers}
            focused={focus === "seek"}
          />
        </div>

        <div className={`series-layer${browsing ? " open" : ""}`}>
          <SeasonTabs
            seasons={series.seasons}
            activeSeason={activeSeason}
            focusedSeason={focus === "seasons" ? activeSeason : null}
          />
          <EpisodeRail
            episodes={seasonEpisodes}
            currentId={episode.id}
            progress={progress}
            focusedIndex={focus === "episodes" ? railIndex : null}
            anchorIndex={railIndex}
          />
          <div className="series-actions">
            {showSubscriptionOffer ? (
              <SubscriptionButton focused={focus === "subscription"} />
            ) : null}
            <NotifyButton active={notify} focused={focus === "notify"} />
          </div>
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

function formatReleaseDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(date);
}
