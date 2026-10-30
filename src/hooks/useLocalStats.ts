"use client";

import { useEffect, useState } from "react";
import { getUtcDateString, parseUtcDateMidnightMs } from "@/lib/share";
import {
  MAX_ATTEMPTS,
  MAX_PREVIEW_DURATION_MS,
  SNIPPET_DURATIONS_MS,
  type AudioProvider,
  type DailyRoundProgress,
  type GuessDistribution,
  type GuessFeedback,
  type GuessRecord,
  type LocalGenreStats,
  type RoundStatus,
  type Track,
} from "@/types/catalog";

export const STORAGE_VERSION = 1;
export const STATS_STORAGE_KEY = "riffld:v1:stats";

const MS_PER_UTC_DAY = 86_400_000;
const MAX_SNIPPET_MS =
  SNIPPET_DURATIONS_MS[SNIPPET_DURATIONS_MS.length - 1] ?? 16000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface StatsStoreEnvelope {
  version: number;
  genres: Record<string, LocalGenreStats>;
}

export type StatsStoreMigrator = (
  raw: Record<string, unknown>,
  fromVersion: number,
) => Record<string, unknown>;

export interface RecordRoundResultInput {
  won: boolean;
  attempt: number;
  date?: Date | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isGuessFeedback(value: unknown): value is GuessFeedback {
  return (
    value === "correct" ||
    value === "artist" ||
    value === "wrong" ||
    value === "skipped"
  );
}

function isRoundStatus(value: unknown): value is RoundStatus {
  return value === "playing" || value === "won" || value === "lost";
}

function isAudioProvider(value: unknown): value is AudioProvider {
  return value === "deezer" || value === "itunes";
}

function isValidUtcDateString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    parseUtcDateMidnightMs(value);
    return true;
  } catch {
    return false;
  }
}

export function getStatsStorageKey(version: number = STORAGE_VERSION): string {
  return `riffld:v${version}:stats`;
}

export function getDailyProgressStorageKey(
  genreId: string,
  date: string,
  version: number = STORAGE_VERSION,
): string {
  return `riffld:v${version}:daily:${genreId}:${date}`;
}

export function createDefaultGenreStats(): LocalGenreStats {
  return {
    gamesPlayed: 0,
    wins: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: [0, 0, 0, 0, 0, 0],
  };
}

export function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function sanitizeGuessDistribution(raw: unknown): GuessDistribution {
  if (!Array.isArray(raw) || raw.length !== MAX_ATTEMPTS) {
    return [0, 0, 0, 0, 0, 0];
  }

  return [
    isNonNegativeInt(raw[0]) ? raw[0] : 0,
    isNonNegativeInt(raw[1]) ? raw[1] : 0,
    isNonNegativeInt(raw[2]) ? raw[2] : 0,
    isNonNegativeInt(raw[3]) ? raw[3] : 0,
    isNonNegativeInt(raw[4]) ? raw[4] : 0,
    isNonNegativeInt(raw[5]) ? raw[5] : 0,
  ];
}

export function sanitizeGenreStats(raw: unknown): LocalGenreStats {
  if (!isRecord(raw)) {
    return createDefaultGenreStats();
  }

  const rawPlayed = raw.gamesPlayed ?? raw.played;
  const rawWins = raw.wins ?? raw.gamesWon;
  const rawCurrentStreak = raw.currentStreak ?? raw.streak;
  const rawMaxStreak = raw.maxStreak ?? raw.bestStreak;
  const rawDist = raw.guessDistribution ?? raw.distribution;

  const wins = isNonNegativeInt(rawWins) ? rawWins : 0;
  const gamesPlayed = isNonNegativeInt(rawPlayed)
    ? Math.max(rawPlayed, wins)
    : wins;
  const currentStreak = isNonNegativeInt(rawCurrentStreak)
    ? rawCurrentStreak
    : 0;
  const maxStreak = isNonNegativeInt(rawMaxStreak)
    ? Math.max(rawMaxStreak, currentStreak)
    : currentStreak;
  const guessDistribution = sanitizeGuessDistribution(rawDist);

  const stats: LocalGenreStats = {
    gamesPlayed,
    wins,
    currentStreak,
    maxStreak,
    guessDistribution,
  };

  if (isValidUtcDateString(raw.lastPlayedDate)) {
    stats.lastPlayedDate = raw.lastPlayedDate;
  }

  return stats;
}

