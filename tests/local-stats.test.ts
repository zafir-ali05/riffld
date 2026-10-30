import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STATS_STORAGE_KEY,
  STORAGE_VERSION,
  computeUpdatedGenreStats,
  createDefaultGenreStats,
  getDailyProgressStorageKey,
  getStatsStorageKey,
  loadAllGenreStats,
  loadDailyProgress,
  loadGenreStats,
  migrateDailyProgress,
  migrateStatsStore,
  recordGenreRoundResult,
  saveDailyProgress,
  saveGenreStats,
  type StorageLike,
} from "@/hooks/useLocalStats";
import type { Track } from "@/types/catalog";

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

  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

const sampleAnswerTrack: Track = {
  id: "bad-bunny-safaera",
  title: "Safaera",
  artist: "Bad Bunny",
  genreId: "latin.urbano.reggaeton",
  provider: "deezer",
  providerTrackId: "908604612",
  snippetOffsetMs: 1500,
};

describe("useLocalStats storage keys, SSR safety, and defensive parsing", () => {
  it("formats versioned storage keys for stats and daily progress", () => {
    expect(STORAGE_VERSION).toBe(1);
    expect(STATS_STORAGE_KEY).toBe("riffld:v1:stats");
    expect(getStatsStorageKey()).toBe("riffld:v1:stats");
    expect(
      getDailyProgressStorageKey("latin.urbano.reggaeton", "2026-10-30"),
    ).toBe("riffld:v1:daily:latin.urbano.reggaeton:2026-10-30");
  });

  it("guards reads and writes safely when storage is null (SSR or blocked storage)", () => {
    expect(loadAllGenreStats(null)).toEqual({});
    expect(loadGenreStats("latin.urbano.reggaeton", null)).toEqual(
      createDefaultGenreStats(),
    );
    expect(
      loadDailyProgress("latin.urbano.reggaeton", "2026-10-30", null),
    ).toBeNull();

    expect(() =>
      saveGenreStats(
        "latin.urbano.reggaeton",
        createDefaultGenreStats(),
        null,
      ),
    ).not.toThrow();

    expect(() =>
      saveDailyProgress(
        {
          genreId: "latin.urbano.reggaeton",
          date: "2026-10-30",
          status: "playing",
          attempt: 1,
          guesses: [
            { trackId: "skip", feedback: "skipped", attempt: 0 },
          ],
        },
        null,
      ),
    ).not.toThrow();
  });

  it("recovers from corrupt JSON, non-object payloads, and invalid fields by falling back to defaults", () => {
    const storage = new MemoryStorage();

    storage.setItem(STATS_STORAGE_KEY, "{corrupt-json!!!");
    expect(loadGenreStats("latin.urbano.reggaeton", storage)).toEqual(
      createDefaultGenreStats(),
    );

    storage.setItem(STATS_STORAGE_KEY, JSON.stringify(["not", "an", "object"]));
    expect(loadGenreStats("latin.urbano.reggaeton", storage)).toEqual(
      createDefaultGenreStats(),
    );

    storage.setItem(
      STATS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        genres: {
          "latin.urbano.reggaeton": {
            gamesPlayed: -5,
            wins: 3,
            currentStreak: "bad",
            maxStreak: 2,
            guessDistribution: [1, "bad", 2],
            lastPlayedDate: "2026-99-99",
          },
        },
      }),
    );

    expect(loadGenreStats("latin.urbano.reggaeton", storage)).toEqual({
      gamesPlayed: 3,
      wins: 3,
      currentStreak: 0,
      maxStreak: 2,
      guessDistribution: [0, 0, 0, 0, 0, 0],
    });

    const dailyKey = getDailyProgressStorageKey(
      "latin.urbano.reggaeton",
      "2026-10-30",
    );
    storage.setItem(dailyKey, "{corrupt-daily-json");
    expect(
      loadDailyProgress("latin.urbano.reggaeton", "2026-10-30", storage),
    ).toBeNull();
  });
});

