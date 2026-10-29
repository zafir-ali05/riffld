import { describe, expect, it } from "vitest";
import {
  FEEDBACK_SQUARES,
  MAX_ATTEMPTS,
  MAX_PREVIEW_DURATION_MS,
  SNIPPET_DURATIONS_MS,
  type GenreNode,
  type GuessFeedback,
  type LocalGenreStats,
  type RoundStatus,
  type Track,
} from "@/types/catalog";

describe("shared catalog constants and types", () => {
  it("defines 6 strictly increasing snippet durations matching the Songdle progression", () => {
    expect(SNIPPET_DURATIONS_MS).toEqual([1000, 2000, 4000, 7000, 11000, 16000]);
    expect(SNIPPET_DURATIONS_MS).toHaveLength(MAX_ATTEMPTS);

    for (let i = 1; i < SNIPPET_DURATIONS_MS.length; i++) {
      const current = SNIPPET_DURATIONS_MS[i];
      const previous = SNIPPET_DURATIONS_MS[i - 1];
      expect(current).toBeDefined();
      expect(previous).toBeDefined();
      expect(current!).toBeGreaterThan(previous!);
    }

    const maxSnippet = SNIPPET_DURATIONS_MS[SNIPPET_DURATIONS_MS.length - 1];
    expect(maxSnippet).toBeLessThanOrEqual(MAX_PREVIEW_DURATION_MS);
  });

  it("maps every guess feedback state and unused slot to its share-grid square", () => {
    const feedbackStates: GuessFeedback[] = ["correct", "artist", "wrong", "skipped"];
    expect(FEEDBACK_SQUARES.correct).toBe("🟩");
    expect(FEEDBACK_SQUARES.artist).toBe("🟨");
    expect(FEEDBACK_SQUARES.wrong).toBe("🟥");
    expect(FEEDBACK_SQUARES.skipped).toBe("⬜");
    expect(FEEDBACK_SQUARES.unused).toBe("⬛");

    for (const state of feedbackStates) {
      expect(FEEDBACK_SQUARES[state]).toBeTruthy();
    }
  });

  it("supports domain interfaces for genres, tracks, stats, and round status", () => {
    const genre: GenreNode = {
      id: "latin.urbano.reggaeton",
      name: "Reggaeton",
      aliases: ["perreo"],
      children: [],
    };
    const track: Track = {
      id: "sample-track",
      title: "Sample",
      artist: "Sample Artist",
      genreId: genre.id,
      provider: "deezer",
      providerTrackId: "123456",
      snippetOffsetMs: 0,
    };
    const stats: LocalGenreStats = {
      gamesPlayed: 1,
      wins: 1,
      currentStreak: 1,
      maxStreak: 1,
      guessDistribution: [1, 0, 0, 0, 0, 0],
      lastPlayedDate: "2026-10-29",
    };
    const status: RoundStatus = "playing";

    expect(track.genreId).toBe(genre.id);
    expect(stats.guessDistribution).toHaveLength(6);
    expect(status).toBe("playing");
  });
});
