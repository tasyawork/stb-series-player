import { parseIviQuery } from "./parseIvi";
import type { IviEpisode, IviSeries } from "./types";

const API_HOSTS = import.meta.env.DEV
  ? ["https://api.ivi.ru/mobileapi", "https://api2.ivi.ru/mobileapi"]
  : ["/api/ivi", "https://api.ivi.ru/mobileapi", "https://api2.ivi.ru/mobileapi"];
const COMMON_PARAMS = {
  app_version: "870",
  country_place_id: "41207",
};
const PUBLIC_BASE = import.meta.env.BASE_URL;
// Локальные файлы для демонстрации: настоящий контент Иви закрыт DRM
const DEMO_VIDEOS: Record<string, string> = {
  holod: `${PUBLIC_BASE}video/holod.mp4`,
  dar: `${PUBLIC_BASE}video/dar.mp4`,
  "selskij-detektiv-1-yablonya-razdora": `${PUBLIC_BASE}video/selskij-detektiv.mp4`,
};
// Логотип и промо-строка приходят из макета: в mobileapi таких полей нет
const DEMO_TITLE_ART: Record<string, { logo: string; caption?: string }> = {
  holod: {
    logo: `${PUBLIC_BASE}images/title-holod.svg`,
    caption: "Уже смотрят 146 000 000",
  },
};
const CARD_FIELDS = [
  "id", "hru", "title", "years", "restrict", "duration", "short_description",
  "synopsis", "description", "posters", "promo_images", "share_link",
  "episode_count", "has_upcoming_episodes", "shields", "content_paid_types",
  "subscription_names", "localizations", "subtitles", "hd_available",
  "fullhd_available", "uhd_available_all", "has_5_1", "fake", "seasons",
].join(",");
const EPISODE_PAGE_SIZE = 100;
const MAX_EPISODE_PAGES = 20;
const EPISODE_FIELDS = [
  "id", "thumbs", "posters", "episode", "season", "title", "fake",
  "ivi_release_info", "localizations", "promo_images",
].join(",");

type Image = {
  url?: string;
  type?: string;
  content_format?: string;
  width?: number;
  height?: number;
};
type Quality = { quality?: string };
type Marker = { start?: number; finish?: number; type?: string };
type Localization = {
  duration?: number;
  credits_begin_time?: number;
  localization_type?: { title?: string; short_title?: string };
  qualities?: Quality[];
  markers?: Marker[];
};
type Subtitle = {
  subtitle_type?: { title?: string; short_title?: string };
};
type Card = {
  id: number;
  hru?: string;
  title: string;
  years?: number[];
  restrict?: number;
  duration?: number;
  short_description?: string;
  synopsis?: string;
  description?: string;
  posters?: Image[];
  promo_images?: Image[];
  share_link?: string;
  episode_count?: number;
  has_upcoming_episodes?: boolean;
  localizations?: Localization[];
  subtitles?: Subtitle[];
  hd_available?: boolean;
  fullhd_available?: boolean;
  uhd_available_all?: boolean;
  has_5_1?: boolean;
  content_paid_types?: string[];
  fake?: boolean;
  seasons?: { content_paid_types?: string[] }[];
};
type RawEpisode = {
  id: number;
  title?: string;
  episode?: number;
  season?: number;
  fake?: boolean | null;
  thumbs?: Image[];
  posters?: Image[];
  promo_images?: Image[];
  ivi_release_info?: { date_interval_min?: string | null };
  localizations?: Localization[];
};
type ApiEnvelope<T> = {
  result?: T;
  error?: { message?: string; code?: number };
};

/*
  Мета сериала за сеанс не меняется, а походов в mobileapi на каждый выбор нужно
  два и больше. Поэтому разобранный ответ держим в памяти: повторный выбор
  пресета отдаётся мгновенно, а сеть трогаем только если запись состарилась.
*/
const CACHE_TTL_MS = 5 * 60 * 1000;
const seriesCache = new Map<string, { series: IviSeries; at: number }>();
// Клик и фоновый прогрев могут просить одно и то же: второй запрос ждёт первый
const inflight = new Map<string, Promise<IviSeries>>();

function cacheKey(query: string, requestedSeason?: number, usePresetVideo = false): string | null {
  try {
    return `${parseIviQuery(query).slug}|${requestedSeason ?? ""}|${usePresetVideo ? 1 : 0}`;
  } catch {
    return null;
  }
}

// Синхронный взгляд в кэш: нужен, чтобы отрисовать сериал в том же кадре, что клик
export function peekIviSeries(
  query: string,
  requestedSeason?: number,
  usePresetVideo = false,
): { series: IviSeries; stale: boolean } | null {
  const key = cacheKey(query, requestedSeason, usePresetVideo);
  const entry = key ? seriesCache.get(key) : undefined;
  if (!entry) return null;
  return { series: entry.series, stale: Date.now() - entry.at > CACHE_TTL_MS };
}