describe("streak continuity and streak resets (UTC dates)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments currentStreak and maxStreak across consecutive UTC days and updates guessDistribution", () => {
    const storage = new MemoryStorage();
    const genreId = "latin.urbano.reggaeton";

    // Day 1 win on attempt index 2 (3rd try)
    vi.setSystemTime(new Date("2026-10-28T23:50:00.000Z"));
    const day1 = recordGenreRoundResult(
      genreId,
      { won: true, attempt: 2 },
      storage,
    );
    expect(day1).toEqual({
      gamesPlayed: 1,
      wins: 1,
      currentStreak: 1,
      maxStreak: 1,
      guessDistribution: [0, 0, 1, 0, 0, 0],
      lastPlayedDate: "2026-10-28",
    });

    // Day 2 win on attempt index 0 (1st try) right after 00:00 UTC rollover
    vi.setSystemTime(new Date("2026-10-29T00:05:00.000Z"));
    const day2 = recordGenreRoundResult(
      genreId,
      { won: true, attempt: 0 },
      storage,
    );
    expect(day2).toEqual({
      gamesPlayed: 2,
      wins: 2,
      currentStreak: 2,
      maxStreak: 2,
      guessDistribution: [1, 0, 1, 0, 0, 0],
      lastPlayedDate: "2026-10-29",
    });

    // Day 3 win on attempt index 5 (6th try)
    vi.setSystemTime(new Date("2026-10-30T14:00:00.000Z"));
    const day3 = recordGenreRoundResult(
      genreId,
      { won: true, attempt: 5 },
      storage,
    );
    expect(day3).toEqual({
      gamesPlayed: 3,
      wins: 3,
      currentStreak: 3,
      maxStreak: 3,
      guessDistribution: [1, 0, 1, 0, 0, 1],
      lastPlayedDate: "2026-10-30",
    });

    // Duplicate record on the same UTC date is ignored
    const duplicateSameDay = recordGenreRoundResult(
      genreId,
      { won: true, attempt: 0 },
      storage,
    );
    expect(duplicateSameDay).toEqual(day3);
  });

  it("resets currentStreak to 1 when winning after skipping one or more UTC days while preserving maxStreak", () => {
    let stats = computeUpdatedGenreStats(undefined, {
      won: true,
      attempt: 1,
      date: "2026-10-25",
    });
    stats = computeUpdatedGenreStats(stats, {
      won: true,
      attempt: 2,
      date: "2026-10-26",
    });
    stats = computeUpdatedGenreStats(stats, {
      won: true,
      attempt: 0,
      date: "2026-10-27",
    });
    expect(stats.currentStreak).toBe(3);
    expect(stats.maxStreak).toBe(3);

    // Skip 2026-10-28, win on 2026-10-29 -> streak resets to 1, maxStreak stays 3
    stats = computeUpdatedGenreStats(stats, {
      won: true,
      attempt: 3,
      date: "2026-10-29",
    });
    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(3);
    expect(stats.gamesPlayed).toBe(4);
    expect(stats.wins).toBe(4);
    expect(stats.guessDistribution).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it("resets currentStreak to 0 on a loss and starts back at 1 on the next win", () => {
    let stats = computeUpdatedGenreStats(undefined, {
      won: true,
      attempt: 0,
      date: "2026-10-28",
    });
    stats = computeUpdatedGenreStats(stats, {
      won: true,
      attempt: 1,
      date: "2026-10-29",
    });
    expect(stats.currentStreak).toBe(2);
    expect(stats.maxStreak).toBe(2);

    // Loss on 2026-10-30
    stats = computeUpdatedGenreStats(stats, {
      won: false,
      attempt: 5,
      date: "2026-10-30",
    });
    expect(stats.currentStreak).toBe(0);
    expect(stats.maxStreak).toBe(2);
    expect(stats.gamesPlayed).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.guessDistribution).toEqual([1, 1, 0, 0, 0, 0]);

    // Win on 2026-10-31
    stats = computeUpdatedGenreStats(stats, {
      won: true,
      attempt: 4,
      date: "2026-10-31",
    });
    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(2);
    expect(stats.gamesPlayed).toBe(4);
    expect(stats.wins).toBe(3);
    expect(stats.guessDistribution).toEqual([1, 1, 0, 0, 1, 0]);
  });
});

