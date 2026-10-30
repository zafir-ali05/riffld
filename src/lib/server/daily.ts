import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";
import {
  getTrackById,
  getTracksForChannel,
  isDailyEligibleChannel,
  type CatalogData,
} from "@/lib/catalog";
import { classifyGuess, type GuessCandidate } from "@/lib/feedback";
import {
  getPuzzleNumber,
  getUtcDateString,
  parseUtcDateMidnightMs,
} from "@/lib/share";
import {
  MAX_ATTEMPTS,
  MIN_DAILY_ELIGIBLE_TRACKS,
  type AutocompleteTrack,
  type DailyGuessResponse,
  type DailyPuzzleResponse,
  type RoundStatus,
  type Track,
} from "@/types/catalog";

export interface DailySelectorOptions {
  salt?: string;
  tracks?: readonly Track[];
  catalog?: CatalogData;
}

interface DailyTokenPayload {
  c: string;
  d: string;
}

export const DAILY_TOKEN_PREFIX = "dt_";

const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const DEFAULT_DEV_SALT = "change-me-in-production";

function resolveSalt(explicitSalt?: string): string {
  if (explicitSalt !== undefined) {
    if (explicitSalt.trim().length === 0) {
      throw new Error("DAILY_SEED_SALT must not be empty.");
    }
    return explicitSalt;
  }

  const envSalt = process.env.DAILY_SEED_SALT?.trim();
  if (process.env.NODE_ENV === "production") {
    if (envSalt === undefined || envSalt.length === 0 || envSalt === DEFAULT_DEV_SALT) {
      throw new Error(
        "DAILY_SEED_SALT must be set to a non-default secret in production.",
      );
    }
    return envSalt;
  }

  if (envSalt !== undefined && envSalt.length > 0) {
    return envSalt;
  }

  return DEFAULT_DEV_SALT;
}

function normalizeDateString(dateOrString: Date | string): string {
  const dateString =
    dateOrString instanceof Date ? getUtcDateString(dateOrString) : dateOrString;
  parseUtcDateMidnightMs(dateString);
  return dateString;
}

// Frozen daily seed hash: hash(channelId + YYYY-MM-DD + DAILY_SEED_SALT)
export function hashDailySeed(
  channelId: string,
  dateString: string,
  salt: string,
): number {
  const normalizedDate = normalizeDateString(dateString);
  const digest = createHash("sha256")
    .update(`${channelId}${normalizedDate}${salt}`, "utf8")
    .digest();
  return digest.readUInt32BE(0);
}

export function selectDailyTrack(
  channelId: string,
  dateOrString: Date | string = new Date(),
  options?: DailySelectorOptions,
): Track {
  const dateString = normalizeDateString(dateOrString);
  const salt = resolveSalt(options?.salt);
  const pool =
    options?.tracks ?? getTracksForChannel(channelId, options?.catalog);

  if (pool.length < MIN_DAILY_ELIGIBLE_TRACKS) {
    throw new Error(
      `Channel "${channelId}" has ${pool.length} tracks; at least ${MIN_DAILY_ELIGIBLE_TRACKS} tracks are required for Daily Mode.`,
    );
  }

  const hashValue = hashDailySeed(channelId, dateString, salt);
  const selectedTrack = pool[hashValue % pool.length];
  if (selectedTrack === undefined) {
    throw new Error(`Failed to select daily track for channel "${channelId}".`);
  }

  return selectedTrack;
}

function deriveTokenKey(salt: string): Buffer {
  return createHash("sha256").update(`riffld:daily-token-key:${salt}`, "utf8").digest();
}

function isDailyTokenPayload(value: unknown): value is DailyTokenPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    "c" in value &&
    typeof value.c === "string" &&
    value.c.length > 0 &&
    "d" in value &&
    typeof value.d === "string" &&
    value.d.length > 0
  );
}

export function isDailyAudioToken(value: string): boolean {
  return value.startsWith(DAILY_TOKEN_PREFIX) && value.length > DAILY_TOKEN_PREFIX.length;
}

// Encrypts (channelId, dateString) with AES-256-GCM using a key and deterministic IV
// derived from DAILY_SEED_SALT so /api/audio/[trackId] can resolve the daily track
// without exposing trackId, title, artist, or channelId to the client.
export function createDailyAudioToken(
  channelId: string,
  dateOrString: Date | string = new Date(),
  options?: { salt?: string },
): string {
  const dateString = normalizeDateString(dateOrString);
  const salt = resolveSalt(options?.salt);
  const key = deriveTokenKey(salt);
  const iv = createHmac("sha256", salt)
    .update(`riffld:daily-token-iv:${channelId}:${dateString}`, "utf8")
    .digest()
    .subarray(0, GCM_IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(
    JSON.stringify({ c: channelId, d: dateString } satisfies DailyTokenPayload),
    "utf8",
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, encrypted]).toString("base64url");

  return `${DAILY_TOKEN_PREFIX}${packed}`;
}