export function fetchIviSeries(
  query: string,
  requestedSeason?: number,
  usePresetVideo = false,
): Promise<IviSeries> {
  const key = cacheKey(query, requestedSeason, usePresetVideo);
  if (!key) return loadIviSeries(query, requestedSeason, usePresetVideo);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = loadIviSeries(query, requestedSeason, usePresetVideo)
    .then((series) => {
      seriesCache.set(key, { series, at: Date.now() });
      return series;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

// Прогрев остальных пресетов: ошибку глотаем, это не запрос пользователя
export async function prefetchIviSeries(
  query: string,
  requestedSeason?: number,
  usePresetVideo = false,
): Promise<void> {
  if (peekIviSeries(query, requestedSeason, usePresetVideo)?.stale === false) return;
  try {
    await fetchIviSeries(query, requestedSeason, usePresetVideo);
  } catch {
    // молча: пресет догрузится по клику
  }
}

async function loadIviSeries(
  query: string,
  requestedSeason: number | undefined,
  usePresetVideo: boolean,
): Promise<IviSeries> {
  const parsed = parseIviQuery(query);
  const card = await apiGet<Card>("compilationinfo/v7/", {
    hru: parsed.slug,
    fields: CARD_FIELDS,
  });
  const rawEpisodes = await fetchAllEpisodes(card.id, card.episode_count);
  if (rawEpisodes.length === 0) {
    throw new Error(`У сериала «${card.title}» не найдены серии`);
  }

  const horizontal =
    imageByType(card.posters, "poster-horizontal") ||
    imageByFormat(card.promo_images, "BackgroundImage") ||
    imageByFormat(card.promo_images, "MobilePromo") ||
    firstImage(card.posters);
  const vertical = imageByType(card.posters, "poster-vertical") || horizontal;
  // Заглушка для невышедших серий: у самих серий promo_images пустой
  const upcomingPlaceholder =
    imageByFormat(card.promo_images, "BackgroundImage-1280x720") ||
    imageByFormat(card.promo_images, "BackgroundImage") ||
    horizontal;
  const fallbackDuration = Math.max(
    60,
    Math.round((card.duration ?? 22 * 60 * rawEpisodes.length) / rawEpisodes.length),
  );

  const slug = card.hru || parsed.slug;
  const episodes = rawEpisodes
    .map((raw, index) =>
      mapEpisode(
        raw,
        index,
        slug,
        horizontal,
        upcomingPlaceholder,
        fallbackDuration,
        usePresetVideo ? DEMO_VIDEOS[slug] : undefined,
      ),
    )
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  const subscriptionRequired =
    hasSvod(card.content_paid_types) ||
    (card.seasons ?? []).some((season) => hasSvod(season.content_paid_types));
  const seasons = [...new Set(episodes.map((episode) => episode.season))]
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      title: `Сезон ${number}`,
      episodeCount: episodes.filter((episode) => episode.season === number).length,
    }));

  return {
    id: card.id,
    slug,
    titleArt: DEMO_TITLE_ART[slug],
    title: card.title,
    year: card.years?.[0],
    age: card.restrict,
    description: card.short_description || card.synopsis || card.description || "",
    poster: vertical,
    backdrop: horizontal,
    iviUrl: card.share_link || parsed.url,
    seasons,
    loadedSeason: seasons.some((item) => item.number === requestedSeason)
      ? requestedSeason!
      : seasons[0]?.number ?? 1,
    episodes,
    capabilities: buildCapabilities(card, rawEpisodes),
    hasUpcomingEpisodes:
      Boolean(card.has_upcoming_episodes) ||
      episodes.some((episode) => episode.availability === "upcoming"),
    subscriptionRequired,
    // Публичный прототип показывает состояние минимального тарифа «Иви с рекламой».
    subscriptionActive: true,
  };
}

function hasSvod(types?: string[]): boolean {
  return types?.includes("SVOD") ?? false;
}

async function fetchAllEpisodes(id: number, expectedCount?: number): Promise<RawEpisode[]> {
  // Сколько страниц нужно, видно заранее из episode_count, поэтому известную
  // часть берём одним пакетом вместо круговой задержки на каждую сотню серий
  const plannedPages = Math.min(
    MAX_EPISODE_PAGES,
    Math.max(1, Math.ceil((expectedCount ?? 0) / EPISODE_PAGE_SIZE)),
  );
  const pages = await Promise.all(
    Array.from({ length: plannedPages }, (_, index) => fetchEpisodePage(id, index)),
  );
  const all = pages.flat();
  // episode_count не считает невышедшие серии: полная последняя страница
  // значит, что остаток нужно добрать
  let lastLength = pages[pages.length - 1]?.length ?? 0;
  for (
    let index = plannedPages;
    lastLength === EPISODE_PAGE_SIZE && index < MAX_EPISODE_PAGES;
    index += 1
  ) {
    const page = await fetchEpisodePage(id, index);
    all.push(...page);
    lastLength = page.length;
  }
  return all;
}

