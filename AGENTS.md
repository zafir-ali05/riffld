# AGENTS.md

Instructions for AI coding agents working in the `riffld` repository. Read and follow every rule below before writing code, docs, or comments.

## Project Summary

Riffld is a Songdle-style audio guessing game built around deep genres and subgenres.
- **Core mechanic**: 6 attempts with progressive audio snippets (`1s -> 2s -> 4s -> 7s -> 11s -> 16s`), fuzzy song/artist autocomplete, and standard Songdle feedback (correct song, correct artist / wrong song, wrong, skipped).
- **Modes**: Daily Mode (deterministic daily seed per genre channel) and Infinite / Practice Mode.
- **Stack**: Next.js (App Router), React, TypeScript (strict), Tailwind CSS, Fuse.js, Web Audio / HTML5 Audio, Vitest.
- **Data**: Static JSON files in `src/data/` for genres and track catalogs. Browser `localStorage` for player stats and streaks. On-demand 30s audio preview URL resolution via Deezer and iTunes APIs.

### Project Status

The project is pre-alpha. `README.md` is a design document describing the target architecture, and most of it is not built yet. When creating files, follow the README's Project Structure section exactly instead of inventing new top-level folders. If the README and the code disagree, ask before picking one.

## Non-Negotiable Scope Boundaries

Do not re-introduce scope bloat. Unless explicitly instructed by the user:
- No database (no PostgreSQL, Prisma, SQLite, Redis, or Docker).
- No user authentication, accounts, or server-side leaderboards.
- No multiplayer lobbies or WebSockets / Socket.io.
- No stem separation, Python workers, or audio feature extraction pipelines.
- No stat-deduction matrix mode.
- No analytics, tracking pixels, cookie banners, or third-party scripts.
- No state management libraries (Redux, Zustand, Jotai), UI kits (shadcn, MUI, Chakra), animation libraries, or CSS-in-JS. React state, hooks, and Tailwind are enough.

## Anti-Slop Writing and Communication Rules

Apply these rules to all UI copy, documentation, comments, commit messages, and agent responses:
1. **No em dashes**: Never use the `—` character anywhere (code, UI strings, markdown, comments). Use commas, parentheses, colons, periods, or a standard hyphen (`-`).
2. **No emojis**: Do not put emojis in code comments, log messages, UI copy, commit messages, or documentation. Exceptions:
   - Data fields that require them (`GenreNode.emoji`).
   - The share-text grid and its feedback squares (`🟩 🟨 🟥 ⬜ ⬛`), which are a core product feature. Define these once as constants in `src/types/catalog.ts` and reference them.
3. **No AI cliches or filler**: Ban phrases like "delve", "tapestry", "seamless", "elevate", "robust", "unlock the power of", "crafted with care", "modern", "next-generation", "blazing fast", "effortless", "dive into", or "Let's get started!". Write plain, direct English.
4. **No narrating the obvious in comments**: Never write comments like `// Increment attempt counter` above `attempt++` or `// Import dependencies` at the top of a file. Only comment *why* a non-obvious decision or edge case exists (for example, Safari Web Audio unlock behavior or Deezer signed URL expiration).
5. **No placeholder output**: No `// TODO: implement`, `// ... rest of code`, lorem ipsum, fake track data presented as real, or stubbed functions that return hardcoded values without telling the user.
6. **No change-log comments**: Do not leave comments like `// Updated to fix bug` or `// New implementation`. Git history covers that.
7. **Short UI copy**: Button and label text should be 1 to 3 words ("Skip", "Play", "Share"). No exclamation marks in UI copy except the win state.

## Agent Workflow Rules

- **Do only what was asked.** Do not refactor, rename, reformat, or "improve" unrelated code in the same change.
- **Ask before adding any npm dependency.** State why the standard library or existing deps cannot do the job.
- **Do not delete or weaken tests to make them pass.** Fix the code, or explain why the test is wrong.
- **Do not silence errors.** No empty `catch {}`, no `// @ts-ignore`, no `// eslint-disable` without a one-line reason on the same line.
- **Do not call live Deezer / iTunes APIs or run `npm run catalog:add`** unless the user asks.
- **Do not invent track data.** Never fabricate `providerTrackId` values, titles, or artists. Use real IDs from the catalog script or leave the task to the user.
- **Read before writing.** Check `src/lib/`, `src/lib/server/`, `src/hooks/`, and `src/types/` for an existing helper or type before creating a new one.
- When a feature from the README roadmap ships, tick its checkbox in `README.md`.

