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
};