describe("in-progress daily round persistence and version migrations", () => {
  it("persists and restores in-progress and completed daily rounds so refresh does not reset guesses", () => {
    const storage = new MemoryStorage();
    const genreId = "latin.urbano.reggaeton";
    const date = "2026-10-30";

    saveDailyProgress(
      {
        genreId,
        date,
        status: "playing",
        attempt: 2,
        guesses: [
          {
            trackId: "daddy-yankee-gasolina",
            title: "Gasolina",
            artist: "Daddy Yankee",
            feedback: "wrong",
            attempt: 0,
          },
          {
            trackId: "skip",
            feedback: "skipped",
            attempt: 1,
          },
        ],
      },
      storage,
    );

    const restoredInProgress = loadDailyProgress(genreId, date, storage);
    expect(restoredInProgress).toEqual({
      version: 1,
      genreId,
      date,
      status: "playing",
      attempt: 2,
      guesses: [
        {
          trackId: "daddy-yankee-gasolina",
          title: "Gasolina",
          artist: "Daddy Yankee",
          feedback: "wrong",
          attempt: 0,
        },
        {
          trackId: "skip",
          feedback: "skipped",
          attempt: 1,
        },
      ],
    });

    // Complete round as won and verify answer is persisted
    saveDailyProgress(
      {
        genreId,
        date,
        status: "won",
        attempt: 2,
        guesses: [
          ...restoredInProgress!.guesses,
          {
            trackId: sampleAnswerTrack.id,
            title: sampleAnswerTrack.title,
            artist: sampleAnswerTrack.artist,
            feedback: "correct",
            attempt: 2,
          },
        ],
        answer: sampleAnswerTrack,
      },
      storage,
    );

    const restoredWon = loadDailyProgress(genreId, date, storage);
    expect(restoredWon?.status).toBe("won");
    expect(restoredWon?.guesses).toHaveLength(3);
    expect(restoredWon?.answer).toEqual(sampleAnswerTrack);
  });

  it("migrates legacy v0 stats keys and custom multi-step version migrators without wiping data", () => {
    const storage = new MemoryStorage();

    // Seed legacy v0 key with unversioned flat genre map using legacy field names
    storage.setItem(
      "riffld:v0:stats",
      JSON.stringify({
        "latin.urbano.reggaeton": {
          played: 5,
          gamesWon: 4,
          streak: 3,
          bestStreak: 4,
          distribution: [1, 2, 1, 0, 0, 0],
          lastPlayedDate: "2026-10-29",
        },
      }),
    );

    const loaded = loadGenreStats("latin.urbano.reggaeton", storage);
    expect(loaded).toEqual({
      gamesPlayed: 5,
      wins: 4,
      currentStreak: 3,
      maxStreak: 4,
      guessDistribution: [1, 2, 1, 0, 0, 0],
      lastPlayedDate: "2026-10-29",
    });

    // Legacy key was migrated to riffld:v1:stats and removed
    expect(storage.getItem("riffld:v0:stats")).toBeNull();
    expect(storage.getItem(STATS_STORAGE_KEY)).not.toBeNull();

    // Verify multi-step migration hook (v0 -> v1 -> v2)
    const v2Migrated = migrateStatsStore(
      {
        "pop.mainstream.dance-pop": {
          gamesPlayed: 2,
          wins: 2,
          currentStreak: 2,
          maxStreak: 2,
          guessDistribution: [2, 0, 0, 0, 0, 0],
        },
      },
      {
        targetVersion: 2,
        migrators: {
          1: (data) => {
            const genres = (data.genres ?? {}) as Record<string, unknown>;
            return {
              ...data,
              genres: {
                ...genres,
                "rock.mainstream.classic-rock": createDefaultGenreStats(),
              },
            };
          },
        },
      },
    );

    expect(v2Migrated.version).toBe(2);
    expect(v2Migrated.genres["pop.mainstream.dance-pop"]?.wins).toBe(2);
    expect(v2Migrated.genres["rock.mainstream.classic-rock"]?.gamesPlayed).toBe(0);
  });

  it("migrates legacy daily progress keys and infers missing attempt indices", () => {
    const storage = new MemoryStorage();
    const genreId = "latin.urbano.reggaeton";
    const date = "2026-10-30";

    storage.setItem(
      `riffld:v0:daily:${genreId}:${date}`,
      JSON.stringify({
        guesses: [
          { trackId: "skip", feedback: "skipped" },
          { trackId: "wrong-song", feedback: "artist" },
        ],
      }),
    );

    const migrated = loadDailyProgress(genreId, date, storage);
    expect(migrated).toEqual({
      version: 1,
      genreId,
      date,
      status: "playing",
      attempt: 2,
      guesses: [
        { trackId: "skip", feedback: "skipped", attempt: 0 },
        { trackId: "wrong-song", feedback: "artist", attempt: 1 },
      ],
    });
    expect(storage.getItem(`riffld:v0:daily:${genreId}:${date}`)).toBeNull();
    expect(
      storage.getItem(getDailyProgressStorageKey(genreId, date)),
    ).not.toBeNull();

    // Rejects daily progress whose genreId or date does not match
    expect(
      migrateDailyProgress(
        { genreId: "other.genre", date, guesses: [] },
        genreId,
        date,
      ),
    ).toBeNull();
  });
});
