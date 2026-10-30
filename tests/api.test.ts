import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAudioPreview } from "@/app/api/audio/[trackId]/route";
import {
  GET as getDailyPuzzle,
  POST as postDailyGuess,
} from "@/app/api/daily/[genre]/route";
import { resetCatalogCache, type CatalogData } from "@/lib/catalog";
import {
  createDailyAudioToken,
  isDailyAudioToken,
  selectDailyTrack,
} from "@/lib/server/daily";
import { clearPreviewCache } from "@/lib/server/providers";
import type { GenreNode, Track } from "@/types/catalog";

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
            emoji: "🇵🇷",
          },
          {
            id: "latin.urbano.latin-trap",
            name: "Latin Trap",
          },
        ],
      },
    ],
  },
];

const reggaetonTracks: Track[] = Array.from({ length: 32 }, (_, idx) => {
  const num = idx + 1;
  return {
    id: `reggaeton-slug-${num}`,
    title: `Secret Reggaeton Title ${num}`,
    artist: `Urbano Star ${Math.ceil(num / 2)}`,
    genreId: "latin.urbano.reggaeton",
    provider: "deezer",
    providerTrackId: `99000${num}`,
    ...(num === 1 ? { snippetOffsetMs: 2500 } : {}),
  };
});

// Fewer than 30 tracks so latin.urbano.latin-trap is not Daily-eligible on its own
const latinTrapTracks: Track[] = Array.from({ length: 10 }, (_, idx) => {
  const num = idx + 1;
  return {
    id: `latin-trap-slug-${num}`,
    title: `Trap Song ${num}`,
    artist: `Trap Artist ${num}`,
    genreId: "latin.urbano.latin-trap",
    provider: "itunes",
    providerTrackId: `88000${num}`,
  };
});

const fixtureCatalog: CatalogData = {
  genres: fixtureGenres,
  tracks: [...reggaetonTracks, ...latinTrapTracks],
};

