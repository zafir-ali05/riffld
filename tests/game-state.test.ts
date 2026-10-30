import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAudioSnippetController,
  getSnippetWindowForAttempt,
  type AudioContextLike,
  type AudioElementLike,
  type AudioSnippetState,
} from "@/hooks/useAudioSnippet";
import {
  createInitialRoundState,
  createInfiniteSessionPool,
  getUnlockedSnippetDurationMs,
  restoreDailyRoundState,
  selectNextInfiniteTrack,
  submitDailyGuessToApi,
  submitInfiniteRoundGuess,
} from "@/hooks/useGameState";
import {
  loadDailyProgress,
  loadGenreStats,
  type StorageLike,
} from "@/hooks/useLocalStats";
import { SNIPPET_DURATIONS_MS, type Track } from "@/types/catalog";

class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const poolTracks: Track[] = [
  {
    id: "bad-bunny-safaera",
    title: "Safaera",
    artist: "Bad Bunny",
    genreId: "latin.urbano.reggaeton",
    provider: "deezer",
    providerTrackId: "908604612",
    snippetOffsetMs: 2000,
  },
  {
    id: "bad-bunny-titi-me-pregunto",
    title: "Tití Me Preguntó",
    artist: "Bad Bunny",
    genreId: "latin.urbano.reggaeton",
    provider: "deezer",
    providerTrackId: "908604613",
  },
  {
    id: "daddy-yankee-gasolina",
    title: "Gasolina",
    artist: "Daddy Yankee",
    genreId: "latin.urbano.reggaeton",
    provider: "deezer",
    providerTrackId: "908604614",
  },
  {
    id: "don-omar-danza-kuduro",
    title: "Danza Kuduro",
    artist: "Don Omar",
    genreId: "latin.urbano.reggaeton",
    provider: "deezer",
    providerTrackId: "908604615",
  },
  {
    id: "j-balvin-mi-gente",
    title: "Mi Gente",
    artist: "J Balvin",
    genreId: "latin.urbano.reggaeton",
    provider: "deezer",
    providerTrackId: "908604616",
  },
];

describe("round state machine: attempt progression and win/loss transitions", () => {
  const targetTrack = poolTracks[0]!;
  const sameArtistWrongSong = poolTracks[1]!;
  const wrongTrack = poolTracks[2]!;

  it("progresses through attempts 0..5 and unlocks SNIPPET_DURATIONS_MS (1s -> 2s -> 4s -> 7s -> 11s -> 16s)", () => {
    let state = createInitialRoundState({
      mode: "infinite",
      genreId: "latin.urbano.reggaeton",
      audioTargetId: targetTrack.id,
      snippetOffsetMs: targetTrack.snippetOffsetMs,
    });

    expect(state.status).toBe("playing");
    expect(state.attempt).toBe(0);
    expect(state.unlockedDurationMs).toBe(SNIPPET_DURATIONS_MS[0]);
    expect(state.answer).toBeNull();

    // Attempt 0: skip -> advances to attempt 1 (2000ms)
    state = submitInfiniteRoundGuess(state, "skip", targetTrack);
    expect(state.status).toBe("playing");
    expect(state.attempt).toBe(1);
    expect(state.unlockedDurationMs).toBe(2000);
    expect(state.guesses[0]?.feedback).toBe("skipped");
    expect(state.answer).toBeNull();

    // Attempt 1: wrong track -> advances to attempt 2 (4000ms)
    state = submitInfiniteRoundGuess(state, wrongTrack, targetTrack);
    expect(state.status).toBe("playing");
    expect(state.attempt).toBe(2);
    expect(state.unlockedDurationMs).toBe(4000);
    expect(state.guesses[1]?.feedback).toBe("wrong");
    expect(state.answer).toBeNull();

    // Attempt 2: same artist, wrong song -> advances to attempt 3 (7000ms)
    state = submitInfiniteRoundGuess(state, sameArtistWrongSong, targetTrack);
    expect(state.status).toBe("playing");
    expect(state.attempt).toBe(3);
    expect(state.unlockedDurationMs).toBe(7000);
    expect(state.guesses[2]?.feedback).toBe("artist");
    expect(state.answer).toBeNull();

    // Attempt 3: skip -> advances to attempt 4 (11000ms)
    state = submitInfiniteRoundGuess(state, "skip", targetTrack);
    expect(state.status).toBe("playing");
    expect(state.attempt).toBe(4);
    expect(state.unlockedDurationMs).toBe(11000);

    // Attempt 4: wrong -> advances to attempt 5 (16000ms)
    state = submitInfiniteRoundGuess(state, wrongTrack, targetTrack);
    expect(state.status).toBe("playing");
    expect(state.attempt).toBe(5);
    expect(state.unlockedDurationMs).toBe(16000);
    expect(state.answer).toBeNull();

    // Attempt 5 (6th try): wrong -> transitions to 'lost' and reveals answer
    state = submitInfiniteRoundGuess(state, wrongTrack, targetTrack);
    expect(state.status).toBe("lost");
    expect(state.attempt).toBe(5);
    expect(state.guesses).toHaveLength(6);
    expect(state.answer).toEqual(targetTrack);

    // Further guesses after 'lost' are ignored
    const afterLoss = submitInfiniteRoundGuess(state, targetTrack, targetTrack);
    expect(afterLoss).toEqual(state);
  });

  it("transitions to 'won' immediately upon a correct guess and ignores subsequent guesses", () => {
    let state = createInitialRoundState({
      mode: "infinite",
      genreId: "latin.urbano.reggaeton",
      audioTargetId: targetTrack.id,
    });

    state = submitInfiniteRoundGuess(state, "skip", targetTrack);
    state = submitInfiniteRoundGuess(state, sameArtistWrongSong, targetTrack);
    expect(state.attempt).toBe(2);
    expect(state.unlockedDurationMs).toBe(getUnlockedSnippetDurationMs(2));

    // Win on attempt index 2 (3rd attempt)
    state = submitInfiniteRoundGuess(state, targetTrack, targetTrack);
    expect(state.status).toBe("won");
    expect(state.attempt).toBe(2);
    expect(state.guesses).toHaveLength(3);
    expect(state.guesses[2]?.feedback).toBe("correct");
    expect(state.answer).toEqual(targetTrack);

    // Further guesses after 'won' are ignored
    const afterWin = submitInfiniteRoundGuess(state, wrongTrack, targetTrack);
    expect(afterWin).toEqual(state);
  });
});

