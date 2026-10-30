"use client";

import { useEffect, useRef, useState } from "react";
import {
  createDefaultGenreStats,
  getBrowserLocalStorage,
  loadDailyProgress,
  loadGenreStats,
  recordGenreRoundResult,
  saveDailyProgress,
  type StorageLike,
} from "@/hooks/useLocalStats";
import { classifyGuess } from "@/lib/feedback";
import { getUtcDateString } from "@/lib/share";
import {
  MAX_ATTEMPTS,
  SNIPPET_DURATIONS_MS,
  type AutocompleteTrack,
  type DailyGuessResponse,
  type DailyPuzzleResponse,
  type DailyRoundProgress,
  type GuessFeedback,
  type GuessRecord,
  type LocalGenreStats,
  type RoundStatus,
  type Track,
} from "@/types/catalog";

export type GameMode = "daily" | "infinite";

export interface GameRoundState {
  mode: GameMode;
  genreId: string;
  status: RoundStatus;
  attempt: number;
  unlockedDurationMs: number;
  guesses: GuessRecord[];
  answer: Track | null;
  audioTargetId: string | null;
  snippetOffsetMs: number;
  date: string | null;
  puzzleNumber: number | null;
}

export interface ApplyGuessInput {
  trackId: string;
  title?: string;
  artist?: string;
  feedback: GuessFeedback;
  answer?: Track;
}

export interface InfiniteSelectionResult {
  track: Track;
  playedIds: Set<string>;
  resetCycle: boolean;
}

export interface InfiniteSessionPool {
  nextTrack(): Track;
  getCurrentTrack(): Track | null;
  getPlayedCount(): number;
  reset(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isDailyPuzzleResponse(value: unknown): value is DailyPuzzleResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.genreId === "string" &&
    typeof value.date === "string" &&
    typeof value.puzzleNumber === "number" &&
    typeof value.audioToken === "string" &&
    Array.isArray(value.tracks)
  );
}

function isDailyGuessResponse(value: unknown): value is DailyGuessResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isGuessFeedback(value.feedback) &&
    typeof value.attempt === "number" &&
    isRoundStatus(value.status)
  );
}

export function getUnlockedSnippetDurationMs(attempt: number): number {
  const clamped = Number.isFinite(attempt)
    ? Math.min(Math.max(0, Math.trunc(attempt)), MAX_ATTEMPTS - 1)
    : 0;
  return SNIPPET_DURATIONS_MS[clamped] ?? SNIPPET_DURATIONS_MS[0];
}

export function createInitialRoundState(options: {
  mode: GameMode;
  genreId: string;
  audioTargetId?: string | null;
  snippetOffsetMs?: number;
  date?: string | null;
  puzzleNumber?: number | null;
}): GameRoundState {
  return {
    mode: options.mode,
    genreId: options.genreId,
    status: "playing",
    attempt: 0,
    unlockedDurationMs: getUnlockedSnippetDurationMs(0),
    guesses: [],
    answer: null,
    audioTargetId: options.audioTargetId ?? null,
    snippetOffsetMs: options.snippetOffsetMs ?? 0,
    date: options.date ?? null,
    puzzleNumber: options.puzzleNumber ?? null,
  };
}

export function restoreDailyRoundState(
  baseState: GameRoundState,
  progress: DailyRoundProgress | null,
): GameRoundState {
  if (
    progress === null ||
    progress.genreId !== baseState.genreId ||
    (baseState.date !== null && progress.date !== baseState.date)
  ) {
    return baseState;
  }

  const clampedAttempt = Math.min(
    Math.max(0, Math.trunc(progress.attempt)),
    MAX_ATTEMPTS - 1,
  );

  return {
    ...baseState,
    status: progress.status,
    attempt: clampedAttempt,
    unlockedDurationMs: getUnlockedSnippetDurationMs(clampedAttempt),
    guesses: [...progress.guesses],
    answer:
      progress.status !== "playing" && progress.answer !== undefined
        ? progress.answer
        : null,
  };
}

