# Riffld Implementation Roadmap

This document tracks the step-by-step build order for Riffld from initial scaffold to v1.0 MVP. Check off items (`- [x]`) as they are completed and verified with tests.

Before starting or completing any task, review the rules and invariants in [AGENTS.md](./AGENTS.md).

---

## Phase 1: Project Scaffold & Shared Types (`v0.1` Foundation)

Set up the core tooling, strict TypeScript configuration, and domain data structures.

- [x] **1.1 Initialize Next.js & Tooling**
  - [x] Create `package.json` with Next.js (App Router), React, TypeScript, Tailwind CSS, Fuse.js, Lucide Icons, ESLint, Prettier, and Vitest.
  - [x] Configure `tsconfig.json` with `strict: true` and `noUncheckedIndexedAccess: true`.
  - [x] Configure npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, and `catalog:add`.
  - [x] Create `.env.example` with `NEXT_PUBLIC_APP_URL` and server-only `DAILY_SEED_SALT`.
  - [x] Create minimal App Router root layout (`src/app/layout.tsx`) and global Tailwind stylesheet.
- [x] **1.2 Shared Domain Types & Constants (`src/types/catalog.ts`)**
  - [x] Define `GenreNode`, `Track`, and `LocalGenreStats` interfaces.
  - [x] Define feedback discriminated union (`"correct" | "artist" | "wrong" | "skipped"`).
  - [x] Define round status discriminated union (`"playing" | "won" | "lost"`).
  - [x] Export `SNIPPET_DURATIONS_MS = [1000, 2000, 4000, 7000, 11000, 16000]` and share-grid feedback square constants.

---

## Phase 2: Pure Domain Logic & Unit Tests (`src/lib/` + `tests/`)

Build and unit-test all pure game logic before wiring up API routes or React components. Shared client/server helpers live in `src/lib/`; server-only modules live in `src/lib/server/`.

- [x] **2.1 Guess Feedback & Artist Normalization (`src/lib/feedback.ts`)**
  - [x] Implement artist name normalization (case-folding, diacritic stripping, `&` / `and` normalization, stripping `feat.` / `ft.` / `with` credits, and handling commas in artist names like `"Tyler, The Creator"`).
  - [x] Implement multi-artist splitting and overlap matching so shared credited artists register as an artist match.
  - [x] Implement guess classification returning `"correct" | "artist" | "wrong" | "skipped"`.
  - [x] Add unit tests in `tests/feedback.test.ts` covering exact matches, artist matches, diacritics (`"Beyoncé"`), punctuation edge cases, wrong guesses, and skips.
- [x] **2.2 Static Catalog Loader & Hierarchy Rollup (`src/lib/catalog.ts`)**
  - [x] Load and validate genre trees from `src/data/genres/*.json` and track catalogs from `src/data/tracks/*.json`.
  - [x] Implement hierarchical channel resolution so selecting a root genre or subgenre aggregates all tracks from its descendant micro-genres without duplicates.
  - [x] Implement lookup helpers (`getGenreById`, `getTracksForChannel`, `getTrackById`, `isDailyEligibleChannel` checking the 30-track minimum).
  - [x] Add unit tests in `tests/catalog.test.ts` for tree traversal, rollup aggregation, and unknown ID handling.
- [x] **2.3 Deterministic Daily Selector (`src/lib/server/daily.ts`) & Share Formatter (`src/lib/share.ts`)**
  - [x] Implement client-safe UTC date helper (`YYYY-MM-DD`), puzzle number calculator (days elapsed since fixed UTC launch date constant), and spoiler-free share-text generator (`Riffld #<num> · <Genre> · <score>/6`, emoji row, streak line, and URL) in `src/lib/share.ts`.
  - [x] Implement server-only deterministic daily track selector using `hash(channelId + YYYY-MM-DD + DAILY_SEED_SALT)` in `src/lib/server/daily.ts`.
  - [x] Implement opaque daily round token generation/resolution in `src/lib/server/daily.ts` so `/api/audio/[trackId]` can resolve daily audio without exposing the raw `trackId` to the client.
  - [x] Add unit tests in `tests/daily.test.ts` using `vi.useFakeTimers()` / `vi.setSystemTime()` to verify determinism, 00:00 UTC rollover, puzzle numbering, and share-text formatting.