export function resolveDailyAudioToken(
  token: string,
  options?: DailySelectorOptions,
): Track | undefined {
  if (!isDailyAudioToken(token)) {
    return undefined;
  }

  try {
    const salt = resolveSalt(options?.salt);
    const key = deriveTokenKey(salt);
    const encoded = token.slice(DAILY_TOKEN_PREFIX.length);
    const packed = Buffer.from(encoded, "base64url");

    if (packed.length <= GCM_IV_BYTES + GCM_AUTH_TAG_BYTES) {
      return undefined;
    }

    const iv = packed.subarray(0, GCM_IV_BYTES);
    const authTag = packed.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_AUTH_TAG_BYTES);
    const ciphertext = packed.subarray(GCM_IV_BYTES + GCM_AUTH_TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    const parsed: unknown = JSON.parse(decrypted);
    if (!isDailyTokenPayload(parsed)) {
      return undefined;
    }

    return selectDailyTrack(parsed.c, parsed.d, options);
  } catch {
    return undefined;
  }
}

export function resolveAudioTargetTrack(
  trackIdOrToken: string,
  options?: DailySelectorOptions,
): Track | undefined {
  const trimmed = trackIdOrToken.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (isDailyAudioToken(trimmed)) {
    return resolveDailyAudioToken(trimmed, options);
  }

  return (
    options?.tracks?.find((track) => track.id === trimmed) ??
    getTrackById(trimmed, options?.catalog)
  );
}

export function getDailyPuzzlePayload(
  channelId: string,
  dateOrString: Date | string = new Date(),
  options?: DailySelectorOptions,
): DailyPuzzleResponse | null {
  if (!isDailyEligibleChannel(channelId, options?.catalog)) {
    return null;
  }

  const date = normalizeDateString(dateOrString);
  const puzzleNumber = getPuzzleNumber(date);
  const audioToken = createDailyAudioToken(channelId, date, {
    salt: options?.salt,
  });
  const pool =
    options?.tracks ?? getTracksForChannel(channelId, options?.catalog);
  const tracks: AutocompleteTrack[] = pool.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
  }));

  return {
    genreId: channelId,
    date,
    puzzleNumber,
    audioToken,
    tracks,
  };
}

export type DailyGuessEvaluationResult =
  | { ok: true; data: DailyGuessResponse }
  | { ok: false; status: 400 | 404; error: string };

export function evaluateDailyGuess(
  channelId: string,
  input: { trackId: unknown; attempt: unknown },
  dateOrString: Date | string = new Date(),
  options?: DailySelectorOptions,
): DailyGuessEvaluationResult {
  if (!isDailyEligibleChannel(channelId, options?.catalog)) {
    return {
      ok: false,
      status: 404,
      error: "Daily puzzle not available for this genre.",
    };
  }

  const { trackId: rawTrackId, attempt: rawAttempt } = input;

  if (
    typeof rawAttempt !== "number" ||
    !Number.isInteger(rawAttempt) ||
    rawAttempt < 0 ||
    rawAttempt >= MAX_ATTEMPTS
  ) {
    return {
      ok: false,
      status: 400,
      error: `Invalid attempt index. Expected integer from 0 to ${MAX_ATTEMPTS - 1}.`,
    };
  }

  if (typeof rawTrackId !== "string" || rawTrackId.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Guess trackId must be a non-empty string.",
    };
  }

  const trimmedGuess = rawTrackId.trim();
  let candidate: GuessCandidate;

  if (trimmedGuess === "skip" || trimmedGuess === "skipped") {
    candidate = "skip";
  } else {
    const guessedTrack =
      options?.tracks?.find((track) => track.id === trimmedGuess) ??
      getTrackById(trimmedGuess, options?.catalog);

    if (guessedTrack === undefined) {
      return {
        ok: false,
        status: 400,
        error: `Unknown trackId "${trimmedGuess}".`,
      };
    }

    candidate = guessedTrack;
  }

  const answerTrack = selectDailyTrack(channelId, dateOrString, options);
  const feedback = classifyGuess(candidate, answerTrack);

  let status: RoundStatus = "playing";
  if (feedback === "correct") {
    status = "won";
  } else if (rawAttempt === MAX_ATTEMPTS - 1) {
    status = "lost";
  }

  const data: DailyGuessResponse =
    status === "playing"
      ? { feedback, attempt: rawAttempt, status }
      : { feedback, attempt: rawAttempt, status, answer: answerTrack };

  return {
    ok: true,
    data,
  };
}
