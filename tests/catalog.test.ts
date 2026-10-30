import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAllGenres,
  getDescendantGenreIds,
  getGenreById,
  getTrackById,
  getTracksForChannel,
  isDailyEligibleChannel,
  isValidGenreId,
  loadGenresFromDisk,
  loadTracksFromDisk,
  validateGenreNode,
  validateTrack,
  validateTrackList,
  type CatalogData,
} from "@/lib/catalog";
import {
  FEEDBACK_SQUARES,
  MAX_ATTEMPTS,
  MAX_PREVIEW_DURATION_MS,
  MIN_DAILY_ELIGIBLE_TRACKS,
  SNIPPET_DURATIONS_MS,
  type GenreNode,
  type GuessFeedback,
  type LocalGenreStats,
  type RoundStatus,
  type Track,
} from "@/types/catalog";

const fixtureGenres: GenreNode[] = [
  {
    id: "latin",
    name: "Latin",
    emoji: "🌎",
    children: [
      {
        id: "latin.urbano",
        name: "Urbano",
        children: [
          {
            id: "latin.urbano.reggaeton",
            name: "Reggaeton",
            aliases: ["perreo", "dembow"],
          },
          {
            id: "latin.urbano.latin-trap",
            name: "Latin Trap",
            aliases: ["trap latino"],
          },
        ],
      },
      {
        id: "latin.regional-mexican",
        name: "Regional Mexican",
        children: [
          {
            id: "latin.regional-mexican.corridos-tumbados",
            name: "Corridos Tumbados",
          },
        ],
      },
    ],
  },
];

function createSampleTracks(count: number, genreId: string, prefix = "track"): Track[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `${prefix}-${idx + 1}`,
    title: `Song ${idx + 1}`,
    artist: `Artist ${idx + 1}`,
    genreId,
    provider: "deezer",
    providerTrackId: `${prefix}-provider-${idx + 1}`,
  }));
}

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
    expect(MIN_DAILY_ELIGIBLE_TRACKS).toBe(30);
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

describe("catalog validation at the boundary", () => {
  it("validates root.sub.micro genre ID formatting", () => {
    expect(isValidGenreId("latin")).toBe(true);
    expect(isValidGenreId("latin.urbano")).toBe(true);
    expect(isValidGenreId("latin.urbano.reggaeton")).toBe(true);
    expect(isValidGenreId("hip-hop.90s-east-coast.boom-bap")).toBe(true);

    expect(isValidGenreId("")).toBe(false);
    expect(isValidGenreId("Latin")).toBe(false);
    expect(isValidGenreId("latin.urbano.reggaeton.extra")).toBe(false);
    expect(isValidGenreId("latin..urbano")).toBe(false);
    expect(isValidGenreId("latin_urbano")).toBe(false);
  });

  it("validates genre trees and rejects malformed nodes or mismatched child prefixes", () => {
    const valid = validateGenreNode(fixtureGenres[0]);
    expect(valid.id).toBe("latin");

    expect(() =>
      validateGenreNode({
        id: "latin",
        name: "Latin",
        children: [{ id: "rock.grunge", name: "Grunge" }],
      }),
    ).toThrow(/child genre id/i);

    expect(() => validateGenreNode({ id: "INVALID", name: "Bad" })).toThrow(/invalid genre id/i);
  });

  it("validates tracks and rejects hardcoded URLs or excessive snippet offsets", () => {
    const valid = validateTrack({
      id: "bad-bunny-safaera",
      title: "Safaera",
      artist: "Bad Bunny",
      genreId: "latin.urbano.reggaeton",
      provider: "deezer",
      providerTrackId: "908604612",
      snippetOffsetMs: 14000,
    });
    expect(valid.id).toBe("bad-bunny-safaera");

    expect(() =>
      validateTrack({
        id: "bad-url",
        title: "Safaera",
        artist: "Bad Bunny",
        genreId: "latin.urbano.reggaeton",
        provider: "deezer",
        providerTrackId: "https://cdns-preview.dzcdn.net/stream/123.mp3",
      }),
    ).toThrow(/url/i);

    expect(() =>
      validateTrack({
        id: "bad-offset",
        title: "Safaera",
        artist: "Bad Bunny",
        genreId: "latin.urbano.reggaeton",
        provider: "deezer",
        providerTrackId: "908604612",
        snippetOffsetMs: 15000,
      }),
    ).toThrow(/snippetOffsetMs/i);

    expect(validateTrackList([valid])).toHaveLength(1);
  });
});

