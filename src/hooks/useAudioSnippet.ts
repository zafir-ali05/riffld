"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_ATTEMPTS,
  MAX_PREVIEW_DURATION_MS,
  SNIPPET_DURATIONS_MS,
  type AudioPreviewResponse,
  type AudioProvider,
} from "@/types/catalog";

export type AudioSnippetStatus = "idle" | "loading" | "playing" | "error";

export interface SnippetWindow {
  startMs: number;
  durationMs: number;
  endMs: number;
  startTimeSec: number;
  endTimeSec: number;
}

export interface AudioElementLike {
  src: string;
  currentTime: number;
  preload?: string;
  play(): Promise<void>;
  pause(): void;
  load?(): void;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export interface AudioContextLike {
  state: string;
  resume(): Promise<void>;
  close?(): Promise<void>;
}

export interface AudioSnippetState {
  status: AudioSnippetStatus;
  error: string | null;
  elapsedMs: number;
  durationMs: number;
  snippetOffsetMs: number;
}

export interface AudioSnippetControllerOptions {
  targetId: string | null;
  attempt: number;
  snippetOffsetMs?: number;
  fetchImpl?: typeof fetch;
  createAudioElement?: () => AudioElementLike;
  getAudioContext?: () => AudioContextLike | null;
  onStateChange?: (state: AudioSnippetState) => void;
}

export interface AudioSnippetController {
  getState(): AudioSnippetState;
  setConfig(config: {
    targetId: string | null;
    attempt: number;
    snippetOffsetMs?: number;
  }): void;
  play(): Promise<void>;
  stop(): void;
  toggle(): Promise<void>;
  retry(): Promise<void>;
  handleVisibilityChange(isHidden: boolean): void;
  destroy(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAudioProvider(value: unknown): value is AudioProvider {
  return value === "deezer" || value === "itunes";
}

function isAudioPreviewResponse(value: unknown): value is AudioPreviewResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.previewUrl === "string" &&
    value.previewUrl.trim().length > 0 &&
    isAudioProvider(value.provider) &&
    typeof value.snippetOffsetMs === "number" &&
    Number.isFinite(value.snippetOffsetMs) &&
    value.snippetOffsetMs >= 0
  );
}

export function clampAttemptIndex(attempt: number): number {
  if (!Number.isFinite(attempt)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.trunc(attempt)), MAX_ATTEMPTS - 1);
}

export function getSnippetWindowForAttempt(
  attempt: number,
  snippetOffsetMs: number = 0,
): SnippetWindow {
  const clampedAttempt = clampAttemptIndex(attempt);
  const durationMs =
    SNIPPET_DURATIONS_MS[clampedAttempt] ?? SNIPPET_DURATIONS_MS[0];
  const safeOffsetMs =
    Number.isFinite(snippetOffsetMs) && snippetOffsetMs > 0
      ? Math.min(snippetOffsetMs, MAX_PREVIEW_DURATION_MS - durationMs)
      : 0;
  const endMs = Math.min(MAX_PREVIEW_DURATION_MS, safeOffsetMs + durationMs);

  return {
    startMs: safeOffsetMs,
    durationMs,
    endMs,
    startTimeSec: safeOffsetMs / 1000,
    endTimeSec: endMs / 1000,
  };
}

let sharedBrowserAudioContext: AudioContextLike | null = null;

function getDefaultBrowserAudioContext(): AudioContextLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (sharedBrowserAudioContext !== null) {
    return sharedBrowserAudioContext;
  }

  const win = window as unknown as Record<string, unknown>;
  const Ctor = (win.AudioContext ?? win.webkitAudioContext) as
    | (new () => AudioContextLike)
    | undefined;

  if (typeof Ctor !== "function") {
    return null;
  }

  try {
    sharedBrowserAudioContext = new Ctor();
    return sharedBrowserAudioContext;
  } catch {
    return null;
  }
}

function createDefaultBrowserAudioElement(): AudioElementLike {
  return new Audio();
}

