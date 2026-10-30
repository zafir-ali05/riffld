import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAUNCH_DATE_UTC,
  buildShareGrid,
  formatShareText,
  getPuzzleNumber,
  getUtcDateString,
  parseUtcDateMidnightMs,
} from "@/lib/share";
import {
  createDailyAudioToken,
  hashDailySeed,
  isDailyAudioToken,
  resolveDailyAudioToken,
  selectDailyTrack,
} from "@/lib/server/daily";
import type { CatalogData } from "@/lib/catalog";
import type { GenreNode, Track } from "@/types/catalog";

const sampleGenres: GenreNode[] = [
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
        ],
      },
    ],
  },
];

const sampleTracks: Track[] = Array.from({ length: 35 }, (_, i) => ({
  id: `reggaeton-track-${i + 1}`,
  title: `Reggaeton Song ${i + 1}`,
  artist: `Urbano Artist ${i + 1}`,
  genreId: "latin.urbano.reggaeton",
  provider: "deezer",
  providerTrackId: `90000${i + 1}`,
}));

const sampleCatalog: CatalogData = {
  genres: sampleGenres,
  tracks: sampleTracks,
};

describe("UTC date and puzzle number helpers (src/lib/share.ts)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives YYYY-MM-DD strictly in UTC and rolls over at 00:00 UTC", () => {
    // 23:59:59 UTC on 2026-10-29 (even if local time in some zones is already Oct 30)
    vi.setSystemTime(new Date("2026-10-29T23:59:59.999Z"));
    expect(getUtcDateString()).toBe("2026-10-29");
    const beforeRolloverPuzzle = getPuzzleNumber();

    // 00:00:00 UTC on 2026-10-30
    vi.setSystemTime(new Date("2026-10-30T00:00:00.000Z"));
    expect(getUtcDateString()).toBe("2026-10-30");
    const afterRolloverPuzzle = getPuzzleNumber();

    expect(afterRolloverPuzzle).toBe(beforeRolloverPuzzle + 1);
  });

  it("computes puzzle numbers as UTC days elapsed since LAUNCH_DATE_UTC", () => {
    expect(LAUNCH_DATE_UTC).toBe("2026-01-01");
    expect(getPuzzleNumber("2026-01-01", "2026-01-01")).toBe(0);
    expect(getPuzzleNumber("2026-01-02", "2026-01-01")).toBe(1);
    expect(getPuzzleNumber("2026-05-23", "2026-01-01")).toBe(142);
  });

  it("rejects impossible calendar dates like February 31 or month 13", () => {
    expect(() => parseUtcDateMidnightMs("2026-02-31")).toThrow(/invalid utc calendar date/i);
    expect(() => parseUtcDateMidnightMs("2026-13-01")).toThrow(/invalid utc calendar date/i);
    expect(() => parseUtcDateMidnightMs("2026-00-10")).toThrow(/invalid utc calendar date/i);
  });
});

describe("share-text formatter (src/lib/share.ts)", () => {
  it("builds a 6-square feedback row padded with unused squares", () => {
    expect(buildShareGrid(["skipped", "artist", "correct"])).toBe("⬜🟨🟩⬛⬛⬛");
    expect(
      buildShareGrid(["skipped", "wrong", "artist", "wrong", "wrong", "wrong"]),
    ).toBe("⬜🟥🟨🟥🟥🟥");
  });

  it("formats spoiler-free share text for a winning round with streak and URL", () => {
    const text = formatShareText({
      puzzleNumber: 142,
      genreId: "latin.urbano.reggaeton",
      genreName: "Reggaeton",
      genreEmoji: "🇵🇷",
      guesses: ["skipped", "artist", "correct"],
      streak: 12,
      appUrl: "https://riffld.app/",
    });

    expect(text).toBe(
      [
        "Riffld #142 · 🇵🇷 Reggaeton · 3/6",
        "⬜🟨🟩⬛⬛⬛",
        "Streak: 12",
        "https://riffld.app/daily/latin.urbano.reggaeton",
      ].join("\n"),
    );
  });

  it("formats share text with X/6 when the round is lost", () => {
    const text = formatShareText({
      puzzleNumber: 142,
      genreId: "latin.urbano.reggaeton",
      genreName: "Reggaeton",
      guesses: ["wrong", "wrong", "skipped", "artist", "wrong", "wrong"],
      appUrl: "http://localhost:3000",
    });

    expect(text).toBe(
      [
        "Riffld #142 · Reggaeton · X/6",
        "🟥🟥⬜🟨🟥🟥",
        "http://localhost:3000/daily/latin.urbano.reggaeton",
      ].join("\n"),
    );
  });
});

