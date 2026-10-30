import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getAllGenreNodes,
  getCatalog,
  getGenreById,
  getMicroGenreNodes,
  getTracksForChannel,
  isValidGenreId,
  loadGenresFromDisk,
  loadTracksFromDisk,
  slugifyTrackId,
  validateTrack,
  validateTrackList,
} from "../src/lib/catalog.ts";
import {
  MIN_DAILY_ELIGIBLE_TRACKS,
  type AudioProvider,
  type Track,
} from "../src/types/catalog.ts";

export const CLI_FETCH_TIMEOUT_MS = 5000;
export const DEFAULT_SEARCH_LIMIT = 30;
export const MAX_SEARCH_LIMIT = 100;

export const DEFAULT_GENRE_SEED_QUERIES: Readonly<Record<string, readonly string[]>> = {
  "pop.mainstream.dance-pop": ["Dua Lipa", "Lady Gaga", "Kylie Minogue", "Rihanna", "Calvin Harris"],
  "pop.mainstream.2000s-2010s-pop": ["Britney Spears", "Katy Perry", "Justin Timberlake", "Bruno Mars", "Ariana Grande"],
  "pop.mainstream.80s-90s-pop": ["Michael Jackson", "Madonna", "Whitney Houston", "George Michael", "Mariah Carey"],
  "pop.indie-alt.synth-pop": ["The Weeknd", "Chvrches", "Depeche Mode", "New Order", "Charli XCX"],
  "pop.indie-alt.indie-pop": ["Lorde", "Vampire Weekend", "Foster the People", "MGMT", "Phoenix"],
  "pop.indie-alt.bedroom-pop": ["Clairo", "beabadoobee", "Rex Orange County", "Boy Pablo", "Men I Trust"],
  "pop.indie-alt.art-pop": ["Bjork", "Kate Bush", "FKA twigs", "Caroline Polachek", "St. Vincent"],

  "hip-hop.golden-era.90s-east-coast": ["Nas", "The Notorious B.I.G.", "Wu-Tang Clan", "A Tribe Called Quest", "Mobb Deep"],
  "hip-hop.golden-era.90s-west-coast": ["2Pac", "Dr. Dre", "Snoop Dogg", "Ice Cube", "Warren G"],
  "hip-hop.golden-era.boom-bap": ["MF DOOM", "Gang Starr", "J Dilla", "KRS-One", "Joey Bada$$"],
  "hip-hop.modern-rap.trap": ["Future", "Travis Scott", "Metro Boomin", "21 Savage", "Young Thug"],
  "hip-hop.modern-rap.melodic-rap": ["Juice WRLD", "Lil Uzi Vert", "Post Malone", "Rod Wave", "Polo G"],
  "hip-hop.modern-rap.uk-drill": ["Central Cee", "Pop Smoke", "Headie One", "Dave", "Digga D"],
  "hip-hop.modern-rap.cloud-rap": ["Yung Lean", "Bladee", "Playboi Carti", "A$AP Rocky", "Yeat"],
  "hip-hop.rnb.contemporary-rnb": ["SZA", "Frank Ocean", "Daniel Caesar", "Summer Walker", "Brent Faiyaz"],
  "hip-hop.rnb.90s-2000s-rnb": ["Usher", "Alicia Keys", "Destiny's Child", "TLC", "Aaliyah"],
  "hip-hop.rnb.neo-soul": ["Erykah Badu", "D'Angelo", "Lauryn Hill", "Jill Scott", "Anderson .Paak"],

  "rock.mainstream.classic-rock": ["Queen", "Led Zeppelin", "Fleetwood Mac", "The Rolling Stones", "AC/DC"],
  "rock.mainstream.alternative-rock": ["Radiohead", "Red Hot Chili Peppers", "Foo Fighters", "The Killers", "Linkin Park"],
  "rock.mainstream.pop-punk": ["blink-182", "Green Day", "Paramore", "Fall Out Boy", "My Chemical Romance"],
  "rock.mainstream.grunge": ["Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains", "Stone Temple Pilots"],
  "rock.indie-underground.indie-rock": ["Arctic Monkeys", "The Strokes", "Interpol", "Yeah Yeah Yeahs", "Modest Mouse"],
  "rock.indie-underground.post-punk": ["Joy Division", "The Cure", "Siouxsie and the Banshees", "Molchat Doma", "Fontaines D.C."],
  "rock.indie-underground.midwest-emo": ["American Football", "Modern Baseball", "Hot Mulligan", "Mom Jeans.", "Sunny Day Real Estate"],
  "rock.indie-underground.shoegaze": ["My Bloody Valentine", "Slowdive", "Cocteau Twins", "Lush", "Deftones"],
  "rock.indie-underground.math-rock": ["Polyphia", "toe", "CHON", "tricot", "Battles"],
  "rock.heavy.hard-rock-metal": ["Metallica", "Iron Maiden", "Black Sabbath", "System of a Down", "Slipknot"],
  "rock.heavy.metalcore": ["Bring Me The Horizon", "Architects", "Killswitch Engage", "Spiritbox", "Parkway Drive"],

  "electronic.club-dance.house": ["Disclosure", "Fred again..", "Kaytranada", "Peggy Gou", "Duke Dumont"],
  "electronic.club-dance.techno": ["Charlotte de Witte", "Amelie Lens", "Adam Beyer", "Bicep", "Gesaffelstein"],
  "electronic.club-dance.edm-festival": ["Avicii", "Martin Garrix", "Swedish House Mafia", "Zedd", "Skrillex"],
  "electronic.club-dance.drum-and-bass": ["Sub Focus", "Pendulum", "Chase & Status", "Wilkinson", "Netsky"],
  "electronic.club-dance.uk-garage": ["Craig David", "MJ Cole", "Sammy Virji", "PinkPantheress", "Conducta"],
  "electronic.underground.hyperpop": ["100 gecs", "SOPHIE", "glaive", "aldn", "underscores"],
  "electronic.underground.glitchcore": ["ericdoa", "midwxst", "osquinn", "twikipedia", "brakence"],
  "electronic.underground.breakcore": ["Venetian Snares", "Machine Girl", "Sewerslvt", "Iglooghost", "Squarepusher"],
  "electronic.underground.drift-phonk": ["Kordhell", "PlayaPhonk", "DVRST", "Hensonn", "Interworld"],
  "electronic.chill-retro.vaporwave": ["Kavinsky", "HOME", "Carpenter Brut", "The Midnight", "Gunship"],
  "electronic.chill-retro.future-funk": ["Daft Punk", "Justice", "Yung Bae", "Macross 82-99", "Parcels"],
  "electronic.chill-retro.ambient": ["Aphex Twin", "Brian Eno", "Boards of Canada", "Tycho", "Four Tet"],

  "latin.urbano.reggaeton": ["Bad Bunny", "Daddy Yankee", "Feid", "Karol G", "J Balvin"],
  "latin.urbano.latin-pop": ["Shakira", "Rosalia", "Rauw Alejandro", "Kali Uchis", "Luis Miguel"],
  "latin.urbano.latin-trap": ["Anuel AA", "Eladio Carrion", "Bryant Myers", "Young Miko", "Myke Towers"],
  "latin.urbano.baile-funk": ["Anitta", "Ludmilla", "MC Kevin o Chris", "Pedro Sampaio", "MC Hariel"],
  "latin.tropical.bachata": ["Romeo Santos", "Aventura", "Prince Royce", "Juan Luis Guerra", "Monchy & Alexandra"],
  "latin.tropical.salsa": ["Marc Anthony", "Hector Lavoe", "Willie Colon", "Celia Cruz", "Grupo Niche"],
  "latin.tropical.cumbia": ["Los Angeles Azules", "Selena", "Grupo Frontera", "Rombai", "Damas Gratis"],
  "latin.regional-mexican.corridos-tumbados": ["Peso Pluma", "Natanael Cano", "Junior H", "Fuerza Regida", "Eslabon Armado"],

  "country.mainstream.contemporary-country": ["Morgan Wallen", "Luke Combs", "Chris Stapleton", "Zach Bryan", "Lainey Wilson"],
  "country.mainstream.classic-country": ["Johnny Cash", "Dolly Parton", "Willie Nelson", "George Strait", "Garth Brooks"],
  "country.mainstream.country-pop": ["Shania Twain", "Kacey Musgraves", "Carrie Underwood", "Keith Urban", "The Chicks"],
  "country.roots-folk.americana": ["Jason Isbell", "Tyler Childers", "Sturgill Simpson", "Brandi Carlile", "Wilco"],
  "country.roots-folk.indie-folk": ["Bon Iver", "Phoebe Bridgers", "Fleet Foxes", "Hozier", "Sufjan Stevens"],
  "country.roots-folk.bluegrass": ["Billy Strings", "Alison Krauss", "Nickel Creek", "Old Crow Medicine Show", "Trampled by Turtles"],

  "soul-jazz.soul-funk.classic-soul": ["Stevie Wonder", "Aretha Franklin", "Marvin Gaye", "Otis Redding", "Al Green"],
  "soul-jazz.soul-funk.funk-disco": ["Earth, Wind & Fire", "Parliament", "Chic", "James Brown", "Donna Summer"],
  "soul-jazz.soul-funk.blues": ["B.B. King", "Muddy Waters", "Stevie Ray Vaughan", "Gary Clark Jr.", "Etta James"],
  "soul-jazz.jazz.classic-jazz": ["Miles Davis", "John Coltrane", "Bill Evans", "Nina Simone", "Chet Baker"],
  "soul-jazz.jazz.lofi-jazz-hop": ["Nujabes", "Tom Misch", "Robert Glasper", "Kamasi Washington", "Alfa Mist"],

  "global.east-asian.k-pop": ["NewJeans", "BTS", "BLACKPINK", "TWICE", "Stray Kids"],
  "global.east-asian.j-rock": ["ONE OK ROCK", "King Gnu", "YOASOBI", "Kenshi Yonezu", "Asian Kung-Fu Generation"],
  "global.east-asian.city-pop": ["Mariya Takeuchi", "Anri", "Miki Matsubara", "Tatsuro Yamashita", "Taeko Onuki"],
  "global.african.afrobeats": ["Burna Boy", "Wizkid", "Rema", "Tems", "Davido"],
  "global.african.amapiano": ["Tyla", "Kabza De Small", "DJ Maphorisa", "Focalistic", "Uncle Waffles"],
  "global.caribbean.reggae": ["Bob Marley & The Wailers", "Chronixx", "Protoje", "Damian Marley", "Toots and the Maytals"],
  "global.caribbean.dancehall": ["Sean Paul", "Vybz Kartel", "Shaggy", "Popcaan", "Beenie Man"],
};