const DEFAULT_STATS_MIGRATORS: Readonly<Record<number, StatsStoreMigrator>> = {
  0: (raw) => {
    const rawGenres = isRecord(raw.genres)
      ? raw.genres
      : isRecord(raw.statsByGenre)
        ? raw.statsByGenre
        : raw;

    const genres: Record<string, LocalGenreStats> = {};
    for (const [key, value] of Object.entries(rawGenres)) {
      if (key === "version" || key.trim().length === 0 || !isRecord(value)) {
        continue;
      }
      genres[key] = sanitizeGenreStats(value);
    }

    return {
      version: 1,
      genres,
    };
  },
};

export function migrateStatsStore(
  raw: unknown,
  options?: {
    targetVersion?: number;
    migrators?: Readonly<Record<number, StatsStoreMigrator>>;
  },
): StatsStoreEnvelope {
  const targetVersion = options?.targetVersion ?? STORAGE_VERSION;
  const migrators = {
    ...DEFAULT_STATS_MIGRATORS,
    ...options?.migrators,
  };

  if (!isRecord(raw)) {
    return { version: targetVersion, genres: {} };
  }

  let currentVersion = isNonNegativeInt(raw.version) ? raw.version : 0;
  let working: Record<string, unknown> = { ...raw };

  if (currentVersion > targetVersion) {
    return { version: targetVersion, genres: {} };
  }

  while (currentVersion < targetVersion) {
    const migrator = migrators[currentVersion];
    if (migrator !== undefined) {
      working = migrator(working, currentVersion);
    }
    currentVersion += 1;
    working.version = currentVersion;
  }

  const rawGenres = isRecord(working.genres)
    ? working.genres
    : isRecord(working.statsByGenre)
      ? working.statsByGenre
      : working;

  const genres: Record<string, LocalGenreStats> = {};
  for (const [genreId, entry] of Object.entries(rawGenres)) {
    if (
      genreId === "version" ||
      genreId.trim().length === 0 ||
      !isRecord(entry)
    ) {
      continue;
    }
    genres[genreId] = sanitizeGenreStats(entry);
  }

  return {
    version: targetVersion,
    genres,
  };
}

export function loadAllGenreStats(
  storage: StorageLike | null = getBrowserLocalStorage(),
): Record<string, LocalGenreStats> {
  if (storage === null) {
    return {};
  }

  try {
    const primaryRaw = storage.getItem(STATS_STORAGE_KEY);
    if (primaryRaw !== null) {
      const parsed: unknown = JSON.parse(primaryRaw);
      return migrateStatsStore(parsed).genres;
    }

    const legacyKeys = [getStatsStorageKey(0), "riffld:stats"];
    for (const legacyKey of legacyKeys) {
      const legacyRaw = storage.getItem(legacyKey);
      if (legacyRaw === null) {
        continue;
      }

      const parsed: unknown = JSON.parse(legacyRaw);
      const migrated = migrateStatsStore(parsed);
      storage.setItem(STATS_STORAGE_KEY, JSON.stringify(migrated));
      storage.removeItem?.(legacyKey);
      return migrated.genres;
    }

    return {};
  } catch {
    return {};
  }
}

export function loadGenreStats(
  genreId: string,
  storage: StorageLike | null = getBrowserLocalStorage(),
): LocalGenreStats {
  const all = loadAllGenreStats(storage);
  return all[genreId] ?? createDefaultGenreStats();
}