export function createAudioSnippetController(
  initialOptions: AudioSnippetControllerOptions,
): AudioSnippetController {
  let targetId = initialOptions.targetId;
  let attempt = clampAttemptIndex(initialOptions.attempt);
  let explicitOffsetMs = initialOptions.snippetOffsetMs;
  let resolvedPreview: {
    targetId: string;
    previewUrl: string;
    snippetOffsetMs: number;
  } | null = null;

  let activeAudio: AudioElementLike | null = null;
  let activeAbortController: AbortController | null = null;
  let cutoffTimerId: ReturnType<typeof setTimeout> | null = null;
  let progressTimerId: ReturnType<typeof setInterval> | null = null;
  let cleanupListeners: (() => void) | null = null;

  const initialWindow = getSnippetWindowForAttempt(
    attempt,
    explicitOffsetMs ?? 0,
  );

  let state: AudioSnippetState = {
    status: "idle",
    error: null,
    elapsedMs: 0,
    durationMs: initialWindow.durationMs,
    snippetOffsetMs: initialWindow.startMs,
  };

  function emitState(patch: Partial<AudioSnippetState>): void {
    state = { ...state, ...patch };
    initialOptions.onStateChange?.(state);
  }

  function clearTimersAndListeners(): void {
    if (cutoffTimerId !== null) {
      clearTimeout(cutoffTimerId);
      cutoffTimerId = null;
    }
    if (progressTimerId !== null) {
      clearInterval(progressTimerId);
      progressTimerId = null;
    }
    if (cleanupListeners !== null) {
      cleanupListeners();
      cleanupListeners = null;
    }
  }

  function releaseActiveAudio(): void {
    clearTimersAndListeners();

    if (activeAbortController !== null) {
      activeAbortController.abort();
      activeAbortController = null;
    }

    if (activeAudio !== null) {
      try {
        activeAudio.pause();
        activeAudio.src = "";
        activeAudio.load?.();
      } catch {
        // Ignore cleanup errors on detached media elements.
      }
      activeAudio = null;
    }
  }

  function stop(): void {
    releaseActiveAudio();
    const currentWindow = getSnippetWindowForAttempt(
      attempt,
      explicitOffsetMs ?? resolvedPreview?.snippetOffsetMs ?? 0,
    );
    emitState({
      status: "idle",
      elapsedMs: 0,
      durationMs: currentWindow.durationMs,
      snippetOffsetMs: currentWindow.startMs,
    });
  }

  async function play(): Promise<void> {
    releaseActiveAudio();

    if (targetId === null || targetId.trim().length === 0) {
      emitState({
        status: "error",
        error: "Audio unavailable.",
        elapsedMs: 0,
      });
      return;
    }

    const currentTargetId = targetId.trim();

    // Safari and iOS require AudioContext creation/resume and Audio element creation
    // synchronously inside the user gesture before awaiting network requests.
    const audioContext = (
      initialOptions.getAudioContext ?? getDefaultBrowserAudioContext
    )();
    const audioElement = (
      initialOptions.createAudioElement ?? createDefaultBrowserAudioElement
    )();
    activeAudio = audioElement;

    const abortController = new AbortController();
    activeAbortController = abortController;

    const pendingWindow = getSnippetWindowForAttempt(
      attempt,
      explicitOffsetMs ?? resolvedPreview?.snippetOffsetMs ?? 0,
    );
    emitState({
      status: "loading",
      error: null,
      elapsedMs: 0,
      durationMs: pendingWindow.durationMs,
      snippetOffsetMs: pendingWindow.startMs,
    });

    try {
      if (audioContext !== null && audioContext.state === "suspended") {
        await audioContext.resume();
      }

      if (abortController.signal.aborted) {
        return;
      }

      if (
        resolvedPreview === null ||
        resolvedPreview.targetId !== currentTargetId
      ) {
        const fetchFn = initialOptions.fetchImpl ?? fetch;
        const response = await fetchFn(
          `/api/audio/${encodeURIComponent(currentTargetId)}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: abortController.signal,
          },
        );

        if (abortController.signal.aborted) {
          return;
        }

        if (!response.ok) {
          emitState({
            status: "error",
            error: "Unable to load audio preview.",
            elapsedMs: 0,
          });
          return;
        }

        const payload: unknown = await response.json();
        if (!isAudioPreviewResponse(payload)) {
          emitState({
            status: "error",
            error: "Invalid audio preview response.",
            elapsedMs: 0,
          });
          return;
        }

        resolvedPreview = {
          targetId: currentTargetId,
          previewUrl: payload.previewUrl.trim(),
          snippetOffsetMs: payload.snippetOffsetMs,
        };
      }

      if (abortController.signal.aborted || activeAudio !== audioElement) {
        return;
      }

      const effectiveOffsetMs =
        explicitOffsetMs ?? resolvedPreview.snippetOffsetMs;
      const snippetWindow = getSnippetWindowForAttempt(
        attempt,
        effectiveOffsetMs,
      );

      audioElement.preload = "auto";
      audioElement.src = resolvedPreview.previewUrl;
      try {
        audioElement.currentTime = snippetWindow.startTimeSec;
      } catch {
        // Some browsers defer currentTime assignment until metadata loads.
      }

      const onLoadedMetadata = (): void => {
        try {
          if (
            Math.abs(audioElement.currentTime - snippetWindow.startTimeSec) >
            0.05
          ) {
            audioElement.currentTime = snippetWindow.startTimeSec;
          }
        } catch {
          // Ignore seek errors before readyState.
        }
      };

      const onTimeUpdate = (): void => {
        const currentElapsedMs = Math.max(
          0,
          Math.round(
            (audioElement.currentTime - snippetWindow.startTimeSec) * 1000,
          ),
        );
        if (currentElapsedMs >= snippetWindow.durationMs) {
          stop();
          return;
        }
        emitState({
          elapsedMs: Math.min(currentElapsedMs, snippetWindow.durationMs),
        });
      };

      const onEnded = (): void => {
        stop();
      };

      const onError = (): void => {
        releaseActiveAudio();
        emitState({
          status: "error",
          error: "Audio playback failed.",
          elapsedMs: 0,
        });
      };

      audioElement.addEventListener?.("loadedmetadata", onLoadedMetadata);
      audioElement.addEventListener?.("timeupdate", onTimeUpdate);
      audioElement.addEventListener?.("ended", onEnded);
      audioElement.addEventListener?.("error", onError);

      cleanupListeners = () => {
        audioElement.removeEventListener?.("loadedmetadata", onLoadedMetadata);
        audioElement.removeEventListener?.("timeupdate", onTimeUpdate);
        audioElement.removeEventListener?.("ended", onEnded);
        audioElement.removeEventListener?.("error", onError);
      };

      await audioElement.play();

      if (abortController.signal.aborted || activeAudio !== audioElement) {
        return;
      }

      emitState({
        status: "playing",
        error: null,
        elapsedMs: 0,
        durationMs: snippetWindow.durationMs,
        snippetOffsetMs: snippetWindow.startMs,
      });

      cutoffTimerId = setTimeout(() => {
        stop();
      }, snippetWindow.durationMs);
    } catch {
      if (abortController.signal.aborted) {
        return;
      }
      releaseActiveAudio();
      emitState({
        status: "error",
        error: "Audio playback failed.",
        elapsedMs: 0,
      });
    }
  }

  async function toggle(): Promise<void> {
    if (state.status === "playing" || state.status === "loading") {
      stop();
      return;
    }
    await play();
  }

  async function retry(): Promise<void> {
    resolvedPreview = null;
    await play();
  }

  function setConfig(next: {
    targetId: string | null;
    attempt: number;
    snippetOffsetMs?: number;
  }): void {
    const targetChanged = next.targetId !== targetId;
    targetId = next.targetId;
    attempt = clampAttemptIndex(next.attempt);
    explicitOffsetMs = next.snippetOffsetMs;

    if (targetChanged) {
      resolvedPreview = null;
      stop();
      return;
    }

    const nextWindow = getSnippetWindowForAttempt(
      attempt,
      explicitOffsetMs ?? resolvedPreview?.snippetOffsetMs ?? 0,
    );
    emitState({
      durationMs: nextWindow.durationMs,
      snippetOffsetMs: nextWindow.startMs,
    });
  }

  function handleVisibilityChange(isHidden: boolean): void {
    if (isHidden && (state.status === "playing" || state.status === "loading")) {
      stop();
    }
  }

  function destroy(): void {
    releaseActiveAudio();
  }

  return {
    getState: () => state,
    setConfig,
    play,
    stop,
    toggle,
    retry,
    handleVisibilityChange,
    destroy,
  };
}

export interface UseAudioSnippetOptions {
  targetId: string | null;
  attempt: number;
  snippetOffsetMs?: number;
}

export interface UseAudioSnippetResult extends AudioSnippetState {
  play: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  retry: () => Promise<void>;
}

export function useAudioSnippet(
  options: UseAudioSnippetOptions,
): UseAudioSnippetResult {
  const { targetId, attempt, snippetOffsetMs } = options;
  const currentWindow = getSnippetWindowForAttempt(
    attempt,
    snippetOffsetMs ?? 0,
  );

  const [state, setState] = useState<AudioSnippetState>(() => ({
    status: "idle",
    error: null,
    elapsedMs: 0,
    durationMs: currentWindow.durationMs,
    snippetOffsetMs: currentWindow.startMs,
  }));

  const controllerRef = useRef<AudioSnippetController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createAudioSnippetController({
      targetId,
      attempt,
      snippetOffsetMs,
      onStateChange: (nextState) => {
        setState(nextState);
      },
    });
  }

  useEffect(() => {
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }

    controller.setConfig({ targetId, attempt, snippetOffsetMs });
  }, [targetId, attempt, snippetOffsetMs]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (controller === null || typeof document === "undefined") {
      return;
    }

    const onVisibilityChange = (): void => {
      controller.handleVisibilityChange(
        document.visibilityState === "hidden" || document.hidden,
      );
    };

    const onPageHide = (): void => {
      controller.stop();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("popstate", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("popstate", onPageHide);
      controller.destroy();
    };
  }, []);

  return {
    status: state.status,
    error: state.error,
    elapsedMs: state.elapsedMs,
    durationMs: state.durationMs,
    snippetOffsetMs: state.snippetOffsetMs,
    play: () => controllerRef.current?.play() ?? Promise.resolve(),
    stop: () => controllerRef.current?.stop(),
    toggle: () => controllerRef.current?.toggle() ?? Promise.resolve(),
    retry: () => controllerRef.current?.retry() ?? Promise.resolve(),
  };
}
