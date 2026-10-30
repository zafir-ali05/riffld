export type AudioProvider = "deezer" | "itunes";

export type GuessFeedback = "correct" | "artist" | "wrong" | "skipped";

export type RoundStatus = "playing" | "won" | "lost";

export type GuessDistribution = [number, number, number, number, number, number];

export interface GenreNode {
  id: string;
  name: string;
  emoji?: string;
  aliases?: string[];
  children?: GenreNode[];
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  genreId: string;
  provider: AudioProvider;
  providerTrackId: string;
  snippetOffsetMs?: number;
}

export interface LocalGenreStats {
  gamesPlayed: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: GuessDistribution;
  lastPlayedDate?: string;
}

export type AutocompleteTrack = Pick<Track, "id" | "title" | "artist">;

export interface AudioPreviewResponse {
  previewUrl: string;
  provider: AudioProvider;
  snippetOffsetMs: number;
}

export interface DailyPuzzleResponse {
  genreId: string;
  date: string;
  puzzleNumber: number;
  audioToken: string;
  tracks: AutocompleteTrack[];
}

export interface DailyGuessRequest {
  trackId: string;
  attempt: number;
}

export interface DailyGuessResponse {
  feedback: GuessFeedback;
  attempt: number;
  status: RoundStatus;
  answer?: Track;
}

export const SNIPPET_DURATIONS_MS = [1000, 2000, 4000, 7000, 11000, 16000] as const;

export const MAX_ATTEMPTS = 6;

export const MAX_PREVIEW_DURATION_MS = 30000;

export const MIN_DAILY_ELIGIBLE_TRACKS = 30;

export const FEEDBACK_SQUARES = {
  correct: "🟩",
  artist: "🟨",
  wrong: "🟥",
  skipped: "⬜",
  unused: "⬛",
} as const;
