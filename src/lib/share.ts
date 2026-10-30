import {
  FEEDBACK_SQUARES,
  MAX_ATTEMPTS,
  type GuessFeedback,
} from "@/types/catalog";

export const LAUNCH_DATE_UTC = "2026-01-01";

const MS_PER_UTC_DAY = 86_400_000;
const DATE_STRING_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ShareTextOptions {
  puzzleNumber: number;
  genreId: string;
  genreName: string;
  genreEmoji?: string;
  guesses: readonly GuessFeedback[];
  streak?: number;
  appUrl?: string;
}

export function getUtcDateString(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseUtcDateMidnightMs(dateOrString: Date | string): number {
  const dateString =
    dateOrString instanceof Date ? getUtcDateString(dateOrString) : dateOrString;
  const match = DATE_STRING_PATTERN.exec(dateString);
  if (match === null) {
    throw new Error(`Invalid UTC date string "${dateString}". Expected YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);

  if (getUtcDateString(new Date(utcMs)) !== dateString) {
    throw new Error(`Invalid UTC calendar date "${dateString}".`);
  }

  return utcMs;
}

export function getPuzzleNumber(
  date: Date | string = new Date(),
  launchDate: string = LAUNCH_DATE_UTC,
): number {
  const targetMidnightMs = parseUtcDateMidnightMs(date);
  const launchMidnightMs = parseUtcDateMidnightMs(launchDate);
  return Math.floor((targetMidnightMs - launchMidnightMs) / MS_PER_UTC_DAY);
}

export function buildShareGrid(guesses: readonly GuessFeedback[]): string {
  const bounded = guesses.slice(0, MAX_ATTEMPTS);
  const squares: string[] = bounded.map((feedback) => FEEDBACK_SQUARES[feedback]);

  while (squares.length < MAX_ATTEMPTS) {
    squares.push(FEEDBACK_SQUARES.unused);
  }

  return squares.join("");
}

export function formatShareText(options: ShareTextOptions): string {
  const {
    puzzleNumber,
    genreId,
    genreName,
    genreEmoji,
    guesses,
    streak,
    appUrl,
  } = options;

  const winIndex = guesses.findIndex((feedback) => feedback === "correct");
  const scoreLabel =
    winIndex >= 0 ? `${winIndex + 1}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  const genreDisplay =
    genreEmoji !== undefined && genreEmoji.trim().length > 0
      ? `${genreEmoji.trim()} ${genreName}`
      : genreName;

  const rawBaseUrl =
    appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://riffld.app";
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  const lines: string[] = [
    `Riffld #${puzzleNumber} · ${genreDisplay} · ${scoreLabel}`,
    buildShareGrid(guesses),
  ];

  if (streak !== undefined) {
    lines.push(`Streak: ${streak}`);
  }

  lines.push(`${baseUrl}/daily/${genreId}`);

  return lines.join("\n");
}