## Game Logic Invariants

These rules define the game. Breaking them silently corrupts player streaks or leaks answers.

- **Snippet durations** live in one exported constant: `SNIPPET_DURATIONS_MS = [1000, 2000, 4000, 7000, 11000, 16000]`. Do not hardcode durations elsewhere.
- **Snippet window**: playback starts at `track.snippetOffsetMs ?? 0`, and `snippetOffsetMs + 16000` must be 30000 or less (enforced by a catalog test).
- **Daily rollover is 00:00 UTC.** Derive the date string with UTC methods, never the player's local time zone.
- **Daily seed format is frozen**: `hash(channelId + YYYY-MM-DD + DAILY_SEED_SALT)`. Changing the hash function, concatenation order, or date format changes every past and future answer. Treat it as a breaking change and ask first.
- **Puzzle number** (`Riffld #142`) is days since a fixed launch-date constant, computed in UTC.
- **Feedback classification** lives in `src/lib/feedback.ts` and returns a discriminated union (`"correct" | "artist" | "wrong" | "skipped"`), not booleans or magic strings scattered across components.
- **Artist matching** compares normalized names (case, diacritics, `&` / `and`, `feat.` credits stripped) and counts a match if any credited artist overlaps. Cover this with tests, including names like "Beyoncé" and "Tyler, The Creator".
- **Infinite Mode** must not repeat a track until the channel's pool is exhausted in that session.

## Anti-Spoiler and Security Rules

- `DAILY_SEED_SALT` is server-only. Never prefix it with `NEXT_PUBLIC_`, never import a file that reads it from a client component. Server-only modules (`daily.ts`, `providers.ts`) live in `src/lib/server/` and must never be imported from `src/components/` or `src/hooks/`.
- The daily answer (track ID, title, artist, provider ID) must not reach the client before the round ends: not in page props, RSC payloads, HTML, network responses, or source maps. Guesses are validated by `/api/daily/[genre]`.
- `/api/audio/[trackId]` must not reveal title or artist in its response body, headers, or redirect URL. Use an opaque round token for Daily Mode instead of the raw track ID.
- The autocomplete pool is the full channel catalog, which is fine because it does not reveal which track is the answer.
- Validate and bound every route param (`genre`, `trackId`) against the static catalog. Unknown values return 404, not a thrown error.

## Code Quality and Architecture Standards

### TypeScript
- `strict: true` is mandatory. Also enable `noUncheckedIndexedAccess`.
- Never use `any`. Use explicit types from `src/types/` or narrow `unknown` with type guards.
- Avoid unnecessary type assertions (`as Foo`). Validate external API payloads (Deezer, iTunes) and JSON catalogs at the boundary before typing them.
- Keep shared domain types in `src/types/catalog.ts`.
- Prefer discriminated unions over optional-field soup for state (for example, round status `"playing" | "won" | "lost"`).
- No barrel `index.ts` files that only re-export.

### Next.js and React
- Default to Server Components. Only add `"use client"` to leaf components that require browser APIs (`AudioContext`, `localStorage`, DOM events) or React state.
- Do not build wrapper abstractions for one-off components. Three similar lines of code are better than a premature helper or generic factory.
- Avoid `useEffect` for derived state. Compute derived values during render. Reserve `useEffect` for synchronizing with external systems (audio playback, `localStorage`, keyboard listeners), and always return a cleanup function.
- Keep API routes thin (`src/app/api/`). Pure logic belongs in `src/lib/` (shared) and `src/lib/server/` (server-only) where it can be unit tested without mocking Next.js request objects.
- No `useMemo` / `useCallback` by default. Add them only for a measured problem or a referential-equality requirement.
- Components stay under roughly 200 lines. Split by responsibility, not by habit.

