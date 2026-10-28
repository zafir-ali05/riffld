<div align="center">

# 🎧 Riffld

**The music guessing game for people whose favorite genre doesn't have a Billboard chart.**

Guess the track from a 1-second snippet, an isolated drum loop, or a grid of stat clues, across reggaeton, hyperpop, corridos tumbados, amapiano, shoegaze, drift phonk and a few hundred other micro-genres.

[![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-cache-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Socket.io](https://img.shields.io/badge/Socket.io-realtime-010101?logo=socketdotio&logoColor=white)](https://socket.io)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange)](#-roadmap)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

</div>

> [!NOTE]
> **Riffld** is a working title. This README is the project's design document and setup guide: it describes the target architecture before most of it is built. Sections marked 🚧 are planned but not implemented yet.

---

## 📑 Table of Contents

- [Why Riffld?](#-why-riffld)
- [Core Loop](#-core-loop)
- [Game Modes](#-game-modes)
  - [Classic Snippet Mode](#1-classic-snippet-mode)
  - [Stem Layer Mode](#2-stem-layer-mode)
  - [Stat-Deduction Matrix](#3-stat-deduction-matrix)
  - [Game Scopes: Daily, Infinite, Party](#4-game-scopes)
- [Genre Taxonomy](#-genre-taxonomy)
- [Data Ingestion & Sourcing](#-data-ingestion--sourcing)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Data Model](#-data-model)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Project Structure](#-project-structure)
- [Scripts](#-scripts)
- [Contributing](#-contributing)
- [Roadmap](#-roadmap)
- [Legal & Licensing Notes](#%EF%B8%8F-legal--licensing-notes)

---

## 💡 Why Riffld?

Heardle, SongPop and Songdle are fun, but most of their libraries come from the mainstream: Billboard pop, classic rock and chart hip-hop. If you grew up on Bad Bunny deep cuts, Midwest emo, or 3 a.m. breakcore, there's nothing in them for you.

Riffld is built around **genre depth** instead:

| | Typical music guessers | **Riffld** |
|---|---|---|
| Catalog | Global top charts | Curated per **micro-genre** channel |
| Taxonomy | Flat ("Pop", "Rock") | 3-tier tree: **Root → Subgenre → Micro-genre** |
| Feedback on a wrong guess | ❌ / ✅ | **Directional**: year ↑↓, genre distance, BPM, energy, popularity |
| Ways to play | Audio snippet only | Snippet, **stem layers**, **silent stat grid** |
| Social | Share a score | Per-genre daily leaderboards plus **live party lobbies** |

---

## 🔁 Core Loop

```mermaid
flowchart LR
    A[Pick a genre channel] --> B[Get a clue<br/>snippet · stem · stat]
    B --> C[Guess via fuzzy<br/>autocomplete]
    C -->|Wrong| D[Directional feedback<br/>year · genre · BPM · popularity]
    D --> B
    C -->|Right / out of tries| E[Reveal + full preview]
    E --> F[Update stats &<br/>leaderboards]
    F --> G[Share emoji grid]
```

1. **Listen or read**: get a tiered audio snippet, an isolated stem, or a metadata clue.
2. **Guess**: type into a typo-tolerant autocomplete (artist + title).
3. **Learn**: every wrong guess tells you something useful (newer/older, closer/further in genre, faster/slower).
4. **Climb**: streaks and scores feed per-genre and global leaderboards.

---

## 🎮 Game Modes

### 1. Classic Snippet Mode

The Heardle formula: each wrong guess or skip unlocks more of the intro.

| Attempt | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| **Audio revealed** | 1s | 2s | 4s | 7s | 11s | 16s |
| **Points if correct** | 100 | 80 | 60 | 40 | 25 | 10 |

- The snippet start offset is configurable per track (`Track.snippetOffsetMs`), so a song with a 20-second ambient intro can start at the hook instead.
- Playback goes through the Web Audio API. Each tier plays from a decoded `AudioBuffer`, so cutoffs land on the exact millisecond with no seek lag.
- Skips count as wrong guesses.

### 2. Stem Layer Mode

*Bandle-style.* Instead of more time, each attempt adds **another instrument layer**:

| Attempt | Layers playing |
|---|---|
| 1 | 🥁 Drums |
| 2 | 🥁 Drums + 🎸 Bass |
| 3 | 🥁 + 🎸 + 🎹 Synths / Rhythm |
| 4 | 🥁 + 🎸 + 🎹 + 🎤 Leads / Vocals (full mix) |

- Stems are produced **offline** at ingestion time with a source-separation model (e.g. [Demucs](https://github.com/facebookresearch/demucs) `htdemucs_6s`) and stored as short, low-bitrate clips. They are never separated client-side.
- Layers are mixed in the browser with one `GainNode` per stem, so adding a layer is a smooth fade-in, not a reload.
- 🚧 Available only for tracks whose licensing allows derivative processing (see [Legal](#%EF%B8%8F-legal--licensing-notes)).

### 3. Stat-Deduction Matrix

*Popstar / Spotle-style.* **No audio until the reveal.** You guess any song, and the grid compares it with the hidden target:

| Attribute | Feedback | Example |
|---|---|---|
| 📅 **Release year** | Exact 🟩 · within 3 yrs 🟨 · otherwise ⬜ + **↑ newer / ↓ older** | `2019 ↑` → target is newer |
| 🧬 **Genre distance** | 🟩 exact micro-genre · 🟨 same subgenre · 🟧 same root · ⬜ unrelated | Guess *Latin Trap*, target *Reggaeton* → 🟨 |
| 🥁 **BPM** | ±5 BPM 🟩 · otherwise **↑ / ↓** | `128 ↓` |
| ⚡ **Energy** | Bucketed 0–1 → **higher / lower** | `0.42 ↑` |
| 💃 **Danceability** | Bucketed 0–1 → **higher / lower** | `0.81 ↓` |
| 📈 **Popularity** | Tier: `Mainstream` · `Mid` · `Niche` · `Deep Underground` | 🟨 one tier off |
| 🌍 **Region / Language** | Exact 🟩 · same continent 🟨 | `PR 🟨` |

**How genre distance works:** it's the tree distance between the guess and the target in the [taxonomy](#-genre-taxonomy):

```ts
// src/lib/game/genreDistance.ts
export type GenreMatch = "exact" | "subgenre" | "root" | "none";

export function genreDistance(guess: GenrePath, target: GenrePath): GenreMatch {
  if (guess.micro === target.micro) return "exact";
  if (guess.sub === target.sub) return "subgenre";
  if (guess.root === target.root) return "root";
  return "none";
}
```

### 4. Game Scopes

Every mode above can be played in any of these scopes:

#### 📅 Daily Challenge
- **One synchronized puzzle per genre channel per day**, the same for every player worldwide. The day rolls over at 00:00 UTC.
- The track is chosen by a deterministic seed, `hash(channelId + YYYY-MM-DD + SERVER_SALT)`, then frozen into the `DailySeed` table and cached in Redis. A catalog change mid-day can't change today's answer.
- Global and per-channel leaderboards, plus streak tracking.
- **Shareable emoji grid**, spoiler-free:

  ```text
  Riffld #142 · 🇵🇷 Reggaeton · 3/6
  🔇🟥🟨🟩⬜⬜
  🔥 Streak: 12
  riffld.app/d/reggaeton
  ```

#### ♾️ Infinite / Practice Mode
- Endless random rounds that don't count toward the daily leaderboard.
- Filter by **genre tags**, **era** (e.g. *2000s Latin* vs *2020s Hyperpop*), **popularity tier**, and **difficulty**.
- Difficulty is computed per track from global solve rates, so it gets more accurate as people play.

#### 🎉 Multiplayer Party Lobbies 🚧
- Create a room, share a 6-character code, and play live with friends.
- **Buzzer mode:** the snippet plays for everyone at once, and the first correct guess takes the round.
- **Race mode:** everyone guesses independently, and speed plus accuracy decide the score.
- Server-authoritative: the server picks the track, timestamps buzzes, and scores the round. Clients never receive the answer before the reveal.
- Built on Socket.io rooms, with the Redis adapter for horizontal scaling.

---

## 🧬 Genre Taxonomy

Genres form a **three-level tree**. Every track belongs to exactly one *primary* micro-genre and may carry any number of secondary tags.

```text
Root Genre
└── Subgenre
    └── Micro-genre
```

### Launch taxonomy (v1)

| Root | Subgenres / micro-genres |
|---|---|
| 🌎 **Latin** | Reggaeton · Latin Trap · Bachata · Salsa · Cumbia · Corridos Tumbados · Baile Funk |
| 🎛️ **Electronic & Underground** | Hyperpop · Glitchcore · Breakcore · Vaporwave · Future Funk · Drift Phonk · Ambient · UK Garage / 2-Step |
| 🎤 **Hip-Hop & R&B** | 90s East Coast · 90s West Coast · Trap · UK Drill · Boom Bap · Cloud Rap · Neo-Soul |
| 🎸 **Rock & Alternative** | Post-Punk · Midwest Emo · Shoegaze · Math Rock · Grunge · Metalcore |
| 🌐 **Global & Regional** | Afrobeats · Amapiano · City Pop · K-Pop · J-Rock |

### Schema

Taxonomy lives as version-controlled JSON in [`src/genres/`](src/genres/) and is synced into the database by `npm run db:seed`.

```jsonc
// src/genres/latin.json
{
  "id": "latin",
  "name": "Latin",
  "emoji": "🌎",
  "children": [
    {
      "id": "latin.urbano",
      "name": "Urbano",
      "children": [
        {
          "id": "latin.urbano.reggaeton",
          "name": "Reggaeton",
          "aliases": ["reggaetón", "perreo", "dembow"],
          "bpmRange": [88, 100],
          "eraRange": [1995, null],
          "sources": {
            "musicbrainz": ["reggaeton"],
            "lastfm": ["reggaeton", "perreo"],
            "everynoise": ["reggaeton"]
          }
        },
        {
          "id": "latin.urbano.latin-trap",
          "name": "Latin Trap",
          "aliases": ["trap latino"],
          "bpmRange": [130, 150],
          "sources": { "lastfm": ["latin trap", "trap latino"] }
        }
      ]
    },
    {
      "id": "latin.regional-mexican",
      "name": "Regional Mexican",
      "children": [
        {
          "id": "latin.regional-mexican.corridos-tumbados",
          "name": "Corridos Tumbados",
          "aliases": ["corridos bélicos", "trap corridos"]
        }
      ]
    }
  ]
}
```

```ts
// src/types/genre.ts
export interface GenreNode {
  id: string;                 // dot-path, e.g. "electronic.internet.hyperpop"
  name: string;
  emoji?: string;
  aliases?: string[];         // used for search and for matching external tags
  bpmRange?: [number, number];
  eraRange?: [number, number | null];
  sources?: Partial<Record<"musicbrainz" | "lastfm" | "everynoise", string[]>>;
  children?: GenreNode[];
}

export interface GenrePath {
  root: string;
  sub: string;
  micro: string;
}
```

**Rules for adding a genre**
1. IDs are lowercase, kebab-case, dot-separated, and **never renamed** once shipped (leaderboards reference them). Use `aliases` for renames.
2. A micro-genre needs **at least 30 verified tracks** before it can become a Daily channel.
3. Add `sources` mappings so the ingestion pipeline can auto-suggest tracks.

---

## 📥 Data Ingestion & Sourcing

```mermaid
flowchart TD
    subgraph Sources
      DZ[Deezer API<br/>30s previews]
      SP[Spotify Web API<br/>metadata & IDs]
      MB[MusicBrainz<br/>genres · ISRC · release dates]
      LF[Last.fm<br/>community tags]
      EN[Every Noise at Once<br/>static snapshot]
    end
    Sources --> ING[Ingestion worker<br/>scripts/ingest]
    ING --> NORM[Normalize & dedupe<br/>by ISRC]
    NORM --> CLS[Genre classifier<br/>tag → taxonomy mapping]
    CLS --> REV[Human review queue<br/>/admin/review]
    REV --> DB[(PostgreSQL)]
    REV --> STEM[Stem separation<br/>offline, optional]
    STEM --> OBJ[(Object storage)]
```

### Audio previews

| Priority | Source | Notes |
|---|---|---|
| 1 | **Deezer API** | Public 30s MP3 `preview` URLs, no auth needed for search. The **primary** source. |
| 2 | **Spotify Web API** | Used for **metadata, IDs and cross-referencing**. ⚠️ Spotify removed `preview_url` and the Audio Features endpoints for apps registered after Nov 27 2024, so new apps shouldn't count on Spotify for audio or BPM/energy data. |
| 3 | **YouTube** | 🚧 Last-resort fallback for tracks missing elsewhere, via the official embedded player only. **Don't** download or rip audio; that violates YouTube's ToS. |

Preview URLs from some providers are signed and expire. Riffld stores the **provider + track ID** and resolves a fresh URL on demand through `/api/audio/[trackId]`, which:
- proxies or redirects to the provider URL,
- caches the resolved URL in Redis until shortly before it expires,
- is **rate-limited per IP** (sliding window in Redis), so the proxy can't be abused as a free CDN.

### Metadata & classification

| Source | Used for |
|---|---|
| **MusicBrainz** | Canonical release dates, ISRCs, artist relationships, curated genre tags |
| **Last.fm** | Community tags (`track.getTopTags`, `artist.getTopTags`), the best signal for micro-genres |
| **Every Noise at Once** | Genre names and adjacency used to seed the taxonomy. It hasn't been updated since late 2023, so it's a **static reference**, not a live API. |
| **Deezer / Spotify** | Popularity, duration, artwork, explicit flag |

**Audio descriptors (BPM, energy, danceability):** since Spotify's Audio Features aren't available to new apps, Riffld computes them **at ingestion time** from the 30s preview (e.g. with [Essentia](https://essentia.upf.edu/) or `librosa` in a Python worker) and stores them on the `Track` row.

**Classification pipeline:** external tags → normalized → matched against each node's `aliases` and `sources` → weighted vote → **a human approves the primary micro-genre** in the admin review queue. No track reaches a Daily pool without human review.

---

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph Client["Browser (Next.js / React)"]
      UI[UI · Tailwind · Framer Motion]
      AE[Audio engine<br/>Web Audio API]
      WS[Socket.io client]
    end

    subgraph Server["Next.js server"]
      RSC[Server Components<br/>& Route Handlers]
      API["/api/* endpoints"]
      RT[Socket.io server<br/>party lobbies]
    end

    subgraph Data
      PG[(PostgreSQL<br/>+ pg_trgm)]
      RD[(Redis<br/>cache · rate limit · pub/sub)]
      S3[(Object storage<br/>stems · artwork)]
    end

    EXT[Deezer · Spotify<br/>MusicBrainz · Last.fm]

    UI --> RSC
    AE --> API
    WS <--> RT
    API --> PG
    API --> RD
    API --> S3
    RT --> RD
    API --> EXT
```

**Key design decisions**

| Decision | Rationale |
|---|---|
| Next.js App Router for UI **and** API | One deployable and shared TypeScript types. A separate Express service is only added if the real-time load demands it. |
| Socket.io runs as a **separate Node process** (`server/realtime.ts`) | Serverless hosts can't hold WebSockets. Splitting it out lets the web app deploy anywhere while the realtime server runs on a long-lived host. |
| The answer is **never sent to the client** before a round ends | Guesses are validated server-side. The client only receives the audio and feedback. |
| Daily picks are **frozen in Postgres, cached in Redis** | Deterministic, auditable, and cheap to serve to every player. |
| Fuzzy search via **`pg_trgm`** on the server, **Fuse.js** on the client for small filtered pools | Trigram indexes scale to the full catalog; Fuse.js gives instant results offline in Practice mode. |

---

## 🧰 Tech Stack

| Layer | Choice |
|---|---|
| **Framework** | [Next.js](https://nextjs.org) (App Router) + React + **TypeScript** (strict) |
| **Styling / UI** | [Tailwind CSS](https://tailwindcss.com), [Framer Motion](https://www.framer.com/motion/), [Lucide Icons](https://lucide.dev) |
| **Audio** | Web Audio API (precise snippet cutoffs, stem mixing); [Howler.js](https://howlerjs.com) as an optional fallback for simple playback |
| **API** | Next.js Route Handlers (`src/app/api/**/route.ts`) |
| **Database** | PostgreSQL 16 (SQLite works for quick local hacking) via [Prisma ORM](https://www.prisma.io) |
| **Cache / rate limiting** | Redis (daily seed cache, audio-proxy rate limiting, Socket.io adapter) |
| **Real-time** | [Socket.io](https://socket.io) + `@socket.io/redis-adapter` |
| **Search** | PostgreSQL `pg_trgm` (server) · [Fuse.js](https://www.fusejs.io) (client) |
| **Validation** | [Zod](https://zod.dev) for API input and env parsing |
| **Testing** | Vitest (unit) · Playwright (e2e) |
| **Tooling** | ESLint, Prettier, Husky + lint-staged, GitHub Actions CI |

---

## 🗄️ Data Model

Simplified Prisma schema (the full version lives in [`prisma/schema.prisma`](prisma/schema.prisma)):

```prisma
model Genre {
  id        String   @id                 // "latin.urbano.reggaeton"
  name      String
  parentId  String?
  parent    Genre?   @relation("GenreTree", fields: [parentId], references: [id])
  children  Genre[]  @relation("GenreTree")
  depth     Int                          // 0 = root, 1 = sub, 2 = micro
  aliases   String[]
  tracks    Track[]  @relation("PrimaryGenre")
}

model Track {
  id               String   @id @default(cuid())
  isrc             String?  @unique
  title            String
  artist           String
  releaseYear      Int
  primaryGenreId   String
  primaryGenre     Genre    @relation("PrimaryGenre", fields: [primaryGenreId], references: [id])
  tags             String[]
  bpm              Float?
  energy           Float?   // 0–1
  danceability     Float?   // 0–1
  popularity       Int?     // 0–100, normalized across providers
  region           String?  // ISO 3166-1 alpha-2
  audioProvider    String   // "deezer" | "spotify" | "youtube"
  audioProviderId  String
  snippetOffsetMs  Int      @default(0)
  hasStems         Boolean  @default(false)
  verified         Boolean  @default(false)
  guesses          Guess[]
  dailySeeds       DailySeed[]

  @@index([primaryGenreId])
  // Trigram GIN indexes on title/artist are created in a raw SQL migration.
}

model DailySeed {
  id        String   @id @default(cuid())
  date      DateTime @db.Date
  channelId String                       // a Genre id
  mode      GameMode
  trackId   String
  track     Track    @relation(fields: [trackId], references: [id])

  @@unique([date, channelId, mode])
}

model Guess {
  id          String   @id @default(cuid())
  userId      String?
  user        User?    @relation(fields: [userId], references: [id])
  trackId     String                     // the target
  track       Track    @relation(fields: [trackId], references: [id])
  guessedId   String?                    // null = skip
  attempt     Int
  correct     Boolean
  mode        GameMode
  scope       GameScope
  createdAt   DateTime @default(now())
}

model UserStats {
  userId        String  @id
  user          User    @relation(fields: [userId], references: [id])
  gamesPlayed   Int     @default(0)
  wins          Int     @default(0)
  currentStreak Int     @default(0)
  maxStreak     Int     @default(0)
  genreXp       Json    @default("{}")  // { "<genreId>": xp }
}

enum GameMode  { SNIPPET STEMS MATRIX }
enum GameScope { DAILY PRACTICE PARTY }
```

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | ≥ 20 LTS | `nvm use` reads `.nvmrc` |
| **Package manager** | npm ≥ 10 (or pnpm ≥ 9) | Examples below use npm |
| **PostgreSQL** | ≥ 15 | With the `pg_trgm` extension (bundled with standard installs) |
| **Redis** | ≥ 7 | Optional for solo dev; required for Daily + Party modes |
| **Docker** | any recent | Easiest way to run Postgres + Redis locally |
| **Python** | ≥ 3.10 | *Only* for the audio-analysis and stem-separation workers |

**API keys you'll need:**

| Service | Required? | Get it at |
|---|---|---|
| Spotify Web API | Recommended (metadata) | <https://developer.spotify.com/dashboard> |
| Last.fm API | Recommended (genre tags) | <https://www.last.fm/api/account/create> |
| Deezer API | No key needed for public search/previews | <https://developers.deezer.com> |
| MusicBrainz | No key. **Must** send a descriptive `User-Agent` and stay under 1 req/s | <https://musicbrainz.org/doc/MusicBrainz_API> |

### Local setup

**1. Clone and install**

```bash
git clone https://github.com/<your-org>/riffld.git
```

```bash
cd riffld && npm install
```

**2. Configure the environment**

```bash
cp .env.example .env.local
```

Then fill in the values; see [Environment Variables](#-environment-variables).

**3. Start Postgres and Redis**

```bash
docker compose up -d
```

<details>
<summary><code>docker-compose.yml</code> reference</summary>

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: riffld
      POSTGRES_PASSWORD: riffld
      POSTGRES_DB: riffld
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    ports: ["6379:6379"]
volumes:
  pgdata:
```

</details>

**4. Migrate and seed the database**

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

This syncs the genre taxonomy from `src/genres/*.json` and loads a small, verified sample catalog so every mode is playable offline.

**5. Run the dev servers**

```bash
npm run dev
```

This starts **Next.js** on <http://localhost:3000> and the **Socket.io realtime server** on `:3001` (in parallel, via `concurrently`).

**6. (Optional) Ingest real tracks for a genre**

```bash
npm run ingest -- --genre latin.urbano.reggaeton --limit 100
```

Ingested tracks land in the review queue at <http://localhost:3000/admin/review>.

---

## 🔐 Environment Variables

Copy `.env.example` → `.env.local`. All variables are validated at boot by `src/lib/env.ts` (Zod), and the app refuses to start if a required one is missing.

| Variable | Required | Scope | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | server | Postgres connection string, e.g. `postgresql://riffld:riffld@localhost:5432/riffld` |
| `REDIS_URL` | ⚠️ Daily/Party | server | e.g. `redis://localhost:6379` |
| `NEXT_PUBLIC_APP_URL` | ✅ | client + server | Public base URL, e.g. `http://localhost:3000`. Used in share links |
| `NEXT_PUBLIC_REALTIME_URL` | ⚠️ Party | client | Socket.io server URL, e.g. `http://localhost:3001` |
| `SPOTIFY_CLIENT_ID` | Recommended | server | Spotify app client ID (Client Credentials flow) |
| `SPOTIFY_CLIENT_SECRET` | Recommended | server | Spotify app client secret. **Never** prefix with `NEXT_PUBLIC_` |
| `LASTFM_API_KEY` | Recommended | server | Last.fm API key for genre tags |
| `MUSICBRAINZ_USER_AGENT` | ✅ for ingest | server | e.g. `Riffld/0.1 ( you@example.com )` |
| `DAILY_SEED_SALT` | ✅ | server | Random secret mixed into the daily seed so answers can't be precomputed |
| `AUDIO_PROXY_RATE_LIMIT` | — | server | Requests per minute per IP on `/api/audio` (default `60`) |
| `STORAGE_BUCKET_URL` | ⚠️ Stems | server | S3-compatible bucket for stems and artwork |

```dotenv
# .env.example
DATABASE_URL="postgresql://riffld:riffld@localhost:5432/riffld"
REDIS_URL="redis://localhost:6379"

NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_REALTIME_URL="http://localhost:3001"

SPOTIFY_CLIENT_ID=""
SPOTIFY_CLIENT_SECRET=""
LASTFM_API_KEY=""
MUSICBRAINZ_USER_AGENT="Riffld/0.1 ( you@example.com )"

DAILY_SEED_SALT="change-me"
AUDIO_PROXY_RATE_LIMIT=60
STORAGE_BUCKET_URL=""
```

> [!WARNING]
> Never commit `.env.local`. Only `NEXT_PUBLIC_*` variables are exposed to the browser, so keep every secret un-prefixed.

---

## 📂 Project Structure

```text
riffld/
├── prisma/
│   ├── schema.prisma            # Data model
│   ├── migrations/              # SQL migrations (incl. pg_trgm indexes)
│   └── seed.ts                  # Taxonomy sync + sample catalog
├── scripts/
│   ├── ingest/                  # Source adapters: deezer, spotify, musicbrainz, lastfm
│   └── analysis/                # Python workers: BPM/energy extraction, stem separation
├── server/
│   └── realtime.ts              # Standalone Socket.io server for party lobbies
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (game)/
│   │   │   ├── daily/[channel]/ # Daily challenge per genre channel
│   │   │   ├── play/            # Infinite / practice mode
│   │   │   └── party/[code]/    # Multiplayer lobby
│   │   ├── admin/review/        # Ingestion review queue
│   │   └── api/
│   │       ├── audio/[trackId]/ # Rate-limited preview proxy
│   │       ├── daily/           # Today's seed per channel
│   │       ├── guess/           # Server-side guess validation + feedback
│   │       └── search/          # Fuzzy autocomplete (pg_trgm)
│   ├── components/
│   │   ├── game/                # GuessInput, SnippetPlayer, StemMixer, StatMatrix, ShareCard
│   │   ├── genre/               # GenrePicker, GenreBadge, TaxonomyTree
│   │   └── ui/                  # Buttons, dialogs, toasts (shared primitives)
│   ├── genres/                  # 🧬 Taxonomy JSON (one file per root genre)
│   ├── hooks/                   # useAudioEngine, useDailyGame, usePartyRoom
│   ├── lib/
│   │   ├── audio/               # Web Audio engine, tier scheduler, stem mixer
│   │   ├── game/                # Scoring, genreDistance, feedback, seeding
│   │   ├── search/              # pg_trgm queries + Fuse.js client index
│   │   ├── providers/           # Deezer / Spotify / Last.fm / MusicBrainz clients
│   │   ├── redis.ts
│   │   ├── prisma.ts
│   │   └── env.ts               # Zod-validated env
│   └── types/                   # Shared TS types (GenreNode, Track, socket events)
├── tests/
│   ├── unit/                    # Vitest
│   └── e2e/                     # Playwright
├── .env.example
├── docker-compose.yml
└── README.md
```

---

## 📜 Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js + realtime server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint + Prettier check |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Sync taxonomy + load sample tracks |
| `npm run db:studio` | Open Prisma Studio |
| `npm run ingest -- --genre <id>` | Pull candidate tracks for a genre into the review queue |

---

## 🤝 Contributing

Contributions are welcome, especially **genre expertise**. If you know the difference between drift phonk and Memphis phonk, we want your taxonomy PRs.

### Workflow

1. **Open or claim an issue** before starting anything non-trivial.
2. **Branch off `main`** with a conventional prefix:

   | Prefix | Use for |
   |---|---|
   | `feat/` | New features (`feat/stem-mixer`) |
   | `fix/` | Bug fixes (`fix/daily-rollover-utc`) |
   | `genre/` | Taxonomy or catalog additions (`genre/amapiano-expansion`) |
   | `chore/` | Tooling, deps, CI |
   | `docs/` | Documentation only |

3. **Commit** using [Conventional Commits](https://www.conventionalcommits.org): `feat(matrix): add danceability column`.
4. **Check locally** before pushing:

   ```bash
   npm run lint && npm run typecheck && npm run test
   ```

5. **Open a PR** against `main`. CI must be green, and at least one review is required. Squash-merge only.

### Genre PR checklist

- [ ] New nodes follow the `root.sub.micro` ID convention
- [ ] `aliases` and `sources` mappings are filled in
- [ ] At least 30 tracks, each with a verified primary micro-genre (for Daily eligibility)
- [ ] No existing IDs renamed

### Code style

- TypeScript `strict`, no `any` without a comment explaining why.
- Server-only code lives behind `import "server-only"`; secrets never reach client bundles.
- Game logic in `src/lib/game/` is **pure and unit-tested**, with no I/O.

---

## 🗺️ Roadmap

### v0.1: Foundations
- [ ] Next.js + Prisma + Postgres scaffold
- [ ] Genre taxonomy JSON + seed script
- [ ] Deezer preview proxy with Redis rate limiting
- [ ] Fuzzy search (`pg_trgm`)

### v1.0: MVP 🎯
- [ ] **Classic Snippet Mode** (1/2/4/7/11/16s)
- [ ] **Stat-Deduction Matrix**
- [ ] **Daily Challenge** for 10 launch channels + shareable emoji grids
- [ ] **Infinite / Practice** with genre, era and difficulty filters
- [ ] Anonymous play + optional accounts, streaks, per-genre leaderboards
- [ ] Ingestion pipeline + admin review queue

### v1.5: Social
- [ ] **Stem Layer Mode** (offline Demucs pipeline)
- [ ] **Multiplayer Party Lobbies** (buzzer + race)
- [ ] Genre XP and badges ("Shoegaze Scholar", "Perreo Professor")
- [ ] PWA / installable mobile experience

### v2.0: Community
- [ ] **Community-submitted niche playlists**, voted and moderated into official channels
- [ ] User-created custom daily puzzles with shareable links
- [ ] Genre "family tree" explorer built from the taxonomy graph
- [ ] Localization (ES, PT-BR, JA, KO first)

---

## ⚖️ Legal & Licensing Notes

- Riffld streams **only short official previews** from licensed providers (Deezer, Spotify) and links out to the full track on those platforms. It doesn't host or redistribute full-length audio.
- Respect each provider's terms of service and attribution requirements (e.g. Spotify's branding guidelines, Deezer's attribution rules, MusicBrainz rate limits).
- **Stem separation** creates derivative audio. Only enable `hasStems` for tracks where you have the rights to do so (e.g. Creative Commons, artist-submitted, or explicitly licensed), and confirm the provider ToS permits it before shipping Stem Mode publicly.
- Riffld isn't affiliated with Heardle, Bandle, SongPop, Songdle, Popstar, Spotle, Spotify, Deezer, or any artist featured in the game.

---

<div align="center">

**Made with 🎧 by people who have strong opinions about subgenres.**

[Report a bug](../../issues/new?labels=bug) · [Request a genre](../../issues/new?labels=genre) · [Start a discussion](../../discussions)

</div>
