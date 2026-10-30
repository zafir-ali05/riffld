import { isArtistMatch, normalizeTitle } from "@/lib/feedback";
import type { AudioProvider, Track } from "@/types/catalog";

export const PROVIDER_FETCH_TIMEOUT_MS = 5000;

// Deezer signed preview URLs expire after roughly 15 minutes; cache for 10 minutes.
export const PREVIEW_CACHE_TTL_MS = 10 * 60 * 1000;

const MAX_CACHE_ENTRIES_BEFORE_SWEEP = 500;

export interface ResolvedPreview {
  previewUrl: string;
  provider: AudioProvider;
}

export interface ResolvePreviewOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  bypassCache?: boolean;
}

interface CacheEntry {
  previewUrl: string;
  provider: AudioProvider;
  expiresAt: number;
}

const previewCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<ResolvedPreview | null>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}

function matchesSearchCandidate(
  candidateTitle: unknown,
  candidateArtist: unknown,
  expected?: Pick<Track, "title" | "artist">,
): boolean {
  if (expected === undefined) {
    return true;
  }

  const hasTitle = typeof candidateTitle === "string" && candidateTitle.trim().length > 0;
  const hasArtist = typeof candidateArtist === "string" && candidateArtist.trim().length > 0;

  if (!hasTitle && !hasArtist) {
    return true;
  }

  if (hasTitle && normalizeTitle(candidateTitle) !== normalizeTitle(expected.title)) {
    return false;
  }

  if (hasArtist && !isArtistMatch(candidateArtist, expected.artist)) {
    return false;
  }

  return true;
}

async function fetchJsonWithTimeout(
  url: string,
  options?: ResolvePreviewOptions,
): Promise<unknown> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? PROVIDER_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const parsed: unknown = await response.json();
    return parsed;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function extractDeezerPreviewUrl(
  payload: unknown,
  expectedTrack?: Pick<Track, "title" | "artist">,
): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  // Deezer returns HTTP 200 with an error object on quota limits or missing IDs.
  if ("error" in payload && payload.error !== undefined && payload.error !== null) {
    return null;
  }

  if (isValidHttpUrl(payload.preview)) {
    return payload.preview.trim();
  }

  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (!isRecord(item) || !isValidHttpUrl(item.preview)) {
        continue;
      }

      const artistName = isRecord(item.artist) ? item.artist.name : undefined;
      if (matchesSearchCandidate(item.title, artistName, expectedTrack)) {
        return item.preview.trim();
      }
    }
  }

  return null;
}

export function extractItunesPreviewUrl(
  payload: unknown,
  expectedTrack?: Pick<Track, "title" | "artist">,
): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (isValidHttpUrl(payload.previewUrl)) {
    return payload.previewUrl.trim();
  }

  if (Array.isArray(payload.results)) {
    for (const item of payload.results) {
      if (!isRecord(item) || !isValidHttpUrl(item.previewUrl)) {
        continue;
      }

      if (matchesSearchCandidate(item.trackName, item.artistName, expectedTrack)) {
        return item.previewUrl.trim();
      }
    }
  }

  return null;
}

export async function resolveDeezerPreview(
  track: Pick<Track, "provider" | "providerTrackId" | "title" | "artist">,
  options?: ResolvePreviewOptions,
): Promise<string | null> {
  const isPrimary = track.provider === "deezer";
  const url = isPrimary
    ? `https://api.deezer.com/track/${encodeURIComponent(track.providerTrackId)}`
    : `https://api.deezer.com/search?q=${encodeURIComponent(`${track.artist} ${track.title}`)}&limit=5`;

  const payload = await fetchJsonWithTimeout(url, options);
  return extractDeezerPreviewUrl(payload, isPrimary ? undefined : track);
}

export async function resolveItunesPreview(
  track: Pick<Track, "provider" | "providerTrackId" | "title" | "artist">,
  options?: ResolvePreviewOptions,
): Promise<string | null> {
  const isPrimary = track.provider === "itunes";
  const url = isPrimary
    ? `https://itunes.apple.com/lookup?id=${encodeURIComponent(track.providerTrackId)}&entity=song`
    : `https://itunes.apple.com/search?term=${encodeURIComponent(`${track.artist} ${track.title}`)}&media=music&entity=song&limit=5`;

  const payload = await fetchJsonWithTimeout(url, options);
  return extractItunesPreviewUrl(payload, isPrimary ? undefined : track);
}

function getCacheKey(track: Pick<Track, "id" | "provider" | "providerTrackId">): string {
  return `${track.id}:${track.provider}:${track.providerTrackId}`;
}

function sweepExpiredCacheEntries(now: number): void {
  if (previewCache.size < MAX_CACHE_ENTRIES_BEFORE_SWEEP) {
    return;
  }

  for (const [key, entry] of previewCache.entries()) {
    if (now >= entry.expiresAt) {
      previewCache.delete(key);
    }
  }
}

export function clearPreviewCache(): void {
  previewCache.clear();
  inFlightRequests.clear();
}

export async function resolveTrackPreview(
  track: Track,
  options?: ResolvePreviewOptions,
): Promise<ResolvedPreview | null> {
  const cacheKey = getCacheKey(track);
  const now = Date.now();

  if (!options?.bypassCache) {
    const cached = previewCache.get(cacheKey);
    if (cached !== undefined) {
      if (now < cached.expiresAt) {
        return {
          previewUrl: cached.previewUrl,
          provider: cached.provider,
        };
      }
      previewCache.delete(cacheKey);
    }

    const existingInFlight = inFlightRequests.get(cacheKey);
    if (existingInFlight !== undefined) {
      return existingInFlight;
    }
  }

  const providerOrder: readonly AudioProvider[] =
    track.provider === "deezer" ? ["deezer", "itunes"] : ["itunes", "deezer"];

  const resolutionPromise = (async (): Promise<ResolvedPreview | null> => {
    for (const provider of providerOrder) {
      const previewUrl =
        provider === "deezer"
          ? await resolveDeezerPreview(track, options)
          : await resolveItunesPreview(track, options);

      if (previewUrl !== null) {
        const writeNow = Date.now();
        sweepExpiredCacheEntries(writeNow);
        const ttlMs = options?.ttlMs ?? PREVIEW_CACHE_TTL_MS;
        previewCache.set(cacheKey, {
          previewUrl,
          provider,
          expiresAt: writeNow + ttlMs,
        });

        return {
          previewUrl,
          provider,
        };
      }
    }

    return null;
  })();

  if (!options?.bypassCache) {
    inFlightRequests.set(cacheKey, resolutionPromise);
  }

  try {
    return await resolutionPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}