export function saveGenreStats(
  genreId: string,
  stats: LocalGenreStats,
  storage: StorageLike | null = getBrowserLocalStorage(),
): void {
  if (storage === null || genreId.trim().length === 0) {
    return;
  }

  try {
    const existing = loadAllGenreStats(storage);
    const envelope: StatsStoreEnvelope = {
      version: STORAGE_VERSION,
      genres: {
        ...existing,
        [genreId]: sanitizeGenreStats(stats),
      },
    };
    storage.setItem(STATS_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Ignore storage quota or private mode write errors.
  }
}

export function computeUpdatedGenreStats(
  current: LocalGenreStats | undefined,
  input: RecordRoundResultInput,
): LocalGenreStats {
  const base =
    current !== undefined
      ? sanitizeGenreStats(current)
      : createDefaultGenreStats();

  const dateString =
    input.date === undefined
      ? getUtcDateString()
      : input.date instanceof Date
        ? getUtcDateString(input.date)
        : input.date;

  const playedMidnightMs = parseUtcDateMidnightMs(dateString);

  if (base.lastPlayedDate !== undefined) {
    const lastMidnightMs = parseUtcDateMidnightMs(base.lastPlayedDate);
    if (playedMidnightMs <= lastMidnightMs) {
      return base;
    }
  }

  const daysSinceLastPlayed =
    base.lastPlayedDate !== undefined
      ? Math.round(
          (playedMidnightMs - parseUtcDateMidnightMs(base.lastPlayedDate)) /
            MS_PER_UTC_DAY,
        )
      : null;

  const nextDistribution: GuessDistribution = [...base.guessDistribution];

  let nextCurrentStreak = 0;
  let nextWins = base.wins;

  if (input.won) {
    nextWins += 1;
    nextCurrentStreak =
      daysSinceLastPlayed === 1 ? base.currentStreak + 1 : 1;

    const clampedAttempt = Math.min(
      Math.max(0, Math.trunc(input.attempt)),
      MAX_ATTEMPTS - 1,
    );
    const currentBucketCount = nextDistribution[clampedAttempt] ?? 0;
    nextDistribution[clampedAttempt] = currentBucketCount + 1;
  }

  const nextMaxStreak = Math.max(base.maxStreak, nextCurrentStreak);

  return {
    gamesPlayed: base.gamesPlayed + 1,
    wins: nextWins,
    currentStreak: nextCurrentStreak,
    maxStreak: nextMaxStreak,
    guessDistribution: nextDistribution,
    lastPlayedDate: dateString,
  };
}

export function recordGenreRoundResult(
  genreId: string,
  input: RecordRoundResultInput,
  storage: StorageLike | null = getBrowserLocalStorage(),
): LocalGenreStats {
  const current = loadGenreStats(genreId, storage);
  const updated = computeUpdatedGenreStats(current, input);
  saveGenreStats(genreId, updated, storage);
  return updated;
}

function sanitizeTrack(raw: unknown): Track | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const { id, title, artist, genreId, provider, providerTrackId, snippetOffsetMs } =
    raw;

  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    typeof title !== "string" ||
    title.trim().length === 0 ||
    typeof artist !== "string" ||
    artist.trim().length === 0 ||
    typeof genreId !== "string" ||
    genreId.trim().length === 0 ||
    !isAudioProvider(provider) ||
    typeof providerTrackId !== "string" ||
    providerTrackId.trim().length === 0
  ) {
    return undefined;
  }

  const track: Track = {
    id: id.trim(),
    title: title.trim(),
    artist: artist.trim(),
    genreId: genreId.trim(),
    provider,
    providerTrackId: providerTrackId.trim(),
  };

  if (
    typeof snippetOffsetMs === "number" &&
    Number.isFinite(snippetOffsetMs) &&
    snippetOffsetMs >= 0 &&
    snippetOffsetMs + MAX_SNIPPET_MS <= MAX_PREVIEW_DURATION_MS
  ) {
    track.snippetOffsetMs = snippetOffsetMs;
  }

  return track;
}

function sanitizeGuessRecord(
  raw: unknown,
  fallbackIndex: number,
): GuessRecord | null {
  if (!isRecord(raw)) {
    return null;
  }

  const rawTrackId = raw.trackId;
  const rawFeedback = raw.feedback;
  const rawAttempt = raw.attempt;

  if (
    typeof rawTrackId !== "string" ||
    rawTrackId.trim().length === 0 ||
    !isGuessFeedback(rawFeedback)
  ) {
    return null;
  }

  const attempt =
    isNonNegativeInt(rawAttempt) && rawAttempt < MAX_ATTEMPTS
      ? rawAttempt
      : Math.min(Math.max(0, fallbackIndex), MAX_ATTEMPTS - 1);

  const record: GuessRecord = {
    trackId: rawTrackId.trim(),
    feedback: rawFeedback,
    attempt,
  };

  if (typeof raw.title === "string" && raw.title.trim().length > 0) {
    record.title = raw.title.trim();
  }

  if (typeof raw.artist === "string" && raw.artist.trim().length > 0) {
    record.artist = raw.artist.trim();
  }

  return record;
}

