import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_CACHE_TTL_MS,
  PROVIDER_FETCH_TIMEOUT_MS,
  clearPreviewCache,
  resolveDeezerPreview,
  resolveItunesPreview,
  resolveTrackPreview,
} from "@/lib/server/providers";
import type { Track } from "@/types/catalog";

const deezerTrack: Track = {
  id: "bad-bunny-safaera",
  title: "Safaera",
  artist: "Bad Bunny",
  genreId: "latin.urbano.reggaeton",
  provider: "deezer",
  providerTrackId: "908604612",
};

const itunesTrack: Track = {
  id: "hikaru-utada-first-love",
  title: "First Love",
  artist: "Hikaru Utada",
  genreId: "global.east-asian.j-rock",
  provider: "itunes",
  providerTrackId: "1440857781",
};

describe("audio preview providers (src/lib/server/providers.ts)", () => {
  beforeEach(() => {
    clearPreviewCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exposes a 5-second fetch timeout and a server TTL shorter than Deezer signed URL expiry", () => {
    expect(PROVIDER_FETCH_TIMEOUT_MS).toBe(5000);
    expect(PREVIEW_CACHE_TTL_MS).toBeGreaterThan(0);
    expect(PREVIEW_CACHE_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("resolves a Deezer track from the primary Deezer API without calling iTunes", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 908604612,
          title: "Safaera",
          preview: "https://cdns-preview.dzcdn.net/stream/c-safaera.mp3",
        }),
        { status: 200 },
      ),
    );

    const resolved = await resolveTrackPreview(deezerTrack, { fetchImpl: mockFetch });

    expect(resolved).toEqual({
      previewUrl: "https://cdns-preview.dzcdn.net/stream/c-safaera.mp3",
      provider: "deezer",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "https://api.deezer.com/track/908604612",
    );
  });

  it("resolves an iTunes track from the primary iTunes Lookup API without calling Deezer", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              trackId: 1440857781,
              artistName: "Hikaru Utada",
              trackName: "First Love",
              previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/first-love.m4a",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const resolved = await resolveTrackPreview(itunesTrack, { fetchImpl: mockFetch });

    expect(resolved).toEqual({
      previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/first-love.m4a",
      provider: "itunes",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "https://itunes.apple.com/lookup?id=1440857781",
    );
  });

  it("falls back to iTunes when the primary Deezer request is rate-limited or fails", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                artistName: "Bad Bunny",
                trackName: "Safaera",
                previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/safaera.m4a",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const resolved = await resolveTrackPreview(deezerTrack, { fetchImpl: mockFetch });

    expect(resolved).toEqual({
      previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/safaera.m4a",
      provider: "itunes",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain("api.deezer.com");
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("itunes.apple.com/search");
  });

  it("falls back to Deezer when the primary iTunes lookup returns no preview", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 111,
                title: "Unrelated Karaoke Song",
                artist: { name: "Tribute Band" },
                preview: "https://cdns-preview.dzcdn.net/stream/wrong-song.mp3",
              },
              {
                id: 777,
                title: "First Love",
                artist: { name: "Hikaru Utada" },
                preview: "https://cdns-preview.dzcdn.net/stream/first-love.mp3",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const resolved = await resolveTrackPreview(itunesTrack, { fetchImpl: mockFetch });

    expect(resolved).toEqual({
      previewUrl: "https://cdns-preview.dzcdn.net/stream/first-love.mp3",
      provider: "deezer",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects fallback search results when none of the returned tracks match artist and title", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                artistName: "Completely Different Artist",
                trackName: "Wrong Track",
                previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/wrong.m4a",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const resolved = await resolveTrackPreview(deezerTrack, { fetchImpl: mockFetch });
    expect(resolved).toBeNull();
  });

  it("deduplicates concurrent in-flight requests for the same uncached track", async () => {
    let resolveResponse: ((value: Response) => void) | undefined;
    const slowFetch = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const firstPromise = resolveTrackPreview(deezerTrack, { fetchImpl: slowFetch });
    const secondPromise = resolveTrackPreview(deezerTrack, { fetchImpl: slowFetch });

    expect(slowFetch).toHaveBeenCalledTimes(1);

    resolveResponse?.(
      new Response(
        JSON.stringify({
          id: 908604612,
          title: "Safaera",
          preview: "https://cdns-preview.dzcdn.net/stream/shared.mp3",
        }),
        { status: 200 },
      ),
    );

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult?.previewUrl).toBe("https://cdns-preview.dzcdn.net/stream/shared.mp3");
  });

  it("aborts timed-out requests after 5 seconds and falls back cleanly", async () => {
    const hangingPrimary = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(hangingPrimary)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/fallback.m4a",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const promise = resolveTrackPreview(deezerTrack, { fetchImpl: mockFetch });
    await vi.advanceTimersByTimeAsync(PROVIDER_FETCH_TIMEOUT_MS + 50);
    const resolved = await promise;

    expect(resolved).toEqual({
      previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/fallback.m4a",
      provider: "itunes",
    });
  });

  it("handles malformed JSON, Deezer error payloads, and missing preview URLs by returning null", async () => {
    const malformedJsonFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{not-valid-json", { status: 200 }));

    expect(
      await resolveDeezerPreview(deezerTrack, { fetchImpl: malformedJsonFetch }),
    ).toBeNull();
    expect(
      await resolveItunesPreview(itunesTrack, { fetchImpl: malformedJsonFetch }),
    ).toBeNull();

    const deezerErrorPayloadFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { type: "DataException", message: "no data", code: 800 },
        }),
        { status: 200 },
      ),
    );
    expect(
      await resolveDeezerPreview(deezerTrack, { fetchImpl: deezerErrorPayloadFetch }),
    ).toBeNull();

    const bothFailFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ preview: "" }), { status: 200 }));
    expect(await resolveTrackPreview(deezerTrack, { fetchImpl: bothFailFetch })).toBeNull();
  });

  it("caches resolved preview URLs in memory until the TTL expires", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 908604612,
            preview: "https://cdns-preview.dzcdn.net/stream/cached-1.mp3",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 908604612,
            preview: "https://cdns-preview.dzcdn.net/stream/refreshed-2.mp3",
          }),
          { status: 200 },
        ),
      );

    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    const first = await resolveTrackPreview(deezerTrack, { fetchImpl: mockFetch });
    expect(first?.previewUrl).toBe("https://cdns-preview.dzcdn.net/stream/cached-1.mp3");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time within TTL -> returns cached preview without fetching
    vi.advanceTimersByTime(PREVIEW_CACHE_TTL_MS - 1000);
    const second = await resolveTrackPreview(deezerTrack, { fetchImpl: mockFetch });
    expect(second?.previewUrl).toBe("https://cdns-preview.dzcdn.net/stream/cached-1.mp3");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past TTL -> cache entry expires and triggers a fresh fetch
    vi.advanceTimersByTime(2000);
    const third = await resolveTrackPreview(deezerTrack, { fetchImpl: mockFetch });
    expect(third?.previewUrl).toBe("https://cdns-preview.dzcdn.net/stream/refreshed-2.mp3");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
