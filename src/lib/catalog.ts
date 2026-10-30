import fs from "node:fs";
import path from "node:path";
import {
  MAX_PREVIEW_DURATION_MS,
  MIN_DAILY_ELIGIBLE_TRACKS,
  SNIPPET_DURATIONS_MS,
  type AudioProvider,
  type GenreNode,
  type Track,
} from "../types/catalog.ts";

export interface CatalogData {
  genres: readonly GenreNode[];
  tracks: readonly Track[];
}

const GENRE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

const MAX_SNIPPET_DURATION_MS =
  SNIPPET_DURATIONS_MS[SNIPPET_DURATIONS_MS.length - 1] ?? 16000;

const DEFAULT_GENRES_DIR = path.join(process.cwd(), "src", "data", "genres");
const DEFAULT_TRACKS_DIR = path.join(process.cwd(), "src", "data", "tracks");

let cachedCatalog: CatalogData | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAudioProvider(value: unknown): value is AudioProvider {
  return value === "deezer" || value === "itunes";
}

function stripDiacriticsForSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/gi, "o")
    .replace(/ł/gi, "l")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe");
}

export function slugifyTrackId(artist: string, title: string): string {
  const combined = `${artist} ${title}`;
  const slug = stripDiacriticsForSlug(combined)
    .toLowerCase()
    .replace(/[&+]/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new Error("Cannot generate track slug from empty artist and title.");
  }

  return slug;
}

export function isValidGenreId(id: string): boolean {
  return GENRE_ID_PATTERN.test(id);
}

function validateGenreNodeInternal(
  raw: unknown,
  parentId: string | undefined,
  seenIds: Set<string>,
): GenreNode {
  if (!isRecord(raw)) {
    throw new Error("Genre node must be a JSON object.");
  }

  const { id, name, emoji, aliases, children } = raw;

  if (typeof id !== "string" || !isValidGenreId(id)) {
    throw new Error(`Invalid genre ID: ${String(id)}`);
  }

  if (parentId === undefined) {
    if (id.includes(".")) {
      throw new Error(`Root genre ID "${id}" must not contain dots.`);
    }
  } else {
    if (!id.startsWith(`${parentId}.`)) {
      throw new Error(`Child genre ID "${id}" must start with parent prefix "${parentId}."`);
    }
    const suffix = id.slice(parentId.length + 1);
    if (suffix.includes(".")) {
      throw new Error(
        `Child genre ID "${id}" must be exactly one level deeper than parent "${parentId}".`,
      );
    }
  }

  if (seenIds.has(id)) {
    throw new Error(`Duplicate genre ID "${id}".`);
  }
  seenIds.add(id);

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(`Genre "${id}" must have a non-empty name.`);
  }

  const node: GenreNode = {
    id,
    name: name.trim(),
  };

  if (emoji !== undefined) {
    if (typeof emoji !== "string" || emoji.trim().length === 0) {
      throw new Error(`Genre "${id}" has an invalid emoji value.`);
    }
    node.emoji = emoji;
  }

  if (aliases !== undefined) {
    if (
      !Array.isArray(aliases) ||
      !aliases.every((item): item is string => typeof item === "string" && item.trim().length > 0)
    ) {
      throw new Error(`Genre "${id}" aliases must be an array of non-empty strings.`);
    }
    node.aliases = aliases.map((alias) => alias.trim());
  }

  if (children !== undefined) {
    if (!Array.isArray(children)) {
      throw new Error(`Genre "${id}" children must be an array.`);
    }
    node.children = children.map((child) => validateGenreNodeInternal(child, id, seenIds));
  }

  return node;
}

export function validateGenreNode(raw: unknown, parentId?: string): GenreNode {
  return validateGenreNodeInternal(raw, parentId, new Set<string>());
}

export function validateTrack(raw: unknown): Track {
  if (!isRecord(raw)) {
    throw new Error("Track entry must be a JSON object.");
  }

  const { id, title, artist, genreId, provider, providerTrackId, snippetOffsetMs } = raw;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Track must have a non-empty string id.");
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error(`Track "${id}" must have a non-empty title.`);
  }

  if (typeof artist !== "string" || artist.trim().length === 0) {
    throw new Error(`Track "${id}" must have a non-empty artist.`);
  }

  if (typeof genreId !== "string" || !isValidGenreId(genreId)) {
    throw new Error(`Track "${id}" has an invalid genreId: ${String(genreId)}`);
  }

  if (!isAudioProvider(provider)) {
    throw new Error(`Track "${id}" has an unsupported provider: ${String(provider)}`);
  }

  if (typeof providerTrackId !== "string" || providerTrackId.trim().length === 0) {
    throw new Error(`Track "${id}" must have a non-empty providerTrackId.`);
  }

  if (/^https?:\/\//i.test(providerTrackId.trim())) {
    throw new Error(
      `Track "${id}" providerTrackId must be a provider ID, not a hardcoded URL.`,
    );
  }

  const track: Track = {
    id: id.trim(),
    title: title.trim(),
    artist: artist.trim(),
    genreId,
    provider,
    providerTrackId: providerTrackId.trim(),
  };

  if (snippetOffsetMs !== undefined) {
    if (
      typeof snippetOffsetMs !== "number" ||
      !Number.isFinite(snippetOffsetMs) ||
      snippetOffsetMs < 0 ||
      snippetOffsetMs + MAX_SNIPPET_DURATION_MS > MAX_PREVIEW_DURATION_MS
    ) {
      throw new Error(
        `Track "${id}" has an invalid snippetOffsetMs (${String(snippetOffsetMs)}).`,
      );
    }
    track.snippetOffsetMs = snippetOffsetMs;
  }

  return track;
}

