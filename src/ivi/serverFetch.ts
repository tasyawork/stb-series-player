import { parseIviQuery } from "./parseIvi";
import { formatDuration } from "../player/time";
import type { IviEpisode, IviRecommendation, IviSeries } from "./types";

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
  "genres", "subscription_names", "localizations", "subtitles", "hd_available",
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
  // videoinfo (фильм) отдаёт один год, а не массив
  year?: number;
  restrict?: number;
  duration?: number;
  short_description?: string;
  synopsis?: string;
  description?: string;
  posters?: Image[];
  promo_images?: Image[];
  thumbs?: Image[];
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
  genres?: number[];
  fake?: boolean;
  seasons?: RawSeason[];
};
type RawSeason = {
  number?: number;
  content_paid_types?: string[];
  allow_download_paid_types?: string[];
  subscription_ids?: number[];
  season_release_date?: number | null;
  ivi_release_info?: { date_interval_min?: string | null };
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

/*
  Фильм для варианта «Фильм»: mobileapi отдаёт его через videoinfo/v7, а не
  compilationinfo. Плеер устроен вокруг серий, поэтому фильм заворачиваем в тот
  же IviSeries с единственным «эпизодом» — самим фильмом; ряд серий в фильме всё
  равно скрыт, а две галереи берут рекомендации (kind=1). Кэш свой, чтобы клик
  по вкладке «Фильм» не ждал сеть повторно.
*/
const FILM_FIELDS = [
  "id", "hru", "title", "year", "years", "restrict", "duration", "short_description",
  "synopsis", "description", "posters", "promo_images", "thumbs", "share_link",
  "genres", "localizations", "subtitles", "hd_available", "fullhd_available",
  "uhd_available_all", "has_5_1", "content_paid_types",
].join(",");
const filmCache = new Map<string, { series: IviSeries; at: number }>();
const filmInflight = new Map<string, Promise<IviSeries>>();

export function fetchIviFilm(query: string): Promise<IviSeries> {
  const slug = safeSlug(query);
  const key = slug ?? query;
  const pending = filmInflight.get(key);
  if (pending) return pending;
  const request = loadIviFilm(query)
    .then((series) => {
      filmCache.set(key, { series, at: Date.now() });
      return series;
    })
    .finally(() => filmInflight.delete(key));
  filmInflight.set(key, request);
  return request;
}

export function peekIviFilm(query: string): { series: IviSeries; stale: boolean } | null {
  const key = safeSlug(query) ?? query;
  const entry = filmCache.get(key);
  if (!entry) return null;
  return { series: entry.series, stale: Date.now() - entry.at > CACHE_TTL_MS };
}

function safeSlug(query: string): string | null {
  try {
    return parseIviQuery(query).slug;
  } catch {
    return null;
  }
}

async function loadIviFilm(query: string): Promise<IviSeries> {
  const parsed = parseIviQuery(query);
  const card = await apiGet<Card>("videoinfo/v7/", {
    id: parsed.slug,
    fields: FILM_FIELDS,
  });

  /*
    Две именованные галереи под конкретный фильм «Майкл». Самого́ фильма в них
    нет — контент, который сейчас идёт, в рекомендациях не показываем.
    1) «С фильмом „Майкл" смотрят» — рекомендации Иви под этот фильм (kind=1);
    2) «Биографии» — популярное в жанре биографий.
    Пересечения между полками убираем: тайтл из первой не повторяется во второй.
  */
  const [watchedWith, biographies] = await Promise.all([
    fetchRecommendations(card.id, RECOMMENDATION_KIND_FILM),
    genreRow(/биограф/i, card.id),
  ]);
  const usedIds = new Set(watchedWith.map((rec) => rec.id));
  const biographiesUnique = biographies.filter((rec) => !usedIds.has(rec.id));
  const galleries = [
    { title: "С фильмом «Майкл» смотрят", items: watchedWith },
    { title: "Биографии", items: biographiesUnique },
  ];
  const recommendations = watchedWith;

  const backdrop =
    imageByType(card.posters, "poster-horizontal") ||
    imageByFormat(card.promo_images, "BackgroundImage-1280x720") ||
    imageByFormat(card.promo_images, "BackgroundImage") ||
    firstImage(card.posters);
  const still = imageByFormat(card.thumbs, "Thumb-") || backdrop;
  const localization = card.localizations?.find((item) => item.duration) ?? card.localizations?.[0];
  const durationSec = localization?.duration || 90 * 60;

  // Единственный «эпизод» — сам фильм: держит плеер (сикбар, метаданные) на плаву
  const filmEpisode: IviEpisode = {
    id: card.id,
    title: card.title,
    season: 1,
    episode: 1,
    durationSec,
    poster: backdrop,
    thumb: still,
    iviUrl: card.share_link || parsed.url,
    videoUrl: undefined,
    markers: [0.28, 0.52, 0.74],
    availability: "available",
    isLocked: false,
  };

  return {
    id: card.id,
    slug: card.hru || parsed.slug,
    title: card.title,
    year: card.years?.[0] ?? card.year,
    age: card.restrict,
    description: card.short_description || card.synopsis || card.description || "",
    poster: backdrop,
    backdrop,
    iviUrl: card.share_link || parsed.url,
    seasons: [],
    loadedSeason: 1,
    episodes: [filmEpisode],
    capabilities: buildCapabilities(card, [{ id: card.id, localizations: card.localizations }]),
    hasUpcomingEpisodes: false,
    subscriptionRequired: hasSvod(card.content_paid_types),
    subscriptionActive: false,
    recommendations,
    galleries,
  };
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
  const [allRawEpisodes, recommendations] = await Promise.all([
    fetchAllEpisodes(card.id, card.episode_count),
    fetchRecommendations(card.id),
  ]);
  if (allRawEpisodes.length === 0) {
    throw new Error(`У сериала «${card.title}» не найдены серии`);
  }
  const rawEpisodes = withoutPlaceholderSeasons(allRawEpisodes, card.seasons ?? []);

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
  const demoVideoUrl = usePresetVideo ? DEMO_VIDEOS[slug] : undefined;
  /*
    Прототип показывает сериал глазами зрителя минимального тарифа «Иви с
    рекламой». Доступ к подписочному контенту здесь эмулирует локальный файл:
    у пресетов он есть, и они играют как у подписчика, а произвольная ссылка
    показывает то же, что и Иви без подписки, — открытую первую серию и замки.
  */
  const subscriptionActive = Boolean(demoVideoUrl);
  const paidSeasons = new Set(
    (card.seasons ?? [])
      .filter((season) => typeof season.number === "number" && seasonNeedsSubscription(season))
      .map((season) => season.number as number),
  );
  const announcedSeasons = new Set(
    (card.seasons ?? [])
      .filter((season) => typeof season.number === "number" && seasonAnnounced(season))
      .map((season) => season.number as number),
  );
  const subscriptionRequired = hasSvod(card.content_paid_types) || paidSeasons.size > 0;
  // Первая вышедшая серия у Иви открыта и без подписки, остальные платные — под замком
  const freeEpisodeId = [...rawEpisodes]
    .filter(isReleased)
    .sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 0) - (b.episode ?? 0))[0]
    ?.id;

  const episodes = rawEpisodes
    .map((raw, index) =>
      mapEpisode(raw, index, {
        slug,
        fallbackImage: horizontal,
        upcomingPlaceholder,
        fallbackDuration,
        demoVideoUrl,
        paidSeasons,
        announcedSeasons,
        subscriptionActive,
        freeEpisodeId,
      }),
    )
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
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
    subscriptionActive,
    recommendations,
  };
}