function fetchEpisodePage(id: number, index: number): Promise<RawEpisode[]> {
  const from = index * EPISODE_PAGE_SIZE;
  return apiGet<RawEpisode[]>("videofromcompilation/v7/", {
    id: String(id),
    fake: "1",
    from: String(from),
    to: String(from + EPISODE_PAGE_SIZE - 1),
    fields: EPISODE_FIELDS,
  });
}

async function apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  let lastError: Error | undefined;
  for (const host of API_HOSTS) {
    try {
      const url = host.startsWith("http")
        ? new URL(`${host}/${path}`)
        : new URL(host, window.location.origin);
      if (!host.startsWith("http")) url.searchParams.set("p", path);
      Object.entries({ ...COMMON_PARAMS, ...params }).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as ApiEnvelope<T>;
      if (body.error) {
        throw new Error(body.error.message || `Ошибка API ${body.error.code ?? ""}`);
      }
      if (body.result === undefined) throw new Error("API вернул пустой ответ");
      return body.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Ошибка API Иви");
    }
  }
  throw new Error(`Не удалось получить данные Иви: ${lastError?.message ?? "неизвестная ошибка"}`);
}

function mapEpisode(
  raw: RawEpisode,
  index: number,
  slug: string,
  fallbackImage: string,
  upcomingPlaceholder: string,
  fallbackDuration: number,
  demoVideoUrl?: string,
): IviEpisode {
  const localization = raw.localizations?.find((item) => item.duration) ?? raw.localizations?.[0];
  const durationSec = localization?.duration || fallbackDuration;
  const releaseDate = raw.ivi_release_info?.date_interval_min || undefined;
  /*
    Флаг fake у Иви значит «не проиграется в анонимной сессии», а не «нет данных»:
    у подписочных серий он стоит вместе с реальной длительностью и превью.
    Поэтому доступность определяем по наличию данных, а невышедшей считаем серию,
    у которой их нет и дата выхода ещё впереди.
  */
  const released = Boolean(localization?.duration);
  const upcoming = !released && Boolean(releaseDate) && Date.parse(`${releaseDate}T00:00:00`) > Date.now();
  const availability = released ? "available" : upcoming ? "upcoming" : "unavailable";
  const thumb =
    availability === "available"
      ? imageByFormat(raw.thumbs, "Thumb-") ||
        imageByType(raw.posters, "poster-horizontal") ||
        fallbackImage
      : imageByFormat(raw.promo_images, "BackgroundImage-1280x720") ||
        imageByFormat(raw.promo_images, "BackgroundImage") ||
        upcomingPlaceholder;
  const markers = (localization?.markers ?? [])
    .map((marker) => (marker.start ?? 0) / durationSec)
    .filter((point) => point > 0 && point < 1)
    .slice(0, 4);

  return {
    id: raw.id,
    title: raw.title || `Серия ${raw.episode ?? index + 1}`,
    season: raw.season ?? 1,
    episode: raw.episode ?? index + 1,
    durationSec,
    poster: imageByType(raw.posters, "poster-horizontal") || thumb,
    thumb,
    iviUrl: `https://www.ivi.ru/watch/${slug}`,
    videoUrl: availability === "available" ? demoVideoUrl : undefined,
    markers: markers.length ? markers : [0.28, 0.52, 0.74],
    availability,
    releaseDate,
    isLocked: false,
  };
}

function buildCapabilities(card: Card, episodes: RawEpisode[]): IviSeries["capabilities"] {
  const audioTracks = unique(
    (card.localizations ?? [])
      .map((item) => item.localization_type?.short_title || item.localization_type?.title)
      .filter(isString),
  );
  const subtitles = unique(
    (card.subtitles ?? [])
      .map((item) => item.subtitle_type?.title || item.subtitle_type?.short_title)
      .filter(isString),
  );
  const qualityCodes = unique(
    episodes.flatMap((episode) =>
      (episode.localizations ?? []).flatMap((localization) =>
        (localization.qualities ?? []).map((quality) => quality.quality).filter(isString),
      ),
    ),
  );
  const qualities = orderQualities([
    ...(card.uhd_available_all ? ["4K"] : []),
    ...(card.fullhd_available || qualityCodes.includes("HD1080") ? ["1080p"] : []),
    ...(card.hd_available || qualityCodes.includes("HD720") ? ["720p"] : []),
    ...(qualityCodes.some((quality) => ["SHQ", "HQ"].includes(quality)) ? ["480p"] : []),
  ]);

  return {
    qualities: qualities.length ? qualities : ["Авто"],
    audioTracks: audioTracks.length ? audioTracks : ["Русский"],
    subtitles,
    has51: Boolean(card.has_5_1),
  };
}

function firstImage(images?: Image[]): string {
  return images?.find((image) => image.url)?.url ?? "";
}

function imageByType(images: Image[] | undefined, type: string): string {
  return images?.find((image) => image.type === type)?.url ?? "";
}

function imageByFormat(images: Image[] | undefined, prefix: string): string {
  return images?.find((image) => image.content_format?.startsWith(prefix))?.url ?? "";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function orderQualities(values: string[]): string[] {
  const order = ["4K", "1080p", "720p", "480p"];
  return unique(values).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
