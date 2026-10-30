import { NextResponse } from "next/server";
import { isDailyEligibleChannel } from "@/lib/catalog";
import {
  evaluateDailyGuess,
  getDailyPuzzlePayload,
} from "@/lib/server/daily";
import type {
  DailyGuessResponse,
  DailyPuzzleResponse,
} from "@/types/catalog";

interface RouteContext {
  params: Promise<{ genre: string }>;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeRouteParam(value: string): string | null {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse<DailyPuzzleResponse | { error: string }>> {
  const resolvedParams = await context.params;
  const genreId =
    typeof resolvedParams?.genre === "string"
      ? decodeRouteParam(resolvedParams.genre)
      : null;

  if (genreId === null || genreId.length === 0) {
    return NextResponse.json(
      { error: "Genre not found." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const payload = getDailyPuzzlePayload(genreId);
  if (payload === null) {
    return NextResponse.json(
      { error: "Daily puzzle not available for this genre." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse<DailyGuessResponse | { error: string }>> {
  const resolvedParams = await context.params;
  const genreId =
    typeof resolvedParams?.genre === "string"
      ? decodeRouteParam(resolvedParams.genre)
      : null;

  if (
    genreId === null ||
    genreId.length === 0 ||
    !isDailyEligibleChannel(genreId)
  ) {
    return NextResponse.json(
      { error: "Daily puzzle not available for this genre." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!isRecord(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const rawTrackId = body.trackId ?? body.guess;
  const rawAttempt = body.attempt ?? body.attemptIndex;

  const result = evaluateDailyGuess(genreId, {
    trackId: rawTrackId,
    attempt: rawAttempt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(result.data, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