export interface CatalogCliArgs {
  genreId?: string;
  query?: string;
  artist?: string;
  track?: string;
  playlistId?: string;
  provider: AudioProvider;
  limit: number;
  fileName?: string;
  dryRun: boolean;
  listGenres: boolean;
  seed: boolean;
  help: boolean;
}

export interface SearchTracksOptions {
  genreId: string;
  query?: string;
  artist?: string;
  track?: string;
  playlistId?: string;
  provider?: AudioProvider;
  limit?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AppendCatalogOptions {
  tracksDir?: string;
  genresDir?: string;
  fileName?: string;
  dryRun?: boolean;
}

export interface AppendCatalogResult {
  filePath: string;
  added: Track[];
  skippedDuplicates: number;
  totalInFile: number;
}

export interface SeedCatalogOptions {
  genreFilter?: string;
  targetPerMicroGenre?: number;
  perQueryLimit?: number;
  provider?: AudioProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  tracksDir?: string;
  genresDir?: string;
  dryRun?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

function sanitizeMetadataText(value: string): string {
  return value.replace(/\u2014/g, "-").trim();
}

export function parseCatalogCliArgs(argv: readonly string[]): CatalogCliArgs {
  const args: CatalogCliArgs = {
    provider: "deezer",
    limit: DEFAULT_SEARCH_LIMIT,
    dryRun: false,
    listGenres: false,
    seed: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) {
      continue;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (token === "--list-genres") {
      args.listGenres = true;
      continue;
    }

    if (token === "--seed") {
      args.seed = true;
      continue;
    }

    const nextValue = argv[i + 1];

    if (token === "--genre" || token === "-g") {
      if (nextValue === undefined || nextValue.startsWith("-")) {
        throw new Error("Missing value for --genre.");
      }
      args.genreId = nextValue.trim();
      i++;
      continue;
    }

    if (token === "--query" || token === "-q") {
      if (nextValue === undefined || nextValue.startsWith("-")) {
        throw new Error("Missing value for --query.");
      }
      args.query = nextValue.trim();
      i++;
      continue;
    }

    if (token === "--artist" || token === "-a") {
      if (nextValue === undefined || nextValue.startsWith("-")) {
        throw new Error("Missing value for --artist.");
      }
      args.artist = nextValue.trim();
      i++;
      continue;
    }

    if (token === "--track" || token === "-t") {
      if (nextValue === undefined || nextValue.startsWith("-")) {
        throw new Error("Missing value for --track.");
      }
      args.track = nextValue.trim();
      i++;
      continue;
    }

    if (token === "--playlist" || token === "-p") {
      if (nextValue === undefined || nextValue.startsWith("-")) {
        throw new Error("Missing value for --playlist.");
      }
      args.playlistId = nextValue.trim();
      i++;
      continue;
    }

    if (token === "--provider") {
      if (nextValue !== "deezer" && nextValue !== "itunes") {
        throw new Error('Invalid --provider value. Expected "deezer" or "itunes".');
      }
      args.provider = nextValue;
      i++;
      continue;
    }

    if (token === "--limit" || token === "-l") {
      const parsedLimit = Number(nextValue);
      if (
        nextValue === undefined ||
        !Number.isInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > MAX_SEARCH_LIMIT
      ) {
        throw new Error(`Invalid --limit value. Expected an integer between 1 and ${MAX_SEARCH_LIMIT}.`);
      }
      args.limit = parsedLimit;
      i++;
      continue;
    }

    if (token === "--file" || token === "-f") {
      if (nextValue === undefined || nextValue.startsWith("-")) {
        throw new Error("Missing value for --file.");
      }
      args.fileName = nextValue.trim();
      i++;
      continue;
    }

    throw new Error(`Unknown CLI argument: ${token}`);
  }

  return args;
}

export function buildSearchQuery(options: {
  query?: string;
  artist?: string;
  track?: string;
}): string {
  const parts: string[] = [];
  if (options.query !== undefined && options.query.trim().length > 0) {
    parts.push(options.query.trim());
  }
  if (options.artist !== undefined && options.artist.trim().length > 0) {
    parts.push(options.artist.trim());
  }
  if (options.track !== undefined && options.track.trim().length > 0) {
    parts.push(options.track.trim());
  }

  const combined = parts.join(" ").trim();
  if (combined.length === 0) {
    throw new Error(
      "Provide at least one search filter (--query, --artist, --track, or --playlist).",
    );
  }

  return combined;
}

async function fetchJsonWithTimeout(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = CLI_FETCH_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Provider request failed with status ${response.status}`);
    }

    const parsed: unknown = await response.json();
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseDeezerTrackCandidates(
  payload: unknown,
  genreId: string,
): Track[] {
  if (!isRecord(payload)) {
    return [];
  }

  if ("error" in payload && payload.error !== undefined && payload.error !== null) {
    return [];
  }

  const rawItems: unknown[] = Array.isArray(payload.data)
    ? payload.data
    : isRecord(payload.tracks) && Array.isArray(payload.tracks.data)
      ? payload.tracks.data
      : [];

  const tracks: Track[] = [];

  for (const item of rawItems) {
    if (!isRecord(item)) {
      continue;
    }

    const rawId = item.id;
    const providerTrackId =
      typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : typeof rawId === "string"
          ? rawId.trim()
          : "";

    const title =
      typeof item.title_short === "string" && item.title_short.trim().length > 0
        ? sanitizeMetadataText(item.title_short)
        : typeof item.title === "string"
          ? sanitizeMetadataText(item.title)
          : "";

    const artist =
      isRecord(item.artist) && typeof item.artist.name === "string"
        ? sanitizeMetadataText(item.artist.name)
        : "";

    if (
      providerTrackId.length === 0 ||
      title.length === 0 ||
      artist.length === 0 ||
      !isValidHttpUrl(item.preview)
    ) {
      continue;
    }

    try {
      const slugId = slugifyTrackId(artist, title);
      tracks.push(
        validateTrack({
          id: slugId,
          title,
          artist,
          genreId,
          provider: "deezer",
          providerTrackId,
        }),
      );
    } catch {
      continue;
    }
  }

  return tracks;
}

export function parseItunesTrackCandidates(
  payload: unknown,
  genreId: string,
): Track[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return [];
  }

  const tracks: Track[] = [];

  for (const item of payload.results) {
    if (!isRecord(item)) {
      continue;
    }

    const rawId = item.trackId;
    const providerTrackId =
      typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : typeof rawId === "string"
          ? rawId.trim()
          : "";

    const title = typeof item.trackName === "string" ? sanitizeMetadataText(item.trackName) : "";
    const artist = typeof item.artistName === "string" ? sanitizeMetadataText(item.artistName) : "";

    if (
      providerTrackId.length === 0 ||
      title.length === 0 ||
      artist.length === 0 ||
      !isValidHttpUrl(item.previewUrl)
    ) {
      continue;
    }

    try {
      const slugId = slugifyTrackId(artist, title);
      tracks.push(
        validateTrack({
          id: slugId,
          title,
          artist,
          genreId,
          provider: "itunes",
          providerTrackId,
        }),
      );
    } catch {
      continue;
    }
  }

  return tracks;
}

export async function searchCatalogTracks(
  options: SearchTracksOptions,
): Promise<Track[]> {
  const {
    genreId,
    playlistId,
    provider = "deezer",
    limit = DEFAULT_SEARCH_LIMIT,
    fetchImpl = fetch,
    timeoutMs = CLI_FETCH_TIMEOUT_MS,
  } = options;

  if (!isValidGenreId(genreId)) {
    throw new Error(`Invalid genreId "${genreId}".`);
  }

  const boundedLimit = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);

  if (playlistId !== undefined && playlistId.trim().length > 0) {
    if (provider !== "deezer") {
      throw new Error("Playlist seeding is only supported with the Deezer provider.");
    }
    const url = `https://api.deezer.com/playlist/${encodeURIComponent(playlistId.trim())}/tracks?limit=${boundedLimit}`;
    const payload = await fetchJsonWithTimeout(url, fetchImpl, timeoutMs);
    return parseDeezerTrackCandidates(payload, genreId).slice(0, boundedLimit);
  }

