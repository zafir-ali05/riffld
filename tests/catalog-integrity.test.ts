import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getAllGenreNodes,
  getAllGenres,
  getCatalog,
  getDailyEligibleChannels,
  getGenreById,
  getMicroGenreNodes,
  getTracksForChannel,
  isDailyEligibleChannel,
  isValidGenreId,
  loadGenresFromDisk,
  loadTracksFromDisk,
  resetCatalogCache,
  slugifyTrackId,
  validateGenreNode,
  validateTrack,
} from "@/lib/catalog";
import {
  MAX_PREVIEW_DURATION_MS,
  MIN_DAILY_ELIGIBLE_TRACKS,
  SNIPPET_DURATIONS_MS,
  type Track,
} from "@/types/catalog";
import {
  DEFAULT_GENRE_SEED_QUERIES,
  appendTracksToCatalogFile,
  buildSearchQuery,
  mergeAndDeduplicateTracks,
  parseCatalogCliArgs,
  parseDeezerTrackCandidates,
  parseItunesTrackCandidates,
  searchCatalogTracks,
  seedCatalogGenres,
} from "../scripts/catalog";

const EXPECTED_ROOT_GENRE_IDS = [
  "country",
  "electronic",
  "global",
  "hip-hop",
  "latin",
  "pop",
  "rock",
  "soul-jazz",
] as const;

const MAX_SNIPPET_MS = SNIPPET_DURATIONS_MS[SNIPPET_DURATIONS_MS.length - 1] ?? 16000;

describe("launch genre taxonomy integrity (src/data/genres/*.json)", () => {
  resetCatalogCache();
  const genres = loadGenresFromDisk();
  const tracks = loadTracksFromDisk();
  const catalog = getCatalog({ genres, tracks });
  const allNodes = getAllGenreNodes(catalog);
  const microNodes = getMicroGenreNodes(catalog);

  it("loads all 8 launch root genre files in sorted order", () => {
    const rootIds = getAllGenres(catalog).map((node) => node.id);
    expect(rootIds).toEqual([...EXPECTED_ROOT_GENRE_IDS]);
  });

  it("ensures every genre ID matches root.sub.micro formatting and has no duplicates", () => {
    const seenIds = new Set<string>();

    for (const node of allNodes) {
      expect(isValidGenreId(node.id)).toBe(true);
      expect(seenIds.has(node.id)).toBe(false);
      seenIds.add(node.id);
      expect(node.name.trim().length).toBeGreaterThan(0);

      const segments = node.id.split(".");
      expect(segments.length).toBeGreaterThanOrEqual(1);
      expect(segments.length).toBeLessThanOrEqual(3);

      if (node.children !== undefined && node.children.length > 0) {
        for (const child of node.children) {
          expect(child.id.startsWith(`${node.id}.`)).toBe(true);
          expect(child.id.split(".")).toHaveLength(segments.length + 1);
        }
      }
    }
  });

  it("rejects duplicate genre IDs or skipped hierarchy levels during validation", () => {
    expect(() =>
      validateGenreNode({
        id: "pop.mainstream",
        name: "Invalid Root With Dot",
      }),
    ).toThrow(/root genre id/i);

    expect(() =>
      validateGenreNode({
        id: "pop",
        name: "Pop",
        children: [
          {
            id: "pop.mainstream.dance-pop",
            name: "Skipped Subgenre Level",
          },
        ],
      }),
    ).toThrow(/one level deeper/i);
  });

  it("includes curated seed queries for every leaf micro-genre in the taxonomy", () => {
    expect(microNodes.length).toBeGreaterThanOrEqual(60);

    for (const micro of microNodes) {
      expect(micro.id.split(".")).toHaveLength(3);
      const queries = DEFAULT_GENRE_SEED_QUERIES[micro.id];
      expect(queries, `Missing seed queries for ${micro.id}`).toBeDefined();
      expect(queries!.length).toBeGreaterThan(0);
    }
  });
});

