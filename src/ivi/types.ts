export type IviPoster = {
  url: string;
  type?: string;
};

export type IviEpisode = {
  id: number;
  title: string;
  season: number;
  episode: number;
  durationSec: number;
  poster: string;
  thumb: string;
  iviUrl: string;
  videoUrl?: string;
  markers: number[];
  availability: "available" | "upcoming" | "unavailable";
  releaseDate?: string;
  isLocked: boolean;
};

export type IviSeason = {
  number: number;
  title: string;
  episodeCount: number;
  // Год съёмок сезона: показываем справа от таба, если сезонов 5+
  year?: number;
};

// Похожий по жанру тайтл для галереи «Смотрят вместе с …»
export type IviRecommendation = {
  id: number;
  title: string;
  // Короткое описание тайтла: в варианте с рекомом идёт в 1-й строке меты
  // карточки вместо названия
  description?: string;
  poster: string;
  year?: number;
  // Вторая строка меты карточки: основной жанр и длительность (у фильма) либо
  // число сезонов (у сериала). Показываются в порядке «жанр   длительность».
  genre?: string;
  runtime?: string;
  /*
    Блогерский ролик: у него другая мета — вместо жанра и длительности идут имя
    автора и когда вышло. Заполнены только у блогерского контента, и тогда
    карточка рисует их вместо genre/runtime.
  */
  author?: string;
  released?: string;
};

export type IviSeries = {
  id: number;
  slug: string;
  titleArt?: { logo: string; caption?: string };
  title: string;
  year?: number;
  age?: number;
  description: string;
  poster: string;
  backdrop: string;
  iviUrl: string;
  seasons: IviSeason[];
  loadedSeason: number;
  episodes: IviEpisode[];
  capabilities: {
    qualities: string[];
    audioTracks: string[];
    subtitles: string[];
    has51: boolean;
  };
  hasUpcomingEpisodes: boolean;
  subscriptionRequired: boolean;
  subscriptionActive: boolean;
  recommendations: IviRecommendation[];
  /*
    Готовые именованные галереи (для варианта «Фильм»): каждая со своим
    заголовком и набором карточек. Когда заданы, плеер рисует их вместо
    единого ряда рекомендаций.
  */
  galleries?: { title: string; items: IviRecommendation[] }[];
};