describe("deterministic daily selector and opaque tokens (src/lib/server/daily.ts)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects the exact same track for identical (channelId, dateString, salt)", () => {
    const salt = "test-secret-salt";
    const first = selectDailyTrack("latin.urbano.reggaeton", "2026-10-30", {
      salt,
      catalog: sampleCatalog,
    });
    const second = selectDailyTrack("latin.urbano.reggaeton", "2026-10-30", {
      salt,
      catalog: sampleCatalog,
    });

    expect(first).toEqual(second);
    expect(hashDailySeed("latin.urbano.reggaeton", "2026-10-30", salt)).toBe(
      hashDailySeed("latin.urbano.reggaeton", "2026-10-30", salt),
    );
  });

  it("changes the selected seed when the UTC date rolls over at 00:00 UTC or when salt/channel changes", () => {
    const salt = "test-secret-salt";

    vi.setSystemTime(new Date("2026-10-29T23:59:59Z"));
    const hashBefore = hashDailySeed("latin.urbano.reggaeton", getUtcDateString(), salt);

    vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
    const hashAfter = hashDailySeed("latin.urbano.reggaeton", getUtcDateString(), salt);

    expect(hashAfter).not.toBe(hashBefore);
    expect(
      hashDailySeed("latin.urbano.reggaeton", "2026-10-30", "different-salt"),
    ).not.toBe(hashAfter);
    expect(hashDailySeed("latin", "2026-10-30", salt)).not.toBe(hashAfter);
  });

  it("generates an opaque daily audio token that does not leak track metadata and resolves back to the daily track", () => {
    const salt = "round-token-salt";
    const expectedTrack = selectDailyTrack("latin.urbano.reggaeton", "2026-10-30", {
      salt,
      catalog: sampleCatalog,
    });

    const token = createDailyAudioToken("latin.urbano.reggaeton", "2026-10-30", { salt });

    expect(isDailyAudioToken(token)).toBe(true);
    expect(token).not.toContain(expectedTrack.id);
    expect(token).not.toContain(expectedTrack.title);
    expect(token).not.toContain(expectedTrack.artist);
    expect(token).not.toContain(expectedTrack.providerTrackId);
    expect(token).not.toContain("reggaeton");

    const resolved = resolveDailyAudioToken(token, {
      salt,
      catalog: sampleCatalog,
    });
    expect(resolved).toEqual(expectedTrack);
  });

  it("returns undefined for tampered, malformed, or wrong-salt daily audio tokens", () => {
    const token = createDailyAudioToken("latin.urbano.reggaeton", "2026-10-30", {
      salt: "correct-salt",
    });

    expect(
      resolveDailyAudioToken(token, {
        salt: "wrong-salt",
        catalog: sampleCatalog,
      }),
    ).toBeUndefined();

    expect(
      resolveDailyAudioToken(`${token}tampered`, {
        salt: "correct-salt",
        catalog: sampleCatalog,
      }),
    ).toBeUndefined();

    expect(
      resolveDailyAudioToken("not-a-daily-token", {
        salt: "correct-salt",
        catalog: sampleCatalog,
      }),
    ).toBeUndefined();
  });

  it("rejects channels with fewer than 30 tracks for Daily Mode", () => {
    expect(() =>
      selectDailyTrack("latin.urbano.reggaeton", "2026-10-30", {
        salt: "test-salt",
        tracks: sampleTracks.slice(0, 29),
      }),
    ).toThrow(/at least 30/i);
  });

  it("rejects missing or default DAILY_SEED_SALT when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DAILY_SEED_SALT", "");

    try {
      expect(() =>
        selectDailyTrack("latin.urbano.reggaeton", "2026-10-30", {
          catalog: sampleCatalog,
        }),
      ).toThrow(/DAILY_SEED_SALT/i);

      vi.stubEnv("DAILY_SEED_SALT", "change-me-in-production");
      expect(() =>
        selectDailyTrack("latin.urbano.reggaeton", "2026-10-30", {
          catalog: sampleCatalog,
        }),
      ).toThrow(/DAILY_SEED_SALT/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