### Audio
- Browsers block audio until a user gesture. Create or resume the `AudioContext` inside the click / keypress handler, not on mount (Safari and iOS especially).
- Stop and release previous playback before starting a new snippet. No overlapping audio.
- Stop playback on route change and when the tab is hidden.
- Treat a failed preview as a distinct UI state with a retry, never as a silent no-op.

### Providers (Deezer / iTunes)
- Resolution order: the track's declared `provider` first, the other provider as fallback.
- Every outbound fetch has a timeout (about 5s) and handles non-200, rate limiting, and malformed JSON.
- Cache resolved preview URLs server-side for less time than Deezer's signed URL lifetime. Never cache them in `localStorage`.

### localStorage
- Version all keys: `riffld:v1:stats`, `riffld:v1:daily:<genreId>:<date>`. Bumping the version requires a migration function, not a wipe.
- Never touch `localStorage` during SSR or at module scope. Read it in an effect or a guarded hook.
- Parse defensively. Corrupt or outdated data falls back to defaults instead of crashing the page.
- Persist in-progress daily rounds so a refresh does not reset or give away guesses.

### Styling and UI (Tailwind CSS)
- No generic AI-generated landing pages, purple/indigo neon gradients, glowing orbs, or glassmorphism cards everywhere.
- No hero sections, testimonial blocks, feature grids, or "Get Started" CTAs. The home page is the genre picker.
- Keep the interface fast, high-contrast, keyboard-friendly, and focused on the game board.
- Handle all interactive states explicitly: loading, audio buffering, audio error (expired or missing preview), empty search results, and completed round.
- Use Tailwind theme tokens for colors and spacing. No arbitrary hex values scattered through class strings.
- Mobile-first. The game must be fully playable at 360px width.

### Accessibility
- Every control works by keyboard. Suggested bindings: `Space` play/pause (when the input is not focused), `Enter` submit, `Esc` close modal, arrow keys in autocomplete.
- Feedback never relies on color alone. Pair each state with text or an icon and an `aria-label`.
- Autocomplete follows the WAI-ARIA combobox pattern.
- Respect `prefers-reduced-motion`.
- Visible focus rings on all interactive elements.

### Data and Catalog Integrity
- Never rename existing genre IDs in `src/data/genres/*.json`. Player stats in `localStorage` key off `genre.id`. Use `aliases` for display or search variations.
- Genre IDs follow `root.sub.micro` (lowercase, hyphenated words, max three levels).
- Never hardcode expiring Deezer CDN URLs into `src/data/tracks/*.json`. Store `provider` and `providerTrackId`, and resolve the fresh `preview` URL at runtime through `/api/audio/[trackId]`.
- Keep game logic in `src/lib/` and `src/lib/server/` pure and deterministic. Given `(genreId, dateString, salt)`, the daily selector must always return the same track.
- Track catalogs are append-only for Daily-eligible channels. Removing or reordering entries changes historical and upcoming daily answers. If a track must be removed, ask first.
- A channel needs at least 30 tracks to be Daily-eligible.
- No duplicate `providerTrackId` within a channel.

## Testing Standards

- Required coverage in `tests/`: daily selector determinism and UTC rollover, feedback classification (including artist normalization edge cases), snippet duration progression, share-text format, `localStorage` parsing and migration, and catalog schema validation (IDs, duplicates, offsets, 30-track minimum).
- Tests never hit the network. Mock provider fetches.
- Test behavior, not implementation. No snapshot tests of entire components.
- Freeze time with `vi.useFakeTimers()` / `vi.setSystemTime()` for anything date-dependent.

## Verification Checklist

Before finishing a task involving code changes:
1. Run `npm run typecheck` (`tsc --noEmit`) and fix all type errors.
2. Run `npm run lint` and fix all warnings or errors.
3. Run `npm run test` (Vitest) and ensure unit tests pass.
4. Grep your modified files for em dashes and stray emojis before completing work: `grep -rn "—" <files>`.
5. Confirm no new dependency, file, or folder was added that the user did not ask for.
6. In your final response, list what you changed and anything you could not verify. Do not claim something works if you did not run it.