- [x] **2.4 Audio Preview Providers (`src/lib/server/providers.ts`)**
  - [x] Implement Deezer track API resolver and iTunes Search/Lookup API resolver with a 5-second fetch timeout.
  - [x] Resolve using the track's declared `provider` first, falling back to the alternate provider on failure.
  - [x] Validate external JSON payloads at the boundary and handle non-200 responses, rate limits, and missing preview URLs cleanly.
  - [x] Implement server-side in-memory TTL cache for resolved preview URLs (shorter than Deezer's signed URL lifetime).
  - [x] Add unit tests in `tests/providers.test.ts` with mocked `fetch` covering primary resolution, fallback resolution, timeouts, malformed responses, and cache expiration.

---

## Phase 3: Genre Taxonomy, Catalog CLI & Data Integrity (`src/data/` + `scripts/`)

Populate the static genre tree, build the catalog seeding CLI, and enforce schema invariants via automated tests.

- [ ] **3.1 Launch Genre Taxonomy (`src/data/genres/*.json`)**
  - [ ] Create root genre taxonomy files (`pop.json`, `hip-hop.json`, `rock.json`, `electronic.json`, `latin.json`, `country.json`, `soul-jazz.json`, `global.json`) covering both mainstream genres and niche subgenres following the `root.sub.micro` ID convention.
- [ ] **3.2 Catalog Seeding CLI (`scripts/catalog.ts`)**
  - [ ] Build `npm run catalog:add` CLI to search Deezer/iTunes by artist, track, or playlist and append normalized `Track` entries to `src/data/tracks/<genre>.json`.
  - [ ] Deduplicate by `id` and `providerTrackId` before writing.
- [ ] **3.3 Initial Seed Track Catalogs (`src/data/tracks/*.json`)**
  - [ ] Seed initial launch genre channels (minimum 30 real tracks per Daily-eligible channel).
- [ ] **3.4 Catalog Schema & Integrity Tests (`tests/catalog-integrity.test.ts`)**
  - [ ] Verify every genre ID matches `root.sub.micro` formatting and has no duplicate IDs.
  - [ ] Verify every track references a valid `genreId`, has a non-empty `providerTrackId`, and never stores hardcoded CDN URLs.
  - [ ] Verify no duplicate `id` or `providerTrackId` exists within a channel.
  - [ ] Verify `(track.snippetOffsetMs ?? 0) + 16000 <= 30000` for every track.
  - [ ] Verify Daily-eligible channels meet the 30-track minimum.

---

## Phase 4: Next.js API Routes (`src/app/api/`)

Expose thin, spoiler-safe endpoints backed by `src/lib/` and `src/lib/server/`.

- [ ] **4.1 Audio Preview Endpoint (`src/app/api/audio/[trackId]/route.ts`)**
  - [ ] Validate `trackId` (or opaque daily round token) against the catalog; return `404` on unknown values.
  - [ ] Resolve the fresh 30-second preview URL via `src/lib/server/providers.ts`.
  - [ ] Return the preview stream or URL without leaking song title, artist, or raw daily track ID in headers or body.
- [ ] **4.2 Daily Puzzle & Guess Validation Endpoint (`src/app/api/daily/[genre]/route.ts`)**
  - [ ] Validate `genre` against Daily-eligible channels; return `404` on unknown or ineligible genres.
  - [ ] `GET`: Return today's UTC date string, puzzle number, opaque audio token, and channel autocomplete track list (id, title, artist) without revealing the winning track.
  - [ ] `POST`: Validate a submitted guess (`trackId` or `"skip"`) and attempt index against today's answer using `src/lib/feedback.ts`. Return feedback classification, and reveal the full answer `Track` only when the guess is `"correct"` or the player reaches attempt 6.
  - [ ] Add unit/route tests in `tests/api.test.ts` verifying anti-spoiler guarantees and 404 bounds checking.

---

## Phase 5: Client State & Audio Hooks (`src/hooks/`)

Connect browser APIs (`localStorage`, Web Audio / HTML5 Audio) and round state machines.

- [ ] **5.1 Local Storage Stats & Daily Progress (`src/hooks/useLocalStats.ts`)**
  - [ ] Implement versioned keys: `riffld:v1:stats` and `riffld:v1:daily:<genreId>:<date>`.
  - [ ] Guard all reads/writes against SSR and parse defensively with fallback defaults and a version migration hook.
  - [ ] Update streaks (`currentStreak`, `maxStreak`), `gamesPlayed`, `wins`, `guessDistribution`, and `lastPlayedDate` using UTC dates.
  - [ ] Persist in-progress daily guesses so refreshing the page restores the current round state.
  - [ ] Add unit tests in `tests/local-stats.test.ts` covering streak continuity, streak resets, corrupt JSON recovery, and migrations.
- [ ] **5.2 Audio Snippet Playback (`src/hooks/useAudioSnippet.ts`)**
  - [ ] Initialize or resume playback inside user click/keypress handlers to satisfy Safari/iOS autoplay restrictions.
  - [ ] Slice playback starting at `snippetOffsetMs ?? 0` and stop accurately after `SNIPPET_DURATIONS_MS[attempt]`.
  - [ ] Stop and clean up active audio before starting a new play, on route change, and on `visibilitychange` (tab hidden).
  - [ ] Expose explicit states: `"idle" | "loading" | "playing" | "error"` plus a `retry()` handler.
- [ ] **5.3 Game State Machine (`src/hooks/useGameState.ts`)**
  - [ ] Manage round lifecycle (`"playing" | "won" | "lost"`), current attempt (`0..5`), unlocked snippet duration, and guess history.
  - [ ] Support Daily Mode (communicating with `/api/daily/[genre]` and syncing to `useLocalStats`).
  - [ ] Support Infinite Mode (client-side random track selection that does not repeat a track until the channel pool is exhausted in the current session).
  - [ ] Add unit tests in `tests/game-state.test.ts` for attempt progression, win/loss transitions, and non-repeating Infinite Mode pool exhaustion.

---

## Phase 6: UI Components & App Router Pages (`src/components/` + `src/app/`)

Build a fast, high-contrast, keyboard-accessible, mobile-first (360px+) interface using Tailwind CSS.

- [ ] **6.1 Shared UI Primitives (`src/components/ui/`)**
  - [ ] Build lightweight accessible primitives (buttons, modal dialog with `Esc` close and focus trap, status badges) with visible focus rings and `prefers-reduced-motion` support.
- [ ] **6.2 Genre Picker & Navigation (`src/components/genre/`)**
  - [ ] `GenrePicker.tsx`: Browse root genres, subgenres, and micro-genres with track counts and Daily eligibility indicators.
  - [ ] `SubgenreDrawer.tsx`: Drill down into subgenres/micro-genres and launch either Daily Mode (`/daily/[genre]`) or Infinite Mode (`/play/[genre]`).
- [ ] **6.3 Core Game Board Components (`src/components/game/`)**
  - [ ] `SnippetPlayer.tsx`: Progress bar segmented by `1s / 2s / 4s / 7s / 11s / 16s`, Play/Stop toggle (`Space` shortcut when input unfocused), loading indicator, and error/retry state.
  - [ ] `GuessInput.tsx`: WAI-ARIA combobox powered by Fuse.js over the active channel's catalog, supporting arrow-key navigation, `Enter` to submit, empty search state, and a "Skip" button.
  - [ ] `GuessList.tsx`: 6 attempt rows displaying submitted song/artist guesses and accessible feedback indicators (color + icon/label + `aria-label` for `"correct"`, `"artist"`, `"wrong"`, `"skipped"`).
  - [ ] `ResultModal.tsx`: End-of-round summary showing the revealed track, 30s preview player, external Deezer/Apple Music link, per-genre streak/distribution stats, "Share" button (copies emoji grid to clipboard), and "Next" button (in Infinite Mode).
- [ ] **6.4 App Router Pages (`src/app/`)**
  - [ ] `src/app/page.tsx`: Home page rendering the genre picker directly (no marketing landing page).
  - [ ] `src/app/daily/[genre]/page.tsx`: Daily challenge page validating the genre server-side and mounting the Daily game board.
  - [ ] `src/app/play/[genre]/page.tsx`: Infinite practice page validating the genre server-side and mounting the Infinite game board.

---

## Phase 7: End-to-End Verification & MVP Sign-Off (`v1.0`)

- [ ] **7.1 Verification Suite**
  - [ ] `npm run typecheck` passes with zero errors.
  - [ ] `npm run lint` passes with zero warnings or errors.
  - [ ] `npm run test` passes all unit and catalog integrity suites.
  - [ ] `npm run build` succeeds for production.
- [ ] **7.2 Anti-Spoiler, Accessibility & Mobile Audit**
  - [ ] Confirm Daily Mode network payloads, HTML, and RSC payloads never include the answer before round completion.
  - [ ] Verify keyboard-only playability (`Space`, `Enter`, `Esc`, arrow keys) and screen-reader labels.
  - [ ] Verify layout and controls at 360px mobile viewport width.
  - [ ] Update completed roadmap checkboxes in [README.md](./README.md).