export function migrateDailyProgress(
  raw: unknown,
  expectedGenreId: string,
  expectedDate: string,
): DailyRoundProgress | null {
  if (!isRecord(raw) || !isValidUtcDateString(expectedDate)) {
    return null;
  }

  const genreId =
    typeof raw.genreId === "string" && raw.genreId.trim().length > 0
      ? raw.genreId.trim()
      : expectedGenreId;
  const date =
    typeof raw.date === "string" && raw.date.trim().length > 0
      ? raw.date.trim()
      : expectedDate;

  if (genreId !== expectedGenreId || date !== expectedDate) {
    return null;
  }

  if (!Array.isArray(raw.guesses)) {
    return null;
  }

  const guesses: GuessRecord[] = [];
  for (let i = 0; i < raw.guesses.length && guesses.length < MAX_ATTEMPTS; i++) {
    const sanitized = sanitizeGuessRecord(raw.guesses[i], i);
    if (sanitized === null) {
      return null;
    }
    guesses.push(sanitized);
  }

  const hasWinningGuess = guesses.some((g) => g.feedback === "correct");
  let status: RoundStatus;

  if (hasWinningGuess) {
    status = "won";
  } else if (guesses.length >= MAX_ATTEMPTS) {
    status = "lost";
  } else if (isRoundStatus(raw.status)) {
    status = raw.status;
  } else {
    status = "playing";
  }

  const defaultAttempt =
    status === "playing"
      ? Math.min(guesses.length, MAX_ATTEMPTS - 1)
      : Math.min(Math.max(0, guesses.length - 1), MAX_ATTEMPTS - 1);

  const attempt =
    isNonNegativeInt(raw.attempt) && raw.attempt < MAX_ATTEMPTS
      ? raw.attempt
      : defaultAttempt;

  const progress: DailyRoundProgress = {
    version: STORAGE_VERSION,
    genreId,
    date,
    status,
    attempt,
    guesses,
  };

  const answer = sanitizeTrack(raw.answer);
  if (answer !== undefined && status !== "playing") {
    progress.answer = answer;
  }

  return progress;
}

export function loadDailyProgress(
  genreId: string,
  date: string = getUtcDateString(),
  storage: StorageLike | null = getBrowserLocalStorage(),
): DailyRoundProgress | null {
  if (storage === null || genreId.trim().length === 0) {
    return null;
  }

  try {
    const primaryKey = getDailyProgressStorageKey(genreId, date, STORAGE_VERSION);
    const primaryRaw = storage.getItem(primaryKey);
    if (primaryRaw !== null) {
      const parsed: unknown = JSON.parse(primaryRaw);
      return migrateDailyProgress(parsed, genreId, date);
    }

    const legacyKeys = [
      getDailyProgressStorageKey(genreId, date, 0),
      `riffld:daily:${genreId}:${date}`,
    ];

    for (const legacyKey of legacyKeys) {
      const legacyRaw = storage.getItem(legacyKey);
      if (legacyRaw === null) {
        continue;
      }

      const parsed: unknown = JSON.parse(legacyRaw);
      const migrated = migrateDailyProgress(parsed, genreId, date);
      if (migrated !== null) {
        storage.setItem(primaryKey, JSON.stringify(migrated));
        storage.removeItem?.(legacyKey);
        return migrated;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function saveDailyProgress(
  progress: Omit<DailyRoundProgress, "version"> & { version?: number },
  storage: StorageLike | null = getBrowserLocalStorage(),
): DailyRoundProgress | null {
  const normalized = migrateDailyProgress(
    { ...progress, version: STORAGE_VERSION },
    progress.genreId,
    progress.date,
  );

  if (normalized === null || storage === null) {
    return normalized;
  }

  try {
    const key = getDailyProgressStorageKey(
      normalized.genreId,
      normalized.date,
      STORAGE_VERSION,
    );
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    // Ignore storage write errors.
  }

  return normalized;
}

export interface UseLocalStatsResult {
  stats: LocalGenreStats;
  dailyProgress: DailyRoundProgress | null;
  recordResult: (input: RecordRoundResultInput) => LocalGenreStats;
  saveProgress: (
    progress: Omit<DailyRoundProgress, "version"> & { version?: number },
  ) => DailyRoundProgress | null;
}

export function useLocalStats(
  genreId: string,
  date: string = getUtcDateString(),
): UseLocalStatsResult {
  const [stats, setStats] = useState<LocalGenreStats>(() =>
    createDefaultGenreStats(),
  );
  const [dailyProgress, setDailyProgress] = useState<DailyRoundProgress | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    const storage = getBrowserLocalStorage();
    const loadedStats = loadGenreStats(genreId, storage);
    const loadedProgress = loadDailyProgress(genreId, date, storage);

    if (active) {
      setStats(loadedStats);
      setDailyProgress(loadedProgress);
    }

    return () => {
      active = false;
    };
  }, [genreId, date]);

  const recordResult = (input: RecordRoundResultInput): LocalGenreStats => {
    const updated = recordGenreRoundResult(genreId, input);
    setStats(updated);
    return updated;
  };

  const saveProgress = (
    progress: Omit<DailyRoundProgress, "version"> & { version?: number },
  ): DailyRoundProgress | null => {
    const saved = saveDailyProgress(progress);
    setDailyProgress(saved);
    return saved;
  };

  return {
    stats,
    dailyProgress,
    recordResult,
    saveProgress,
  };
}