describe("genre tree traversal, channel rollup, and lookup helpers", () => {
  const reggaetonTracks = createSampleTracks(20, "latin.urbano.reggaeton", "reg");
  const trapTracks = createSampleTracks(12, "latin.urbano.latin-trap", "trap");
  const corridosTracks = createSampleTracks(
    5,
    "latin.regional-mexican.corridos-tumbados",
    "corr",
  );

  // Include a duplicate track entry to verify rollup deduplication
  const duplicateTrack: Track = {
    ...reggaetonTracks[0]!,
    genreId: "latin.urbano.latin-trap",
  };

  const catalog: CatalogData = {
    genres: fixtureGenres,
    tracks: [...reggaetonTracks, ...trapTracks, ...corridosTracks, duplicateTrack],
  };

  it("finds root, subgenre, and micro-genre nodes by ID and returns undefined for unknown IDs", () => {
    expect(getAllGenres(catalog)).toHaveLength(1);
    expect(getGenreById("latin", catalog)?.name).toBe("Latin");
    expect(getGenreById("latin.urbano", catalog)?.name).toBe("Urbano");
    expect(getGenreById("latin.urbano.reggaeton", catalog)?.name).toBe("Reggaeton");
    expect(getGenreById("unknown.genre", catalog)).toBeUndefined();
  });

  it("collects all descendant genre IDs for a root or subgenre node", () => {
    expect(getDescendantGenreIds("latin.urbano", catalog)).toEqual([
      "latin.urbano",
      "latin.urbano.reggaeton",
      "latin.urbano.latin-trap",
    ]);
    expect(getDescendantGenreIds("unknown", catalog)).toEqual([]);
  });

  it("aggregates descendant micro-genre tracks without duplicates when querying a subgenre or root genre", () => {
    const reggaetonPool = getTracksForChannel("latin.urbano.reggaeton", catalog);
    expect(reggaetonPool).toHaveLength(20);

    const urbanoPool = getTracksForChannel("latin.urbano", catalog);
    expect(urbanoPool).toHaveLength(32);

    const latinPool = getTracksForChannel("latin", catalog);
    expect(latinPool).toHaveLength(37);

    expect(getTracksForChannel("nonexistent.genre", catalog)).toEqual([]);
  });

  it("looks up individual tracks by ID and returns undefined for unknown track IDs", () => {
    expect(getTrackById("reg-1", catalog)?.title).toBe("Song 1");
    expect(getTrackById("trap-12", catalog)?.genreId).toBe("latin.urbano.latin-trap");
    expect(getTrackById("missing-track", catalog)).toBeUndefined();
  });

  it("checks the 30-track minimum for Daily Mode eligibility across rolled-up channels", () => {
    expect(isDailyEligibleChannel("latin.urbano.reggaeton", catalog)).toBe(false);
    expect(isDailyEligibleChannel("latin.urbano", catalog)).toBe(true);
    expect(isDailyEligibleChannel("latin", catalog)).toBe(true);
    expect(isDailyEligibleChannel("unknown.genre", catalog)).toBe(false);
  });

  it("loads and validates genre and track JSON files from disk directories", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "riffld-catalog-test-"));
    const genresDir = path.join(tempDir, "genres");
    const tracksDir = path.join(tempDir, "tracks");
    fs.mkdirSync(genresDir, { recursive: true });
    fs.mkdirSync(tracksDir, { recursive: true });

    try {
      fs.writeFileSync(
        path.join(genresDir, "latin.json"),
        JSON.stringify(fixtureGenres[0]),
        "utf8",
      );
      fs.writeFileSync(
        path.join(tracksDir, "reggaeton.json"),
        JSON.stringify(reggaetonTracks.slice(0, 2)),
        "utf8",
      );

      const loadedGenres = loadGenresFromDisk(genresDir);
      const loadedTracks = loadTracksFromDisk(tracksDir);

      expect(loadedGenres).toHaveLength(1);
      expect(loadedGenres[0]?.id).toBe("latin");
      expect(loadedTracks).toHaveLength(2);
      expect(loadedTracks[0]?.id).toBe("reg-1");

      expect(loadGenresFromDisk(path.join(tempDir, "missing-genres"))).toEqual([]);
      expect(loadTracksFromDisk(path.join(tempDir, "missing-tracks"))).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