describe("static track catalog integrity (src/data/tracks/*.json)", () => {
  resetCatalogCache();
  const genres = loadGenresFromDisk();
  const tracks = loadTracksFromDisk();
  const catalog = getCatalog({ genres, tracks });
  const allNodes = getAllGenreNodes(catalog);

  it("verifies every track references a valid genreId, non-empty providerTrackId, and no hardcoded URLs", () => {
    for (const track of tracks) {
      const validated = validateTrack(track);
      expect(validated.id.length).toBeGreaterThan(0);
      expect(validated.providerTrackId.length).toBeGreaterThan(0);
      expect(/^https?:\/\//i.test(validated.providerTrackId)).toBe(false);
      expect(getGenreById(validated.genreId, catalog)).toBeDefined();
    }
  });

  it("verifies snippetOffsetMs + 16000 <= 30000 for every track", () => {
    for (const track of tracks) {
      const offset = track.snippetOffsetMs ?? 0;
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset + MAX_SNIPPET_MS).toBeLessThanOrEqual(MAX_PREVIEW_DURATION_MS);
    }
  });

  it("verifies no duplicate id or providerTrackId exists within any genre channel", () => {
    const tracksByChannel = new Map<string, Track[]>();
    for (const track of tracks) {
      const bucket = tracksByChannel.get(track.genreId) ?? [];
      bucket.push(track);
      tracksByChannel.set(track.genreId, bucket);
    }

    for (const [genreId, channelTracks] of tracksByChannel.entries()) {
      const seenIds = new Set<string>();
      const seenProviderIds = new Set<string>();

      for (const track of channelTracks) {
        expect(
          seenIds.has(track.id),
          `Duplicate track id "${track.id}" in channel "${genreId}"`,
        ).toBe(false);
        expect(
          seenProviderIds.has(track.providerTrackId),
          `Duplicate providerTrackId "${track.providerTrackId}" in channel "${genreId}"`,
        ).toBe(false);
        seenIds.add(track.id);
        seenProviderIds.add(track.providerTrackId);
      }
    }

    for (const node of allNodes) {
      const rolledUp = getTracksForChannel(node.id, catalog);
      const seenIds = new Set<string>();
      const seenProviderKeys = new Set<string>();

      for (const track of rolledUp) {
        expect(seenIds.has(track.id)).toBe(false);
        expect(seenProviderKeys.has(`${track.provider}:${track.providerTrackId}`)).toBe(false);
        seenIds.add(track.id);
        seenProviderKeys.add(`${track.provider}:${track.providerTrackId}`);
      }
    }
  });

  it("verifies Daily-eligible channels meet the 30-track minimum across all launch genres", () => {
    expect(tracks.length).toBeGreaterThanOrEqual(MIN_DAILY_ELIGIBLE_TRACKS * EXPECTED_ROOT_GENRE_IDS.length);

    const eligibleChannels = getDailyEligibleChannels(catalog);
    expect(eligibleChannels.length).toBe(allNodes.length);

    for (const node of allNodes) {
      const pool = getTracksForChannel(node.id, catalog);
      expect(
        pool.length,
        `Channel "${node.id}" has ${pool.length} tracks; expected at least ${MIN_DAILY_ELIGIBLE_TRACKS}`,
      ).toBeGreaterThanOrEqual(MIN_DAILY_ELIGIBLE_TRACKS);
      expect(isDailyEligibleChannel(node.id, catalog)).toBe(true);
    }
  });
});

