import { NextResponse } from "next/server";
import { resolveAudioTargetTrack } from "@/lib/server/daily";
import { resolveTrackPreview } from "@/lib/server/providers";
import type { AudioPreviewResponse } from "@/types/catalog";

interface RouteContext {
  params: Promise<{ trackId: string }>;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

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
): Promise<NextResponse<AudioPreviewResponse | { error: string }>> {
  const resolvedParams = await context.params;
  const rawTrackId =
    typeof resolvedParams?.trackId === "string"
      ? decodeRouteParam(resolvedParams.trackId)
      : null;

  if (rawTrackId === null || rawTrackId.length === 0) {
    return NextResponse.json(
      { error: "Track not found." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const track = resolveAudioTargetTrack(rawTrackId);
  if (track === undefined) {
    return NextResponse.json(
      { error: "Track not found." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const resolved = await resolveTrackPreview(track);
  if (resolved === null) {
    return NextResponse.json(
      { error: "Audio preview unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      previewUrl: resolved.previewUrl,
      provider: resolved.provider,
      snippetOffsetMs: track.snippetOffsetMs ?? 0,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