export function validateTrackList(raw: unknown): Track[] {
  if (!Array.isArray(raw)) {
    throw new Error("Track catalog file must contain a JSON array of tracks.");
  }

  return raw.map((entry) => validateTrack(entry));
}

function listJsonFiles(directoryPath: string): string[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => path.join(directoryPath, fileName));
}

export function loadGenresFromDisk(genresDir: string = DEFAULT_GENRES_DIR): GenreNode[] {
  const files = listJsonFiles(genresDir);
  const genres: GenreNode[] = [];
  const seenIds = new Set<string>();

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(content);
    genres.push(validateGenreNodeInternal(parsed, undefined, seenIds));
  }

  return genres;
}

export function loadTracksFromDisk(tracksDir: string = DEFAULT_TRACKS_DIR): Track[] {
  const files = listJsonFiles(tracksDir);
  const tracks: Track[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(content);
    tracks.push(...validateTrackList(parsed));
  }

  return tracks;
}

export function getCatalog(catalog?: CatalogData): CatalogData {
  if (catalog !== undefined) {
    return catalog;
  }

  if (cachedCatalog === null) {
    cachedCatalog = {
      genres: loadGenresFromDisk(),
      tracks: loadTracksFromDisk(),
    };
  }

  return cachedCatalog;
}

export function resetCatalogCache(nextCatalog: CatalogData | null = null): void {
  cachedCatalog = nextCatalog;
}

export function getAllGenres(catalog?: CatalogData): GenreNode[] {
  return [...getCatalog(catalog).genres];
}

function collectGenreNodes(nodes: readonly GenreNode[], accumulator: GenreNode[]): void {
  for (const node of nodes) {
    accumulator.push(node);
    if (node.children !== undefined) {
      collectGenreNodes(node.children, accumulator);
    }
  }
}

export function getAllGenreNodes(catalog?: CatalogData): GenreNode[] {
  const nodes: GenreNode[] = [];
  collectGenreNodes(getCatalog(catalog).genres, nodes);
  return nodes;
}

export function getMicroGenreNodes(catalog?: CatalogData): GenreNode[] {
  return getAllGenreNodes(catalog).filter(
    (node) => node.children === undefined || node.children.length === 0,
  );
}

export function getDailyEligibleChannels(catalog?: CatalogData): GenreNode[] {
  const resolved = getCatalog(catalog);
  return getAllGenreNodes(resolved).filter((node) =>
    isDailyEligibleChannel(node.id, resolved),
  );
}

function findNodeInTree(nodes: readonly GenreNode[], targetId: string): GenreNode | undefined {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }
    if (node.children !== undefined) {
      const match = findNodeInTree(node.children, targetId);
      if (match !== undefined) {
        return match;
      }
    }
  }
  return undefined;
}

export function getGenreById(genreId: string, catalog?: CatalogData): GenreNode | undefined {
  if (!isValidGenreId(genreId)) {
    return undefined;
  }

  return findNodeInTree(getCatalog(catalog).genres, genreId);
}

function collectNodeIds(node: GenreNode, accumulator: string[]): void {
  accumulator.push(node.id);
  if (node.children !== undefined) {
    for (const child of node.children) {
      collectNodeIds(child, accumulator);
    }
  }
}

export function getDescendantGenreIds(
  genreId: string,
  catalog?: CatalogData,
): string[] {
  const node = getGenreById(genreId, catalog);
  if (node === undefined) {
    return [];
  }

  const ids: string[] = [];
  collectNodeIds(node, ids);
  return ids;
}

export function getTracksForChannel(
  channelId: string,
  catalog?: CatalogData,
): Track[] {
  const resolved = getCatalog(catalog);
  const targetGenreIds = new Set(getDescendantGenreIds(channelId, resolved));
  if (targetGenreIds.size === 0) {
    return [];
  }

  const seenTrackIds = new Set<string>();
  const seenProviderKeys = new Set<string>();
  const result: Track[] = [];

  for (const track of resolved.tracks) {
    if (!targetGenreIds.has(track.genreId)) {
      continue;
    }

    const providerKey = `${track.provider}:${track.providerTrackId}`;
    if (seenTrackIds.has(track.id) || seenProviderKeys.has(providerKey)) {
      continue;
    }

    seenTrackIds.add(track.id);
    seenProviderKeys.add(providerKey);
    result.push(track);
  }

  return result;
}

export function getTrackById(
  trackId: string,
  catalog?: CatalogData,
): Track | undefined {
  if (trackId.trim().length === 0) {
    return undefined;
  }

  return getCatalog(catalog).tracks.find((track) => track.id === trackId);
}

export function isDailyEligibleChannel(
  channelId: string,
  catalog?: CatalogData,
): boolean {
  const genre = getGenreById(channelId, catalog);
  if (genre === undefined) {
    return false;
  }

  return getTracksForChannel(channelId, catalog).length >= MIN_DAILY_ELIGIBLE_TRACKS;
}