describe("catalog seeding CLI (scripts/catalog.ts)", () => {
  it("generates normalized track slug IDs stripping diacritics and punctuation", () => {
    expect(slugifyTrackId("Bad Bunny", "Safaera")).toBe("bad-bunny-safaera");
    expect(slugifyTrackId("Beyoncé", "Déjà Vu (feat. Jay-Z)")).toBe(
      "beyonce-deja-vu-feat-jay-z",
    );
    expect(slugifyTrackId("Tyler, The Creator", "EARFQUAKE")).toBe(
      "tyler-the-creator-earfquake",
    );
    expect(() => slugifyTrackId("   ", "!!!")).toThrow(/empty/i);
  });

  it("parses CLI arguments and validates required values and bounds", () => {
    const parsed = parseCatalogCliArgs([
      "--genre",
      "latin.urbano.reggaeton",
      "--artist",
      "Bad Bunny",
      "--track",
      "Safaera",
      "--provider",
      "itunes",
      "--limit",
      "15",
      "--file",
      "latin.json",
      "--dry-run",
    ]);

    expect(parsed).toEqual({
      genreId: "latin.urbano.reggaeton",
      query: undefined,
      artist: "Bad Bunny",
      track: "Safaera",
      playlistId: undefined,
      provider: "itunes",
      limit: 15,
      fileName: "latin.json",
      dryRun: true,
      listGenres: false,
      seed: false,
      help: false,
    });

    expect(buildSearchQuery({ artist: "Bad Bunny", track: "Safaera" })).toBe(
      "Bad Bunny Safaera",
    );
    expect(() => buildSearchQuery({})).toThrow(/at least one search filter/i);
    expect(() => parseCatalogCliArgs(["--genre"])).toThrow(/missing value/i);
    expect(() => parseCatalogCliArgs(["--provider", "spotify"])).toThrow(
      /invalid --provider/i,
    );
    expect(() => parseCatalogCliArgs(["--limit", "0"])).toThrow(/invalid --limit/i);
    expect(() => parseCatalogCliArgs(["--unknown"])).toThrow(/unknown cli argument/i);
  });

  it("parses Deezer and iTunes responses, skips items without previews, and never stores preview URLs", () => {
    const deezerPayload = {
      data: [
        {
          id: 908604612,
          title: "Safaera (Explicit)",
          title_short: "Safaera",
          preview: "https://cdns-preview.dzcdn.net/stream/c-safaera.mp3",
          artist: { name: "Bad Bunny" },
        },
        {
          id: 111111,
          title: "No Preview Song",
          preview: "",
          artist: { name: "Bad Bunny" },
        },
      ],
    };

    const deezerTracks = parseDeezerTrackCandidates(
      deezerPayload,
      "latin.urbano.reggaeton",
    );
    expect(deezerTracks).toEqual([
      {
        id: "bad-bunny-safaera",
        title: "Safaera",
        artist: "Bad Bunny",
        genreId: "latin.urbano.reggaeton",
        provider: "deezer",
        providerTrackId: "908604612",
      },
    ]);
    expect("preview" in deezerTracks[0]!).toBe(false);

    const itunesPayload = {
      results: [
        {
          trackId: 1440857781,
          trackName: "Dreams",
          artistName: "Fleetwood Mac",
          previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/dreams.m4a",
        },
        {
          trackId: 222222,
          trackName: "Missing Preview",
          artistName: "Fleetwood Mac",
        },
      ],
    };

    const itunesTracks = parseItunesTrackCandidates(
      itunesPayload,
      "rock.mainstream.classic-rock",
    );
    expect(itunesTracks).toEqual([
      {
        id: "fleetwood-mac-dreams",
        title: "Dreams",
        artist: "Fleetwood Mac",
        genreId: "rock.mainstream.classic-rock",
        provider: "itunes",
        providerTrackId: "1440857781",
      },
    ]);
  });

  it("searches Deezer and iTunes via mocked fetch and deduplicates when appending to disk", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 908604612,
              title_short: "Safaera",
              preview: "https://cdns-preview.dzcdn.net/stream/c-safaera.mp3",
              artist: { name: "Bad Bunny" },
            },
            {
              id: 908604612,
              title_short: "Safaera",
              preview: "https://cdns-preview.dzcdn.net/stream/c-safaera.mp3",
              artist: { name: "Bad Bunny" },
            },
            {
              id: 3135556,
              title_short: "Gasolina",
              preview: "https://cdns-preview.dzcdn.net/stream/c-gasolina.mp3",
              artist: { name: "Daddy Yankee" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const results = await searchCatalogTracks({
      genreId: "latin.urbano.reggaeton",
      query: "reggaeton",
      provider: "deezer",
      limit: 10,
      fetchImpl: mockFetch,
    });

    expect(results).toHaveLength(3);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "riffld-cli-test-"));
    try {
      const firstWrite = appendTracksToCatalogFile(
        "latin.urbano.reggaeton",
        results,
        { tracksDir: tempDir },
      );

      expect(firstWrite.added).toHaveLength(2);
      expect(firstWrite.skippedDuplicates).toBe(1);
      expect(firstWrite.totalInFile).toBe(2);

      const secondWrite = appendTracksToCatalogFile(
        "latin.urbano.reggaeton",
        results,
        { tracksDir: tempDir },
      );

      expect(secondWrite.added).toHaveLength(0);
      expect(secondWrite.skippedDuplicates).toBe(3);
      expect(secondWrite.totalInFile).toBe(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("seeds micro-genres with primary/fallback provider resolution using mocked fetch", async () => {
    let callCounter = 0;
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("api.deezer.com")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      callCounter++;
      return new Response(
        JSON.stringify({
          results: [
            {
              trackId: 5000 + callCounter,
              trackName: `Seed Song ${callCounter}`,
              artistName: `Seed Artist ${callCounter}`,
              previewUrl: `https://audio-ssl.itunes.apple.com/preview-${callCounter}.m4a`,
            },
          ],
        }),
        { status: 200 },
      );
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "riffld-seed-test-"));
    try {
      const summary = await seedCatalogGenres({
        genreFilter: "latin.regional-mexican.corridos-tumbados",
        targetPerMicroGenre: 3,
        perQueryLimit: 1,
        fetchImpl: mockFetch,
        tracksDir: tempDir,
      });

      expect(summary.genresSeeded).toBe(1);
      expect(summary.totalAdded).toBeGreaterThanOrEqual(3);

      const writtenTracks = loadTracksFromDisk(tempDir);
      expect(writtenTracks.length).toBe(summary.totalAdded);
      expect(writtenTracks[0]?.genreId).toBe(
        "latin.regional-mexican.corridos-tumbados",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("deduplicates by both track id and providerTrackId in mergeAndDeduplicateTracks", () => {
    const existing: Track[] = [
      {
        id: "bad-bunny-safaera",
        title: "Safaera",
        artist: "Bad Bunny",
        genreId: "latin.urbano.reggaeton",
        provider: "deezer",
        providerTrackId: "908604612",
      },
    ];

    const incoming: Track[] = [
      {
        id: "bad-bunny-safaera",
        title: "Safaera",
        artist: "Bad Bunny",
        genreId: "latin.urbano.reggaeton",
        provider: "deezer",
        providerTrackId: "999999999",
      },
      {
        id: "bad-bunny-safaera-remix",
        title: "Safaera Remix",
        artist: "Bad Bunny",
        genreId: "latin.urbano.reggaeton",
        provider: "deezer",
        providerTrackId: "908604612",
      },
      {
        id: "daddy-yankee-gasolina",
        title: "Gasolina",
        artist: "Daddy Yankee",
        genreId: "latin.urbano.reggaeton",
        provider: "deezer",
        providerTrackId: "3135556",
      },
    ];

    const result = mergeAndDeduplicateTracks(existing, incoming);
    expect(result.added).toHaveLength(1);
    expect(result.skippedDuplicates).toBe(2);
    expect(result.merged).toHaveLength(2);
  });
});