export function applyGuessToRoundState(
  state: GameRoundState,
  input: ApplyGuessInput,
): GameRoundState {
  if (state.status !== "playing" || state.guesses.length >= MAX_ATTEMPTS) {
    return state;
  }

  const normalizedTrackId =
    input.feedback === "skipped" ? "skip" : input.trackId.trim();

  const guessRecord: GuessRecord = {
    trackId: normalizedTrackId,
    feedback: input.feedback,
    attempt: state.attempt,
  };

  if (input.title !== undefined && input.title.trim().length > 0) {
    guessRecord.title = input.title.trim();
  }

  if (input.artist !== undefined && input.artist.trim().length > 0) {
    guessRecord.artist = input.artist.trim();
  }

  const nextGuesses = [...state.guesses, guessRecord];

  if (input.feedback === "correct") {
    return {
      ...state,
      status: "won",
      guesses: nextGuesses,
      answer: input.answer ?? state.answer,
    };
  }

  if (state.attempt >= MAX_ATTEMPTS - 1) {
    return {
      ...state,
      status: "lost",
      attempt: MAX_ATTEMPTS - 1,
      unlockedDurationMs: getUnlockedSnippetDurationMs(MAX_ATTEMPTS - 1),
      guesses: nextGuesses,
      answer: input.answer ?? state.answer,
    };
  }

  const nextAttempt = state.attempt + 1;
  return {
    ...state,
    status: "playing",
    attempt: nextAttempt,
    unlockedDurationMs: getUnlockedSnippetDurationMs(nextAttempt),
    guesses: nextGuesses,
  };
}

export function submitInfiniteRoundGuess(
  state: GameRoundState,
  guess: AutocompleteTrack | Track | "skip" | "skipped",
  targetTrack: Track,
): GameRoundState {
  if (state.status !== "playing") {
    return state;
  }

  const isSkip = guess === "skip" || guess === "skipped";
  const feedback = classifyGuess(isSkip ? "skip" : guess, targetTrack);
  const isRoundFinished =
    feedback === "correct" || state.attempt >= MAX_ATTEMPTS - 1;

  return applyGuessToRoundState(state, {
    trackId: isSkip ? "skip" : guess.id,
    title: isSkip ? undefined : guess.title,
    artist: isSkip ? undefined : guess.artist,
    feedback,
    ...(isRoundFinished ? { answer: targetTrack } : {}),
  });
}

export function selectNextInfiniteTrack(
  tracks: readonly Track[],
  playedIds: ReadonlySet<string>,
  random: () => number = Math.random,
): InfiniteSelectionResult {
  if (tracks.length === 0) {
    throw new Error("Cannot select an Infinite Mode track from an empty pool.");
  }

  let nextPlayed = new Set(playedIds);
  let available = tracks.filter((track) => !nextPlayed.has(track.id));
  let resetCycle = false;

  if (available.length === 0) {
    nextPlayed = new Set<string>();
    available = [...tracks];
    resetCycle = true;
  }

  const rawRandom = random();
  const clampedRandom = Number.isFinite(rawRandom)
    ? Math.min(Math.max(0, rawRandom), 0.999999999)
    : 0;
  const index = Math.floor(clampedRandom * available.length);
  const selected = available[index] ?? available[0]!;

  nextPlayed.add(selected.id);

  return {
    track: selected,
    playedIds: nextPlayed,
    resetCycle,
  };
}

export function createInfiniteSessionPool(
  tracks: readonly Track[],
  random: () => number = Math.random,
): InfiniteSessionPool {
  let playedIds = new Set<string>();
  let currentTrack: Track | null = null;

  return {
    nextTrack(): Track {
      const selection = selectNextInfiniteTrack(tracks, playedIds, random);
      playedIds = selection.playedIds;
      currentTrack = selection.track;
      return selection.track;
    },
    getCurrentTrack(): Track | null {
      return currentTrack;
    },
    getPlayedCount(): number {
      return playedIds.size;
    },
    reset(): void {
      playedIds = new Set<string>();
      currentTrack = null;
    },
  };
}