  const searchTerm = buildSearchQuery(options);

  if (provider === "deezer") {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(searchTerm)}&limit=${boundedLimit}`;
    const payload = await fetchJsonWithTimeout(url, fetchImpl, timeoutMs);
    return parseDeezerTrackCandidates(payload, genreId).slice(0, boundedLimit);
  }

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&entity=song&limit=${boundedLimit}`;
  const payload = await fetchJsonWithTimeout(url, fetchImpl, timeoutMs);
  return parseItunesTrackCandidates(payload, genreId).slice(0, boundedLimit);
}

export function mergeAndDeduplicateTracks(
  existingTracks: readonly Track[],
  incomingTracks: readonly Track[],
  channelExistingTracks: readonly Track[] = existingTracks,
): { merged: Track[]; added: Track[]; skippedDuplicates: number } {
  const seenIds = new Set<string>();
  const seenProviderIds = new Set<string>();

  for (const track of channelExistingTracks) {
    seenIds.add(track.id);
    seenProviderIds.add(track.providerTrackId);
  }

  for (const track of existingTracks) {
    seenIds.add(track.id);
    seenProviderIds.add(track.providerTrackId);
  }

  const merged: Track[] = [...existingTracks];
  const added: Track[] = [];
  let skippedDuplicates = 0;

  for (const candidate of incomingTracks) {
    const validated = validateTrack(candidate);
    if (
      seenIds.has(validated.id) ||
      seenProviderIds.has(validated.providerTrackId)
    ) {
      skippedDuplicates++;
      continue;
    }

    seenIds.add(validated.id);
    seenProviderIds.add(validated.providerTrackId);
    merged.push(validated);
    added.push(validated);
  }

  return { merged, added, skippedDuplicates };
}

export function resolveOutputTrackFilePath(
  genreId: string,
  tracksDir: string,
  explicitFileName?: string,
): string {
  if (explicitFileName !== undefined && explicitFileName.trim().length > 0) {
    const cleaned = path.basename(explicitFileName.trim());
    const withExtension = cleaned.endsWith(".json") ? cleaned : `${cleaned}.json`;
    return path.join(tracksDir, withExtension);
  }

  return path.join(tracksDir, `${genreId}.json`);
}

export function appendTracksToCatalogFile(
  genreId: string,
  incomingTracks: readonly Track[],
  options?: AppendCatalogOptions,
): AppendCatalogResult {
  const genresDir =
    options?.genresDir ?? path.join(process.cwd(), "src", "data", "genres");
  const tracksDir =
    options?.tracksDir ?? path.join(process.cwd(), "src", "data", "tracks");

  const genres = loadGenresFromDisk(genresDir);
  const allExistingTracks = loadTracksFromDisk(tracksDir);
  const catalog = getCatalog({ genres, tracks: allExistingTracks });

  const genreNode = getGenreById(genreId, catalog);
  if (genreNode === undefined) {
    throw new Error(
      `Genre "${genreId}" does not exist in ${genresDir}. Run with --list-genres to view valid genre IDs.`,
    );
  }

  const filePath = resolveOutputTrackFilePath(genreId, tracksDir, options?.fileName);
  let fileExistingTracks: Track[] = [];

  if (fs.existsSync(filePath)) {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(rawContent);
    fileExistingTracks = validateTrackList(parsed);
  }

  const rootGenreId = genreId.split(".")[0] ?? genreId;
  const channelTracks = getTracksForChannel(rootGenreId, catalog);

  const { merged, added, skippedDuplicates } = mergeAndDeduplicateTracks(
    fileExistingTracks,
    incomingTracks,
    [...allExistingTracks, ...channelTracks],
  );

  if (!options?.dryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  }

  return {
    filePath,
    added,
    skippedDuplicates,
    totalInFile: merged.length,
  };
}

export async function seedCatalogGenres(
  options?: SeedCatalogOptions,
): Promise<{ totalAdded: number; genresSeeded: number }> {
  const genresDir =
    options?.genresDir ?? path.join(process.cwd(), "src", "data", "genres");
  const tracksDir =
    options?.tracksDir ?? path.join(process.cwd(), "src", "data", "tracks");
  const targetPerMicroGenre =
    options?.targetPerMicroGenre ?? MIN_DAILY_ELIGIBLE_TRACKS;
  const perQueryLimit = options?.perQueryLimit ?? 10;
  const primaryProvider: AudioProvider = options?.provider ?? "deezer";
  const fallbackProvider: AudioProvider =
    primaryProvider === "deezer" ? "itunes" : "deezer";

  const genres = loadGenresFromDisk(genresDir);
  const microGenres = getMicroGenreNodes({ genres, tracks: [] }).filter((node) => {
    if (options?.genreFilter === undefined || options.genreFilter.length === 0) {
      return true;
    }
    return (
      node.id === options.genreFilter ||
      node.id.startsWith(`${options.genreFilter}.`)
    );
  });

  if (microGenres.length === 0) {
    throw new Error(
      `No matching micro-genres found for "${options?.genreFilter ?? ""}".`,
    );
  }

  let totalAdded = 0;
  let genresSeeded = 0;

  for (const microGenre of microGenres) {
    const existingTracks = loadTracksFromDisk(tracksDir);
    const currentPool = getTracksForChannel(microGenre.id, {
      genres,
      tracks: existingTracks,
    });

    if (currentPool.length >= targetPerMicroGenre) {
      continue;
    }

    const baseQueries = DEFAULT_GENRE_SEED_QUERIES[microGenre.id] ?? [];
    const fallbackQueries = [microGenre.name, ...(microGenre.aliases ?? [])];
    const queries = Array.from(new Set([...baseQueries, ...fallbackQueries]));

    const rootGenreId = microGenre.id.split(".")[0] ?? microGenre.id;
    let addedForMicro = 0;

    for (const query of queries) {
      const latestTracks = loadTracksFromDisk(tracksDir);
      const latestPool = getTracksForChannel(microGenre.id, {
        genres,
        tracks: latestTracks,
      });

      if (latestPool.length >= targetPerMicroGenre && queries.indexOf(query) >= baseQueries.length) {
        break;
      }

      let batch: Track[] = [];
      try {
        batch = await searchCatalogTracks({
          genreId: microGenre.id,
          query,
          provider: primaryProvider,
          limit: perQueryLimit,
          fetchImpl: options?.fetchImpl,
          timeoutMs: options?.timeoutMs,
        });
      } catch {
        batch = [];
      }

      if (batch.length === 0) {
        try {
          batch = await searchCatalogTracks({
            genreId: microGenre.id,
            query,
            provider: fallbackProvider,
            limit: perQueryLimit,
            fetchImpl: options?.fetchImpl,
            timeoutMs: options?.timeoutMs,
          });
        } catch {
          batch = [];
        }
      }

      if (batch.length > 0) {
        const result = appendTracksToCatalogFile(microGenre.id, batch, {
          genresDir,
          tracksDir,
          fileName: `${rootGenreId}.json`,
          dryRun: options?.dryRun,
        });
        addedForMicro += result.added.length;
      }
    }

    if (addedForMicro > 0) {
      totalAdded += addedForMicro;
      genresSeeded++;
    }
  }

  return { totalAdded, genresSeeded };
}

export function formatCliUsage(): string {
  return [
    "Usage: npm run catalog:add -- [options]",
    "",
    "Options:",
    "  --genre, -g <genreId>       Target genre ID from src/data/genres/*.json",
    "  --query, -q <text>          General search query",
    "  --artist, -a <name>         Artist name filter",
    "  --track, -t <title>         Track title filter",
    "  --playlist, -p <id>         Deezer playlist ID to import tracks from",
    "  --provider <deezer|itunes>  Audio provider (default: deezer)",
    "  --limit, -l <1..100>        Max tracks to fetch (default: 30)",
    "  --file, -f <filename.json>  Custom output file in src/data/tracks/",
    "  --seed                      Seed launch micro-genres (optionally filtered by --genre)",
    "  --dry-run                   Preview normalized tracks without writing to disk",
    "  --list-genres               List all valid genre IDs and track counts",
    "  --help, -h                  Show this help message",
  ].join("\n");
}

export async function runCatalogCli(argv: readonly string[]): Promise<void> {
  const args = parseCatalogCliArgs(argv);

  if (args.help) {
    console.log(formatCliUsage());
    return;
  }

  if (args.listGenres) {
    const genres = loadGenresFromDisk();
    const tracks = loadTracksFromDisk();
    const catalog = getCatalog({ genres, tracks });
    const nodes = getAllGenreNodes(catalog);
    for (const node of nodes) {
      const count = getTracksForChannel(node.id, catalog).length;
      console.log(`${node.id.padEnd(42)} ${String(count).padStart(4)} tracks  (${node.name})`);
    }
    return;
  }

  if (args.seed) {
    const summary = await seedCatalogGenres({
      genreFilter: args.genreId,
      provider: args.provider,
      dryRun: args.dryRun,
    });
    console.log(
      `${args.dryRun ? "[dry-run] " : ""}Seeded ${summary.genresSeeded} micro-genre(s) with ${summary.totalAdded} new track(s).`,
    );
    return;
  }

  if (args.genreId === undefined || args.genreId.length === 0) {
    throw new Error("Missing required --genre <genreId>. Run with --help for usage.");
  }

  const fetched = await searchCatalogTracks({
    genreId: args.genreId,
    query: args.query,
    artist: args.artist,
    track: args.track,
    playlistId: args.playlistId,
    provider: args.provider,
    limit: args.limit,
  });

  const result = appendTracksToCatalogFile(args.genreId, fetched, {
    fileName: args.fileName,
    dryRun: args.dryRun,
  });

  console.log(
    `${args.dryRun ? "[dry-run] " : ""}Added ${result.added.length} track(s), skipped ${result.skippedDuplicates} duplicate(s). Total in ${path.basename(result.filePath)}: ${result.totalInFile}.`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  runCatalogCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