function hasSvod(types?: string[]): boolean {
  return types?.includes("SVOD") ?? false;
}

// Сколько похожих тянем в галерею «Смотрят вместе с …»
const RECOMMENDATION_LIMIT = 12;
// kind у hydra обязателен: 2 — сериал (compilation), 1 — фильм/видео
const RECOMMENDATION_KIND_SERIES = "2";
const RECOMMENDATION_KIND_FILM = "1";

type RecommendationItem = {
  id: number;
  title?: string;
  short_description?: string;
  synopsis?: string;
  object_type?: string;
  posters?: Image[];
  year?: number;
  years?: number[];
  genres?: number[];
  seasons?: { number?: number }[];
  localizations?: Localization[];
  ivi_release_date?: string;
  // Каталог у фильма отдаёт длительность прямо числом секунд, без localizations
  duration?: number;
};

/*
  Блогерский контент на Иви узнаётся по жанру «Блогерское». У такой карточки
  мета другая: имя автора и когда вышло, вместо жанра и длительности.
*/
function isBloggerGenre(name: string): boolean {
  return /блогер/i.test(name);
}

/*
  Выпуски Иви названы по правилу «Тема. АВТОР» — «Клеопатра. МИНАЕВ LIVE».
  Автор — хвост названия после последней точки, а сама тема — всё до него.
*/
function authorTag(title: string): string {
  const parts = title.split(/\.\s+/);
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

function titleWithoutAuthor(title: string): string {
  const parts = title.split(/\.\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(". ").trim() : title.trim();
}

// «сегодня» / «3 дня назад» / «1 месяц назад» — как в макете блогерской карточки
function relativeRelease(date?: string): string {
  const time = Date.parse(date ?? "");
  if (Number.isNaN(time)) return "";
  const days = Math.floor((Date.now() - time) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${plural(weeks, "неделю", "недели", "недель")} назад`;
  }
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `${months} ${plural(months, "месяц", "месяца", "месяцев")} назад`;
  }
  const years = Math.floor(days / 365);
  return `${years} ${plural(years, "год", "года", "лет")} назад`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const teens = count % 100 >= 11 && count % 100 <= 14;
  const last = count % 10;
  if (!teens && last === 1) return one;
  if (!teens && last >= 2 && last <= 4) return few;
  return many;
}

/*
  Названия жанров лежат отдельным справочником (categories/v5, жанры внутри
  категорий) и за сеанс не меняются — тянем один раз и кэшируем промисом.
  В карточке контента приходят только id жанров, названия берём отсюда.
*/
let genreDictionary: Promise<Map<number, string>> | null = null;

function loadGenres(): Promise<Map<number, string>> {
  if (genreDictionary) return genreDictionary;
  genreDictionary = apiGet<{ genres?: { id: number; title?: string }[] }[]>("categories/v5/", {})
    .then((categories) => {
      const map = new Map<number, string>();
      for (const category of categories) {
        for (const genre of category.genres ?? []) {
          if (genre.title) map.set(genre.id, genre.title);
        }
      }
      return map;
    })
    .catch((error) => {
      // Не удалось — следующая попытка начнётся заново, а мета просто без жанра
      genreDictionary = null;
      throw error;
    });
  return genreDictionary;
}

// «1 сезон» / «2 сезона» / «5 сезонов» — число сезонов в мете рекомендации-сериала
function seasonsLabel(count: number): string {
  const teens = count % 100 >= 11 && count % 100 <= 14;
  const last = count % 10;
  if (!teens && last === 1) return `${count} сезон`;
  if (!teens && last >= 2 && last <= 4) return `${count} сезона`;
  return `${count} сезонов`;
}

// Основной жанр с заглавной буквы, как на карточке Иви
function upperFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/*
  «Смотрят вместе с …»: ряд «С сериалом „…" смотрят» с реального эндпоинта
  рекомендаций ivi (hydra). Сессия не нужна — выдача просто не персонализирована.
  Сам тайтл иногда попадает в ответ, поэтому фильтруем по id. Ошибку глотаем —
  галерея просто останется пустой.
*/
async function fetchRecommendations(
  id: number,
  kind: string = RECOMMENDATION_KIND_SERIES,
): Promise<IviRecommendation[]> {
  try {
    const [items, genres] = await Promise.all([
      apiGet<RecommendationItem[]>("hydra/get/recommendation/v7/", {
        id: String(id),
        kind,
        scenario_id: "ITEM_PAGE",
        top: String(RECOMMENDATION_LIMIT + 2),
        fields:
          "id,title,short_description,synopsis,posters,year,years,object_type,genres,seasons,localizations,ivi_release_date",
      }),
      // Без справочника мета просто останется без жанра — карточку это не рушит
      loadGenres().catch(() => new Map<number, string>()),
    ]);
    return items
      .filter((item) => item.id !== id)
      .map((item) => mapRecommendation(item, genres))
      .filter((rec): rec is IviRecommendation => rec !== null)
      .slice(0, RECOMMENDATION_LIMIT);
  } catch {
    return [];
  }
}

// Общий маппер карточки рекомендации: годится и для hydra, и для поиска/каталога
function mapRecommendation(
  item: RecommendationItem,
  genres: Map<number, string>,
): IviRecommendation | null {
  const title = item.title ?? "";
  const poster = resizePoster(
    imageByFormat(item.posters, "Posters-3840x2160") || firstImage(item.posters),
  );
  if (!poster || !title) return null;
  const genre = recommendationGenre(item, genres);
  // У блогерского ролика — своя мета: автор и дата выхода вместо жанра/длительности,
  // а автора убираем из названия (в мете он идёт отдельной строкой)
  const description = item.short_description || item.synopsis || "";
  if (isBloggerGenre(genre)) {
    return {
      id: item.id,
      title: titleWithoutAuthor(title),
      description,
      poster,
      author: authorTag(title),
      released: relativeRelease(item.ivi_release_date),
    };
  }
  return {
    id: item.id,
    title,
    description,
    poster,
    year: item.year ?? item.years?.[0],
    genre,
    runtime: recommendationRuntime(item),
  };
}

/*
  Ряд по жанру (catalogue) — например, «Биографии». Каталог принимает id жанра
  из справочника categories/v5 и отдаёт контент этого жанра по популярности.
*/
async function genreRow(genreName: RegExp, excludeId?: number): Promise<IviRecommendation[]> {
  try {
    const genres = await loadGenres().catch(() => new Map<number, string>());
    let genreId: number | undefined;
    for (const [id, title] of genres) {
      if (genreName.test(title)) {
        genreId = id;
        break;
      }
    }
    if (!genreId) return [];
    const items = await apiGet<RecommendationItem[]>("catalogue/v7/", {
      genre: String(genreId),
      sort: "pop",
      from: "0",
      to: "23",
      fields:
        "id,title,short_description,synopsis,posters,year,years,object_type,genres,seasons,localizations,ivi_release_date,duration",
    });
    return dedupeRow(items, genres, excludeId);
  } catch {
    return [];
  }
}

// Собирает карточки, отбрасывает дубли по id и исходный тайтл, режет до лимита
function dedupeRow(
  items: RecommendationItem[],
  genres: Map<number, string>,
  excludeId?: number,
): IviRecommendation[] {
  const seen = new Set<number>();
  const row: IviRecommendation[] = [];
  for (const item of items) {
    if (item.id === excludeId || seen.has(item.id)) continue;
    const card = mapRecommendation(item, genres);
    if (!card) continue;
    seen.add(item.id);
    row.push(card);
    if (row.length >= RECOMMENDATION_LIMIT) break;
  }
  return row;
}

// Первый жанр на карточке Иви и есть основной — его и показываем в мете
function recommendationGenre(item: RecommendationItem, genres: Map<number, string>): string {
  for (const genreId of item.genres ?? []) {
    const title = genres.get(genreId);
    if (title) return upperFirst(title);
  }
  return "";
}

/*
  Длительность в мете: у фильма — время (localizations), у сериала — число
  сезонов. object_type у hydra: "video" — фильм/ролик, "compilation" — сериал.
*/
function recommendationRuntime(item: RecommendationItem): string {
  if (item.object_type === "compilation") {
    const count = item.seasons?.length ?? 0;
    return count ? seasonsLabel(count) : "";
  }
  const duration = item.localizations?.find((loc) => loc.duration)?.duration ?? item.duration;
  return duration ? formatDuration(duration) : "";
}

// Постеры приходят вплоть до 4K: просим у CDN версию под карточку 224×126
function resizePoster(url: string): string {
  return url ? `${url.replace(/\/+$/, "")}/456x256/` : url;
}

function isReleased(raw: RawEpisode): boolean {
  return (raw.localizations ?? []).some((item) => Boolean(item.duration));
}

/*
  content_paid_types бывает пустым и там, где Иви показывает «Смотреть по
  подписке»: у professor-t он пуст и на карточке, и на всех сезонах. Признаки,
  которые приходят всегда, — список тарифов сезона и права на скачивание.
*/
function seasonNeedsSubscription(season: RawSeason): boolean {
  return (
    hasSvod(season.content_paid_types) ||
    hasSvod(season.allow_download_paid_types) ||
    (season.subscription_ids?.length ?? 0) > 0
  );
}

// Сезон объявлен, если у него есть дата выхода или тарифы, по которым его продают
function seasonAnnounced(season: RawSeason): boolean {
  return (
    Boolean(season.season_release_date) ||
    Boolean(season.ivi_release_info?.date_interval_min) ||
    (season.subscription_ids?.length ?? 0) > 0
  );
}

/*
  Серии запрашиваются с fake=1, иначе не видно невышедших. Вместе с ними Иви
  отдаёт и сезоны-заготовки: у professor-t это четвёртый сезон без длительностей,
  без даты и без тарифов, которого на сайте нет вовсе. Такой сезон в ряду сезонов
  выглядел бы шестью карточками «Недоступно», поэтому его отбрасываем.
*/
function withoutPlaceholderSeasons(
  episodes: RawEpisode[],
  seasons: RawSeason[],
): RawEpisode[] {
  const released = new Set(episodes.filter(isReleased).map((raw) => raw.season ?? 1));
  const placeholders = new Set(
    seasons
      .filter(
        (season) =>
          typeof season.number === "number" &&
          !released.has(season.number) &&
          !seasonAnnounced(season),
      )
      .map((season) => season.number as number),
  );
  if (placeholders.size === 0) return episodes;
  const kept = episodes.filter((raw) => !placeholders.has(raw.season ?? 1));
  // Сериал целиком из заготовок — это анонс: показываем как есть, иначе экран пуст
  return kept.length > 0 ? kept : episodes;
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

type MapEpisodeContext = {
  slug: string;
  fallbackImage: string;
  upcomingPlaceholder: string;
  fallbackDuration: number;
  demoVideoUrl?: string;
  paidSeasons: Set<number>;
  announcedSeasons: Set<number>;
  subscriptionActive: boolean;
  freeEpisodeId?: number;
};

function mapEpisode(raw: RawEpisode, index: number, context: MapEpisodeContext): IviEpisode {
  const {
    slug,
    fallbackImage,
    upcomingPlaceholder,
    fallbackDuration,
    demoVideoUrl,
    paidSeasons,
    announcedSeasons,
    subscriptionActive,
    freeEpisodeId,
  } = context;
  const season = raw.season ?? 1;
  const localization = raw.localizations?.find((item) => item.duration) ?? raw.localizations?.[0];
  const durationSec = localization?.duration || fallbackDuration;
  const releaseDate = raw.ivi_release_info?.date_interval_min || undefined;
  /*
    Флаг fake у Иви значит «не проиграется в анонимной сессии», а не «нет данных»:
    у подписочных серий он стоит вместе с реальной длительностью и превью.
    Поэтому доступность определяем по наличию данных, а невышедшей считаем серию,
    у которой их нет, но сезон объявлен или дата выхода ещё впереди. «Недоступно»
    остаётся редким случаем, когда о серии не известно вообще ничего.
  */
  const released = Boolean(localization?.duration);
  const dated = Boolean(releaseDate) && Date.parse(`${releaseDate}T00:00:00`) > Date.now();
  const upcoming = !released && (dated || announcedSeasons.has(season));
  const availability = released ? "available" : upcoming ? "upcoming" : "unavailable";
  // Серия вышла, но лежит за подпиской: на карточке замок, а не текст
  const isLocked =
    availability === "available" &&
    paidSeasons.has(season) &&
    !subscriptionActive &&
    raw.id !== freeEpisodeId;
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
    season,
    episode: raw.episode ?? index + 1,
    durationSec,
    poster: imageByType(raw.posters, "poster-horizontal") || thumb,
    thumb,
    iviUrl: `https://www.ivi.ru/watch/${slug}`,
    videoUrl: availability === "available" && !isLocked ? demoVideoUrl : undefined,
    markers: markers.length ? markers : [0.28, 0.52, 0.74],
    availability,
    releaseDate,
    isLocked,
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