describe("Phase 4 API routes (/api/audio/[trackId] and /api/daily/[genre])", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T15:00:00.000Z"));
    vi.stubEnv("DAILY_SEED_SALT", "test-api-route-salt");
    clearPreviewCache();
    resetCatalogCache(fixtureCatalog);
  });

  afterEach(() => {
    resetCatalogCache();
    clearPreviewCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("GET /api/audio/[trackId]", () => {
    it("returns 404 for unknown trackId, empty param, malformed URI component, or invalid daily token", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const unknownRes = await getAudioPreview(
        new Request("http://localhost:3000/api/audio/nonexistent-track"),
        { params: Promise.resolve({ trackId: "nonexistent-track" }) },
      );
      expect(unknownRes.status).toBe(404);

      const emptyRes = await getAudioPreview(
        new Request("http://localhost:3000/api/audio/"),
        { params: Promise.resolve({ trackId: "   " }) },
      );
      expect(emptyRes.status).toBe(404);

      const badUriRes = await getAudioPreview(
        new Request("http://localhost:3000/api/audio/%E0%A4%A"),
        { params: Promise.resolve({ trackId: "%E0%A4%A" }) },
      );
      expect(badUriRes.status).toBe(404);

      const tamperedTokenRes = await getAudioPreview(
        new Request("http://localhost:3000/api/audio/dt_tampered_token_value"),
        { params: Promise.resolve({ trackId: "dt_tampered_token_value" }) },
      );
      expect(tamperedTokenRes.status).toBe(404);

      // Token for an ineligible channel (< 30 tracks) must also return 404
      const ineligibleToken = createDailyAudioToken(
        "latin.urbano.latin-trap",
        "2026-10-30",
      );
      const ineligibleTokenRes = await getAudioPreview(
        new Request(`http://localhost:3000/api/audio/${ineligibleToken}`),
        { params: Promise.resolve({ trackId: ineligibleToken }) },
      );
      expect(ineligibleTokenRes.status).toBe(404);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("resolves a fresh 30-second preview URL for a catalog trackId without leaking title or artist", async () => {
      const target = reggaetonTracks[0]!;
      const cdnPreviewUrl = "https://cdns-preview.dzcdn.net/stream/c-opaque-hash.mp3";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: Number(target.providerTrackId),
            title: target.title,
            artist: { name: target.artist },
            preview: cdnPreviewUrl,
          }),
          { status: 200 },
        ),
      );

      const response = await getAudioPreview(
        new Request(`http://localhost:3000/api/audio/${target.id}`),
        { params: Promise.resolve({ trackId: target.id }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const rawText = await response.text();
      expect(rawText).not.toContain(target.title);
      expect(rawText).not.toContain(target.artist);
      expect(rawText).not.toContain(target.id);
      expect(rawText).not.toContain(target.providerTrackId);

      const json: unknown = JSON.parse(rawText);
      expect(json).toEqual({
        previewUrl: cdnPreviewUrl,
        provider: "deezer",
        snippetOffsetMs: 2500,
      });
    });

    it("resolves a daily opaque audio token without leaking song title, artist, or raw daily trackId in headers or body", async () => {
      const expectedDailyTrack = selectDailyTrack(
        "latin.urbano.reggaeton",
        "2026-10-30",
      );
      const dailyToken = createDailyAudioToken(
        "latin.urbano.reggaeton",
        "2026-10-30",
      );
      const cdnPreviewUrl = "https://cdns-preview.dzcdn.net/stream/c-daily-hash.mp3";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: Number(expectedDailyTrack.providerTrackId),
            title: expectedDailyTrack.title,
            artist: { name: expectedDailyTrack.artist },
            preview: cdnPreviewUrl,
          }),
          { status: 200 },
        ),
      );

      const response = await getAudioPreview(
        new Request(`http://localhost:3000/api/audio/${dailyToken}`),
        { params: Promise.resolve({ trackId: dailyToken }) },
      );

      expect(response.status).toBe(200);

      for (const [headerName, headerValue] of response.headers.entries()) {
        const combined = `${headerName}: ${headerValue}`;
        expect(combined).not.toContain(expectedDailyTrack.id);
        expect(combined).not.toContain(expectedDailyTrack.title);
        expect(combined).not.toContain(expectedDailyTrack.artist);
        expect(combined).not.toContain(expectedDailyTrack.providerTrackId);
      }

      const rawBody = await response.text();
      expect(rawBody).not.toContain(expectedDailyTrack.id);
      expect(rawBody).not.toContain(expectedDailyTrack.title);
      expect(rawBody).not.toContain(expectedDailyTrack.artist);
      expect(rawBody).not.toContain(expectedDailyTrack.providerTrackId);

      const parsed: unknown = JSON.parse(rawBody);
      expect(parsed).toEqual({
        previewUrl: cdnPreviewUrl,
        provider: "deezer",
        snippetOffsetMs: expectedDailyTrack.snippetOffsetMs ?? 0,
      });
    });

    it("returns 502 when both primary and fallback audio preview providers fail", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Upstream Error", { status: 503 }),
      );

      const response = await getAudioPreview(
        new Request("http://localhost:3000/api/audio/reggaeton-slug-1"),
        { params: Promise.resolve({ trackId: "reggaeton-slug-1" }) },
      );

      expect(response.status).toBe(502);
    });
  });

  describe("GET /api/daily/[genre]", () => {
    it("returns 404 for unknown genres, invalid genre IDs, and channels with fewer than 30 tracks", async () => {
      const unknownRes = await getDailyPuzzle(
        new Request("http://localhost:3000/api/daily/unknown.genre"),
        { params: Promise.resolve({ genre: "unknown.genre" }) },
      );
      expect(unknownRes.status).toBe(404);

      const invalidFormatRes = await getDailyPuzzle(
        new Request("http://localhost:3000/api/daily/INVALID_ID"),
        { params: Promise.resolve({ genre: "INVALID_ID" }) },
      );
      expect(invalidFormatRes.status).toBe(404);

      const ineligibleRes = await getDailyPuzzle(
        new Request("http://localhost:3000/api/daily/latin.urbano.latin-trap"),
        { params: Promise.resolve({ genre: "latin.urbano.latin-trap" }) },
      );
      expect(ineligibleRes.status).toBe(404);
    });

    it("returns UTC date, puzzle number, opaque audio token, and sanitized autocomplete tracks without revealing the winning track", async () => {
      const winningTrack = selectDailyTrack(
        "latin.urbano.reggaeton",
        "2026-10-30",
      );

      const response = await getDailyPuzzle(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton"),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const body = (await response.json()) as Record<string, unknown>;
      expect(body.genreId).toBe("latin.urbano.reggaeton");
      expect(body.date).toBe("2026-10-30");
      expect(typeof body.puzzleNumber).toBe("number");
      expect(typeof body.audioToken).toBe("string");
      expect(isDailyAudioToken(String(body.audioToken))).toBe(true);

      // Token must not leak winning track details
      expect(String(body.audioToken)).not.toContain(winningTrack.id);
      expect(String(body.audioToken)).not.toContain(winningTrack.title);
      expect(String(body.audioToken)).not.toContain(winningTrack.artist);
      expect(String(body.audioToken)).not.toContain(winningTrack.providerTrackId);

      // Response top-level keys must not contain any answer field
      expect(Object.keys(body).sort()).toEqual([
        "audioToken",
        "date",
        "genreId",
        "puzzleNumber",
        "tracks",
      ]);

      const tracks = body.tracks as Array<Record<string, unknown>>;
      expect(Array.isArray(tracks)).toBe(true);
      expect(tracks).toHaveLength(32);

      // Every track in the autocomplete pool has strictly { id, title, artist }
      for (const item of tracks) {
        expect(Object.keys(item).sort()).toEqual(["artist", "id", "title"]);
        expect("providerTrackId" in item).toBe(false);
        expect("provider" in item).toBe(false);
      }

      // Raw payload never exposes providerTrackId of any track, including the winner
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(winningTrack.providerTrackId);
    });
  });

  describe("POST /api/daily/[genre]", () => {
    it("returns 404 for unknown or ineligible genres before processing guesses", async () => {
      const unknownRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/unknown.genre", {
          method: "POST",
          body: JSON.stringify({ trackId: "skip", attempt: 0 }),
        }),
        { params: Promise.resolve({ genre: "unknown.genre" }) },
      );
      expect(unknownRes.status).toBe(404);

      const ineligibleRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.latin-trap", {
          method: "POST",
          body: JSON.stringify({ trackId: "skip", attempt: 0 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.latin-trap" }) },
      );
      expect(ineligibleRes.status).toBe(404);
    });

    it("returns 400 on malformed JSON, out-of-range attempt index, or unknown guessed trackId", async () => {
      const invalidJsonRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: "{not-json",
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      expect(invalidJsonRes.status).toBe(400);

      for (const badAttempt of [-1, 6, 1.5, "0", null, undefined]) {
        const res = await postDailyGuess(
          new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
            method: "POST",
            body: JSON.stringify({ trackId: "skip", attempt: badAttempt }),
          }),
          { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
        );
        expect(res.status).toBe(400);
      }

      const unknownTrackRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({ trackId: "missing-track-id", attempt: 0 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      expect(unknownTrackRes.status).toBe(400);
    });

    it("classifies wrong, artist-match, and skipped guesses on attempts 0..4 without leaking the answer", async () => {
      const winningTrack = selectDailyTrack(
        "latin.urbano.reggaeton",
        "2026-10-30",
      );
      const wrongTrack = reggaetonTracks.find(
        (t) => t.id !== winningTrack.id && t.artist !== winningTrack.artist,
      )!;
      const sameArtistTrack = reggaetonTracks.find(
        (t) => t.id !== winningTrack.id && t.artist === winningTrack.artist,
      )!;

      // 1. Wrong guess on attempt 0
      const wrongRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({ trackId: wrongTrack.id, attempt: 0 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      expect(wrongRes.status).toBe(200);
      const wrongText = await wrongRes.text();
      expect(wrongText).not.toContain(winningTrack.id);
      expect(wrongText).not.toContain(winningTrack.title);
      expect(wrongText).not.toContain(winningTrack.artist);
      expect(wrongText).not.toContain(winningTrack.providerTrackId);
      expect(JSON.parse(wrongText)).toEqual({
        feedback: "wrong",
        attempt: 0,
        status: "playing",
      });

      // 2. Skip on attempt 1
      const skipRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({ trackId: "skip", attempt: 1 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      expect(skipRes.status).toBe(200);
      const skipText = await skipRes.text();
      expect(skipText).not.toContain(winningTrack.id);
      expect(skipText).not.toContain(winningTrack.title);
      expect(JSON.parse(skipText)).toEqual({
        feedback: "skipped",
        attempt: 1,
        status: "playing",
      });

      // 3. Same-artist wrong-song guess on attempt 2
      const artistRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({
            trackId: sameArtistTrack.id,
            attempt: 2,
          }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      expect(artistRes.status).toBe(200);
      const artistText = await artistRes.text();
      expect(artistText).not.toContain(winningTrack.id);
      expect(artistText).not.toContain(winningTrack.title);
      expect(artistText).not.toContain(winningTrack.providerTrackId);
      expect(JSON.parse(artistText)).toEqual({
        feedback: "artist",
        attempt: 2,
        status: "playing",
      });
    });

    it("reveals the full answer Track when the guess is correct", async () => {
      const winningTrack = selectDailyTrack(
        "latin.urbano.reggaeton",
        "2026-10-30",
      );

      const response = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({ trackId: winningTrack.id, attempt: 2 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );

      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(body).toEqual({
        feedback: "correct",
        attempt: 2,
        status: "won",
        answer: winningTrack,
      });
    });

    it("reveals the full answer Track with status 'lost' when the player fails on attempt 6 (index 5)", async () => {
      const winningTrack = selectDailyTrack(
        "latin.urbano.reggaeton",
        "2026-10-30",
      );
      const wrongTrack = reggaetonTracks.find(
        (t) => t.id !== winningTrack.id && t.artist !== winningTrack.artist,
      )!;

      // Attempt index 4 (attempt 5) still does not reveal the answer
      const attemptFiveRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({ trackId: wrongTrack.id, attempt: 4 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      const attemptFiveBody = (await attemptFiveRes.json()) as Record<string, unknown>;
      expect(attemptFiveBody.status).toBe("playing");
      expect("answer" in attemptFiveBody).toBe(false);

      // Attempt index 5 (attempt 6) reveals the full answer Track
      const attemptSixRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({ trackId: wrongTrack.id, attempt: 5 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      expect(attemptSixRes.status).toBe(200);
      const attemptSixBody: unknown = await attemptSixRes.json();
      expect(attemptSixBody).toEqual({
        feedback: "wrong",
        attempt: 5,
        status: "lost",
        answer: winningTrack,
      });

      // Skipping on attempt index 5 also ends the round as lost and reveals the answer
      const skipSixRes = await postDailyGuess(
        new Request("http://localhost:3000/api/daily/latin.urbano.reggaeton", {
          method: "POST",
          body: JSON.stringify({ trackId: "skip", attempt: 5 }),
        }),
        { params: Promise.resolve({ genre: "latin.urbano.reggaeton" }) },
      );
      expect(skipSixRes.status).toBe(200);
      expect(await skipSixRes.json()).toEqual({
        feedback: "skipped",
        attempt: 5,
        status: "lost",
        answer: winningTrack,
      });
    });
  });
});