export async function submitDailyGuessToApi(options: {
  genreId: string;
  state: GameRoundState;
  trackIdOrSkip: string;
  autocompleteTracks: readonly AutocompleteTrack[];
  fetchImpl?: typeof fetch;
  storage?: StorageLike | null;
}): Promise<{
  nextState: GameRoundState;
  feedback: GuessFeedback;
  updatedStats?: LocalGenreStats;
}> {
  const {
    genreId,
    state,
    trackIdOrSkip,
    autocompleteTracks,
    fetchImpl = fetch,
    storage = getBrowserLocalStorage(),
  } = options;

  if (state.status !== "playing") {
    throw new Error("Cannot submit a guess after the daily round has ended.");
  }

  const trimmed = trackIdOrSkip.trim();
  const isSkip = trimmed === "skip" || trimmed === "skipped";
  const matchedTrack = isSkip
    ? undefined
    : autocompleteTracks.find((item) => item.id === trimmed);

  const response = await fetchImpl(
    `/api/daily/${encodeURIComponent(genreId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        trackId: isSkip ? "skip" : trimmed,
        attempt: state.attempt,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Daily guess submission failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!isDailyGuessResponse(payload)) {
    throw new Error("Invalid response payload from daily guess endpoint.");
  }

  const nextState = applyGuessToRoundState(state, {
    trackId: isSkip ? "skip" : trimmed,
    title: matchedTrack?.title,
    artist: matchedTrack?.artist,
    feedback: payload.feedback,
    answer: payload.answer,
  });

  const roundDate = nextState.date ?? getUtcDateString();
  saveDailyProgress(
    {
      genreId,
      date: roundDate,
      status: nextState.status,
      attempt: nextState.attempt,
      guesses: nextState.guesses,
      ...(nextState.answer !== null ? { answer: nextState.answer } : {}),
    },
    storage,
  );

  let updatedStats: LocalGenreStats | undefined;
  if (nextState.status === "won" || nextState.status === "lost") {
    updatedStats = recordGenreRoundResult(
      genreId,
      {
        won: nextState.status === "won",
        attempt: state.attempt,
        date: roundDate,
      },
      storage,
    );
  }

  return {
    nextState,
    feedback: payload.feedback,
    ...(updatedStats !== undefined ? { updatedStats } : {}),
  };
}

export interface UseDailyGameOptions {
  mode: "daily";
  genreId: string;
  initialPuzzle?: DailyPuzzleResponse;
  fetchImpl?: typeof fetch;
  storage?: StorageLike | null;
}

export interface UseInfiniteGameOptions {
  mode: "infinite";
  genreId: string;
  tracks: readonly Track[];
  random?: () => number;
}

export type UseGameStateOptions = UseDailyGameOptions | UseInfiniteGameOptions;

export interface UseGameStateResult extends GameRoundState {
  tracks: AutocompleteTrack[];
  stats: LocalGenreStats;
  isLoading: boolean;
  error: string | null;
  submitGuess: (trackIdOrSkip: string) => Promise<GuessFeedback | null>;
  skipAttempt: () => Promise<GuessFeedback | null>;
  nextRound: () => void;
}

export function useGameState(options: UseGameStateOptions): UseGameStateResult {
  const { mode, genreId } = options;

  const infinitePoolRef = useRef<{
    genreId: string;
    playedIds: Set<string>;
    currentTrack: Track | null;
  }>({
    genreId,
    playedIds: new Set<string>(),
    currentTrack: null,
  });

  if (infinitePoolRef.current.genreId !== genreId) {
    infinitePoolRef.current = {
      genreId,
      playedIds: new Set<string>(),
      currentTrack: null,
    };
  }

  if (
    options.mode === "infinite" &&
    infinitePoolRef.current.currentTrack === null &&
    options.tracks.length > 0
  ) {
    const selection = selectNextInfiniteTrack(
      options.tracks,
      infinitePoolRef.current.playedIds,
      options.random,
    );
    infinitePoolRef.current.playedIds = selection.playedIds;
    infinitePoolRef.current.currentTrack = selection.track;
  }

  const initialInfiniteTrack =
    options.mode === "infinite" ? infinitePoolRef.current.currentTrack : null;

  const [roundState, setRoundState] = useState<GameRoundState>(() => {
    if (options.mode === "daily" && options.initialPuzzle !== undefined) {
      return createInitialRoundState({
        mode: "daily",
        genreId,
        audioTargetId: options.initialPuzzle.audioToken,
        date: options.initialPuzzle.date,
        puzzleNumber: options.initialPuzzle.puzzleNumber,
      });
    }

    if (options.mode === "infinite") {
      return createInitialRoundState({
        mode: "infinite",
        genreId,
        audioTargetId: initialInfiniteTrack?.id ?? null,
        snippetOffsetMs: initialInfiniteTrack?.snippetOffsetMs ?? 0,
      });
    }

    return createInitialRoundState({ mode, genreId });
  });

  const [autocompleteTracks, setAutocompleteTracks] = useState<
    AutocompleteTrack[]
  >(() => {
    if (options.mode === "daily") {
      return options.initialPuzzle?.tracks ?? [];
    }
    return options.tracks.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
    }));
  });

  const [stats, setStats] = useState<LocalGenreStats>(() =>
    createDefaultGenreStats(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    options.mode === "daily" && options.initialPuzzle === undefined,
  );
  const [error, setError] = useState<string | null>(null);

  const initialPuzzle =
    options.mode === "daily" ? options.initialPuzzle : undefined;
  const fetchImpl = options.mode === "daily" ? options.fetchImpl : undefined;
  const customStorage = options.mode === "daily" ? options.storage : undefined;

  useEffect(() => {
    let active = true;
    const storage = customStorage ?? getBrowserLocalStorage();
    setStats(loadGenreStats(genreId, storage));

    if (mode !== "daily") {
      return () => {
        active = false;
      };
    }

    if (initialPuzzle !== undefined) {
      const base = createInitialRoundState({
        mode: "daily",
        genreId,
        audioTargetId: initialPuzzle.audioToken,
        date: initialPuzzle.date,
        puzzleNumber: initialPuzzle.puzzleNumber,
      });
      const saved = loadDailyProgress(genreId, initialPuzzle.date, storage);
      setAutocompleteTracks(initialPuzzle.tracks);
      setRoundState(restoreDailyRoundState(base, saved));
      setIsLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const requestFetch = fetchImpl ?? fetch;
        const response = await requestFetch(
          `/api/daily/${encodeURIComponent(genreId)}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );

        if (!active || controller.signal.aborted) {
          return;
        }

        if (!response.ok) {
          setError("Unable to load daily puzzle.");
          setIsLoading(false);
          return;
        }

        const payload: unknown = await response.json();
        if (!active || controller.signal.aborted) {
          return;
        }

        if (!isDailyPuzzleResponse(payload)) {
          setError("Invalid daily puzzle payload.");
          setIsLoading(false);
          return;
        }

        const base = createInitialRoundState({
          mode: "daily",
          genreId,
          audioTargetId: payload.audioToken,
          date: payload.date,
          puzzleNumber: payload.puzzleNumber,
        });
        const saved = loadDailyProgress(genreId, payload.date, storage);

        setAutocompleteTracks(payload.tracks);
        setRoundState(restoreDailyRoundState(base, saved));
        setIsLoading(false);
      } catch {
        if (!active || controller.signal.aborted) {
          return;
        }
        setError("Unable to load daily puzzle.");
        setIsLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [mode, genreId, initialPuzzle, fetchImpl, customStorage]);

  const submitGuess = async (
    trackIdOrSkip: string,
  ): Promise<GuessFeedback | null> => {
    if (roundState.status !== "playing") {
      return null;
    }

    if (options.mode === "infinite") {
      const target = infinitePoolRef.current.currentTrack;
      if (target === null) {
        return null;
      }

      const trimmed = trackIdOrSkip.trim();
      const isSkip = trimmed === "skip" || trimmed === "skipped";
      const guessedTrack = isSkip
        ? "skip"
        : options.tracks.find((track) => track.id === trimmed);

      if (guessedTrack === undefined) {
        setError(`Unknown track "${trimmed}".`);
        return null;
      }

      const nextState = submitInfiniteRoundGuess(
        roundState,
        guessedTrack,
        target,
      );
      setRoundState(nextState);
      setError(null);
      const lastGuess = nextState.guesses[nextState.guesses.length - 1];
      return lastGuess?.feedback ?? null;
    }

    try {
      setError(null);
      const result = await submitDailyGuessToApi({
        genreId,
        state: roundState,
        trackIdOrSkip,
        autocompleteTracks,
        fetchImpl: options.fetchImpl,
        storage: options.storage,
      });

      setRoundState(result.nextState);
      if (result.updatedStats !== undefined) {
        setStats(result.updatedStats);
      }
      return result.feedback;
    } catch {
      setError("Unable to submit guess.");
      return null;
    }
  };

  const skipAttempt = async (): Promise<GuessFeedback | null> => {
    return submitGuess("skip");
  };

  const nextRound = (): void => {
    if (options.mode !== "infinite" || options.tracks.length === 0) {
      return;
    }

    const selection = selectNextInfiniteTrack(
      options.tracks,
      infinitePoolRef.current.playedIds,
      options.random,
    );
    infinitePoolRef.current.playedIds = selection.playedIds;
    infinitePoolRef.current.currentTrack = selection.track;

    setRoundState(
      createInitialRoundState({
        mode: "infinite",
        genreId,
        audioTargetId: selection.track.id,
        snippetOffsetMs: selection.track.snippetOffsetMs ?? 0,
      }),
    );
    setError(null);
  };

  return {
    ...roundState,
    tracks: autocompleteTracks,
    stats,
    isLoading,
    error,
    submitGuess,
    skipAttempt,
    nextRound,
  };
}