describe("Infinite Mode non-repeating session pool exhaustion", () => {
  it("never repeats a track until all tracks in the channel pool have been played", () => {
    const sessionPool = createInfiniteSessionPool(poolTracks);
    const firstCycleIds: string[] = [];

    for (let i = 0; i < poolTracks.length; i++) {
      const next = sessionPool.nextTrack();
      expect(firstCycleIds).not.toContain(next.id);
      firstCycleIds.push(next.id);
      expect(sessionPool.getPlayedCount()).toBe(i + 1);
    }

    // Every track in the pool was selected exactly once in the first cycle
    expect(new Set(firstCycleIds).size).toBe(poolTracks.length);
    expect(firstCycleIds.sort()).toEqual(poolTracks.map((t) => t.id).sort());

    // Next pick after exhaustion resets the cycle and starts a fresh full cycle
    const secondCycleIds: string[] = [];
    for (let i = 0; i < poolTracks.length; i++) {
      const next = sessionPool.nextTrack();
      expect(secondCycleIds).not.toContain(next.id);
      secondCycleIds.push(next.id);
    }

    expect(new Set(secondCycleIds).size).toBe(poolTracks.length);
    expect(secondCycleIds.sort()).toEqual(poolTracks.map((t) => t.id).sort());
  });

  it("reports resetCycle: true when selectNextInfiniteTrack exhausts the played set", () => {
    const allIds = new Set(poolTracks.map((t) => t.id));
    const result = selectNextInfiniteTrack(poolTracks, allIds, () => 0);

    expect(result.resetCycle).toBe(true);
    expect(result.track).toEqual(poolTracks[0]);
    expect(result.playedIds.size).toBe(1);
    expect(result.playedIds.has(poolTracks[0]!.id)).toBe(true);

    expect(() => selectNextInfiniteTrack([], new Set())).toThrow(/empty pool/i);
  });
});

