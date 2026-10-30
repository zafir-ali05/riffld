import type { GuessFeedback, Track } from "@/types/catalog";

export type GuessCandidate =
  | (Pick<Track, "title" | "artist"> & { id?: string })
  | "skip"
  | "skipped"
  | null
  | undefined;

const BRACKETED_FEATURE_PATTERN =
  /[([{]\s*(?:feat(?:uring)?\.?|ft\.?|with)\b[^)\]}]*[)\]}]/gi;
const INLINE_ARTIST_FEATURE_PATTERN = /\s+(?:feat(?:uring)?\.?|ft\.?|with)\s+.*$/i;
const INLINE_TITLE_FEATURE_PATTERN = /\s+(?:feat(?:uring)?\.?|ft\.?)\s+.*$/i;

// Artist names that contain an internal comma as part of a single artist's name
// must be protected before splitting multi-artist credit strings on commas.
const PROTECTED_COMMA_ARTISTS: ReadonlyArray<{ pattern: RegExp; placeholder: string }> = [
  { pattern: /\btyler,\s*the\s+creator\b/gi, placeholder: "tyler the creator" },
  { pattern: /\bearth,\s*wind\s*(?:&|and)\s*fire\b/gi, placeholder: "earth wind and fire" },
  { pattern: /\bcrosby,\s*stills\s*(?:&|and)\s*nash\b/gi, placeholder: "crosby stills and nash" },
];

function stripDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/gi, "o")
    .replace(/ł/gi, "l")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe");
}

function normalizeCleanedText(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[&+]/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArtist(artist: string): string {
  const withoutFeatures = artist
    .replace(BRACKETED_FEATURE_PATTERN, " ")
    .replace(INLINE_ARTIST_FEATURE_PATTERN, " ");
  return normalizeCleanedText(withoutFeatures);
}

export function normalizeTitle(title: string): string {
  const withoutFeatures = title
    .replace(BRACKETED_FEATURE_PATTERN, " ")
    .replace(INLINE_TITLE_FEATURE_PATTERN, " ");
  return normalizeCleanedText(withoutFeatures);
}

export function splitArtists(artist: string): string[] {
  let prepared = artist
    .replace(BRACKETED_FEATURE_PATTERN, " ")
    .replace(INLINE_ARTIST_FEATURE_PATTERN, " ");

  for (const entry of PROTECTED_COMMA_ARTISTS) {
    prepared = prepared.replace(entry.pattern, entry.placeholder);
  }

  const segments = prepared.split(/(?:\s*[,/;]\s*|\s+(?:&|and|x)\s+)/i);
  const seen = new Set<string>();

  for (const segment of segments) {
    const normalized = normalizeArtist(segment);
    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }

  return Array.from(seen);
}

export function isArtistMatch(guessedArtist: string, targetArtist: string): boolean {
  const normalizedGuess = normalizeArtist(guessedArtist);
  const normalizedTarget = normalizeArtist(targetArtist);

  if (normalizedGuess.length === 0 || normalizedTarget.length === 0) {
    return false;
  }

  if (normalizedGuess === normalizedTarget) {
    return true;
  }

  const guessedCredits = splitArtists(guessedArtist);
  const targetCredits = new Set(splitArtists(targetArtist));

  for (const credited of guessedCredits) {
    if (targetCredits.has(credited)) {
      return true;
    }
  }

  return false;
}

export function classifyGuess(
  guess: GuessCandidate,
  target: Pick<Track, "id" | "title" | "artist">,
): GuessFeedback {
  if (
    guess === "skip" ||
    guess === "skipped" ||
    guess === null ||
    guess === undefined
  ) {
    return "skipped";
  }

  if (
    typeof guess.id === "string" &&
    guess.id.length > 0 &&
    guess.id === target.id
  ) {
    return "correct";
  }

  const artistMatches = isArtistMatch(guess.artist, target.artist);
  const guessedTitle = normalizeTitle(guess.title);
  const targetTitle = normalizeTitle(target.title);

  if (artistMatches && guessedTitle.length > 0 && guessedTitle === targetTitle) {
    return "correct";
  }

  if (artistMatches) {
    return "artist";
  }

  return "wrong";
}