describe("Daily Mode API integration and localStorage synchronization", () => {
  const targetTrack = poolTracks[0]!;
  const wrongTrack = poolTracks[2]!;

  it("syncs in-progress daily guesses and records final win stats to localStorage", async () => {
    const storage = new MemoryStorage();
    const genreId = "latin.urbano.reggaeton";
    const date = "2026-10-30";

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            feedback: "wrong",
            attempt: 0,
            status: "playing",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            feedback: "correct",
            attempt: 1,
            status: "won",
            answer: targetTrack,
          }),
          { status: 200 },
        ),
      );

    const initialState = createInitialRoundState({
      mode: "daily",
      genreId,
      audioTargetId: "dt_sample_token",
      date,
      puzzleNumber: 302,
    });

    // Submit wrong guess on attempt 0
    const step1 = await submitDailyGuessToApi({
      genreId,
      state: initialState,
      trackIdOrSkip: wrongTrack.id,
      autocompleteTracks: poolTracks,
      fetchImpl: mockFetch,
      storage,
    });

    expect(step1.feedback).toBe("wrong");
    expect(step1.nextState.status).toBe("playing");
    expect(step1.nextState.attempt).toBe(1);
    expect(step1.nextState.unlockedDurationMs).toBe(2000);
    expect(step1.updatedStats).toBeUndefined();

    // Simulate page refresh mid-round -> restoreDailyRoundState recovers attempt 1 and guess history
    const savedMidRound = loadDailyProgress(genreId, date, storage);
    const restoredMidRound = restoreDailyRoundState(initialState, savedMidRound);
    expect(restoredMidRound.attempt).toBe(1);
    expect(restoredMidRound.unlockedDurationMs).toBe(2000);
    expect(restoredMidRound.guesses).toHaveLength(1);
    expect(restoredMidRound.guesses[0]?.trackId).toBe(wrongTrack.id);

    // Submit winning guess on attempt 1
    const step2 = await submitDailyGuessToApi({
      genreId,
      state: restoredMidRound,
      trackIdOrSkip: targetTrack.id,
      autocompleteTracks: poolTracks,
      fetchImpl: mockFetch,
      storage,
    });

    expect(step2.feedback).toBe("correct");
    expect(step2.nextState.status).toBe("won");
    expect(step2.nextState.answer).toEqual(targetTrack);
    expect(step2.updatedStats).toEqual({
      gamesPlayed: 1,
      wins: 1,
      currentStreak: 1,
      maxStreak: 1,
      guessDistribution: [0, 1, 0, 0, 0, 0],
      lastPlayedDate: date,
    });

    expect(loadGenreStats(genreId, storage)).toEqual(step2.updatedStats);
  });
});

describe("Audio snippet controller (src/hooks/useAudioSnippet.ts)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes snippet windows starting at snippetOffsetMs and bounded to 30000ms", () => {
    expect(getSnippetWindowForAttempt(0, 0)).toEqual({
      startMs: 0,
      durationMs: 1000,
      endMs: 1000,
      startTimeSec: 0,
      endTimeSec: 1,
    });

    expect(getSnippetWindowForAttempt(5, 2500)).toEqual({
      startMs: 2500,
      durationMs: 16000,
      endMs: 18500,
      startTimeSec: 2.5,
      endTimeSec: 18.5,
    });
  });

  it("resumes AudioContext inside play(), slices playback at snippetOffsetMs, stops after SNIPPET_DURATIONS_MS[attempt], and stops on visibilitychange", async () => {
    const resumeSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockAudioContext: AudioContextLike = {
      state: "suspended",
      resume: resumeSpy,
    };

    const pauseSpy = vi.fn();
    const playSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockAudioElement: AudioElementLike = {
      src: "",
      currentTime: 0,
      play: playSpy,
      pause: pauseSpy,
    };

    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          previewUrl: "https://cdns-preview.dzcdn.net/stream/c-test.mp3",
          provider: "deezer",
          snippetOffsetMs: 3000,
        }),
        { status: 200 },
      ),
    );

    const observedStates: AudioSnippetState[] = [];
    const controller = createAudioSnippetController({
      targetId: "dt_test_token",
      attempt: 1, // 2000ms duration
      fetchImpl: mockFetch,
      createAudioElement: () => mockAudioElement,
      getAudioContext: () => mockAudioContext,
      onStateChange: (next) => observedStates.push(next),
    });

    await controller.play();

    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(mockAudioElement.currentTime).toBe(3); // 3000ms -> 3s
    expect(controller.getState().status).toBe("playing");
    expect(controller.getState().durationMs).toBe(2000);
    expect(controller.getState().snippetOffsetMs).toBe(3000);

    // Advance 2000ms -> automatically stops playback and transitions back to idle
    vi.advanceTimersByTime(2000);
    expect(pauseSpy).toHaveBeenCalled();
    expect(controller.getState().status).toBe("idle");

    // Start playing again and hide tab -> visibilitychange stops playback immediately
    await controller.play();
    expect(controller.getState().status).toBe("playing");
    controller.handleVisibilityChange(true);
    expect(controller.getState().status).toBe("idle");
  });

  it("exposes 'error' state when preview resolution fails and recovers via retry()", async () => {
    const mockAudioElement: AudioElementLike = {
      src: "",
      currentTime: 0,
      play: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      pause: vi.fn(),
    };

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            previewUrl: "https://cdns-preview.dzcdn.net/stream/c-recovered.mp3",
            provider: "deezer",
            snippetOffsetMs: 0,
          }),
          { status: 200 },
        ),
      );

    const controller = createAudioSnippetController({
      targetId: "bad-bunny-safaera",
      attempt: 0,
      fetchImpl: mockFetch,
      createAudioElement: () => mockAudioElement,
      getAudioContext: () => null,
    });

    await controller.play();
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().error).toBeTruthy();

    await controller.retry();
    expect(controller.getState().status).toBe("playing");
    expect(controller.getState().error).toBeNull();
    controller.destroy();
  });
});
