# Game Night Admin V5

## Phase 2A setup

The Admin and room-query Team flow now use Supabase Auth and the database-backed event identity layer. Copy `.env.example` to `.env.local`, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then run `npm run dev`.

Admin requires a permanent email/password Host account. A Team joins at `team.html?room=ABC123` with anonymous Supabase Auth. Opening `team.html` without a room query retains the same-browser local testing prototype; normal events always use a room URL.

Build the Cloudflare-compatible static output with `npm run build`; publish the `dist` directory.

## Safe release helper

Run `npm run release` from the `main` branch to perform the guarded database-and-Git release flow. The helper first checks for commit-worthy changes, prints `supabase db push --dry-run` output, and requires an explicit `yes` before it can reach the real database push. It then runs the frontend tests, production build, Wrangler dry-run, and `git diff --check`; any failure aborts immediately.

After the checks pass, enter a single-line Git commit message. The helper applies the approved Supabase migrations, verifies them with `supabase migration list`, commits all working-tree changes, and pushes GitHub. It deliberately does not run a Cloudflare production deployment because the GitHub push triggers that deployment.

The command assumes the Supabase CLI is already linked to the intended project and that Git authentication is configured. Review the dry-run output before confirming. It never runs database reset or migration-repair commands.

## Phase 2C hosted flow

Audience lobby QR codes are generated in the browser and point to the current site's `/team.html?room=ABC123` URL. Gameplay state remains in Postgres: `start_question` records a 15-second server deadline and a reveal deadline five seconds later. A one-second Supabase Cron job calls a private, idempotent transition function to enter suspense and then score/reveal atomically. No browser timer has authority to accept submissions, change state, or score.

`display_mode` is independent of gameplay `status`, so the Host can show the join screen or leaderboard and then return to the current game without corrupting a running question. Restart Round and Start New Session are separate Host-owner RPCs: restart retains Teams and manual corrections; new session preserves the old event and copies only event metadata and the Guess the Age configuration into a new room.

## Phase 2D celebrity library

Celebrity details and media now live in a Host-private reusable library. Guess the Age questions reference a library record while retaining their existing `question_secrets` DOB as an event-question snapshot. That snapshot keeps historical scoring stable if a library DOB is corrected later; newly saved questions take a fresh snapshot from the corrected library record.

The setup editor searches the private library after a deliberate name/DOB interaction. Existing media is reused without another external lookup. Missing media gets one automatic confident-match Wikipedia attempt, with manual search, HTTPS URL, and upload controls still available. Uploaded JPEGs use `celebrities/<celebrity-id>/<generated-file>.jpg` in the existing bucket and the database stores only the object path.

## Phase 3A I Bet You

Hosted events can now prepare and run an authoritative I Bet You round from Live Control. Joined Teams are randomly distributed into a participation-aware number of persisted groups, each receives a unique seeded category, and all bid/challenge/timer/judgment actions use Host-owner RPCs. The 60-second timer derives from server timestamps; SUCCESS awards the bidder +5 and FAIL awards the challenger +5 through the shared score ledger. Audience hydration drives the stage display, while Team phones remain passive.

Phase 3B adds a curated, locally rendered mascot identity to Teams. Mascots are unique per active event and claimed through anonymous Team RPCs; legacy Teams remain valid with a neutral fallback. During Guess the Age, the public Audience payload exposes only accepted mascot/age markers until authoritative reveal, then exposes shaped Team result rows for the adaptive age-scale presentation. DOB and correct age remain hidden until reveal.

## Run locally
1. Open this folder in VS Code.
2. Run `npm ci`, copy `.env.example` to `.env.local`, and fill in your Supabase URL and publishable key.
3. Run `npm run dev` and open the Vite URL. Raw source files require Vite, not Live Server.
4. Open **Live Control** in Admin and use **Open Audience**. Captains scan the room QR code on a phone that can reach that origin.

## V5 image handling
- The sharp celebrity photo now keeps its natural aspect ratio and uses max-width/max-height, so the Audience frame does not crop it.
- A blurred/darkened copy of the image fills unused space behind it.
- Wikipedia lookup now prefers the original lead image rather than a pre-sized thumbnail.
- Existing celebrity photos saved from V3/V4 may still point at the old thumbnail URL. In the Guess the Age editor, click **Wikipedia** again for that celebrity (or re-upload it) to replace the stored image with the full source.
- Manual uploads are resized/compressed without intentional cropping.


## V6 — Team phone test

For the legacy local prototype only, open `team.html` without a room query through the same Vite origin as Admin and Audience. Each tab uses `sessionStorage`, so you can open several Team tabs and select a different test team in each one.

Flow: Admin starts a Guess the Age question → Team tabs get the 15-second numeric keypad answer control → teams lock in an age → Admin and Audience update their locked-in counts → Admin reveals/scores → Team tabs show their points.

This is still a same-browser/local-origin prototype. For separate physical phones, use the hosted room/QR flow described above.


## V7 changes
- Guess the Age now defaults to 15 seconds per question. Existing prototype rounds using the old 10-second default are migrated to 15 seconds on load.
- Team phones now use a large 0–9 keypad with clear and backspace instead of +/- controls.
- Ages are limited to 1–120 and cannot be locked until a valid number is entered.


## V8 update
- Team phones now show the active celebrity name and image as well as the answer keypad.
- Images preserve their aspect ratio with the same blurred-background treatment as the Audience screen.
- This lets tables play even when the venue screen is difficult to see.


## Team Captain controller rule

Normal room-based events use one Team Captain phone per team. The table discusses
answers; the Captain submits for everyone. The Audience join screen and Team setup
explain this before the existing name/mascot selection. Host team totals are labelled
as registered teams, not live connections. There is no individual player tracking or
live controller-presence measurement in this phase.

The existing `game-night-team-auth` Supabase session persists in the browser, with
automatic token refresh. `teams.auth_user_id` owns the team; the unique
`(event_id, auth_user_id)` constraint allows only one team per Captain session per
event. Reopening the same room URL on the same site in the same browser restores
that team via `get_team_room_state`, across every game. No additional identity store,
player account, controller lease, migration, or Supabase configuration is required.

Joining first checks existing membership. If a join response is lost, it checks
again before displaying an error. Failed refreshes keep retrying while the page is
visible; focus, returning online, and Realtime recovery also refresh saved state.
A failed request never intentionally signs the Captain out or creates a replacement
identity. Accepted submissions stay in Supabase; unsubmitted text is not guaranteed
to survive closing the page.

A second browser cannot claim a team by name: normalized active names are unique,
and submission RPCs enforce team ownership. Guess the Age permits one accepted age
per team/question. Table of Lies retains its existing per-team answer, lie, and vote
constraints and retry behaviour. I Bet You remains Host-operated, with the same team
IDs in its groups; Captain phones remain passive during that game.

This is a browser-session controller, not a hardware lock. Tabs sharing the same
browser session represent the same Captain and still share the database submission
limits. Another person can deliberately create a differently named team; the app
cannot infer physical tables. Clearing browser storage, using private browsing,
changing browser/site origin, or replacing the phone can lose access. Use the
original browser and rescan the same room QR code for ordinary recovery. A future
Host-authorized reassignment should replace the existing team's `auth_user_id`,
keeping its ID, submissions, group membership, and score; it should not create a
second team. That cross-device recovery feature is deliberately not implemented.

Validation: `npm test`, `npm run build`, and (with local Docker/Supabase running)
`npx supabase test db`. The Captain page tests exercise joining, refresh, initial
connection failure, repeated disconnection, and game transitions; the database
identity tests check join retries, independent teams, and rejected cross-team input.
For a venue check, use two separate phones/browser profiles, create an event, join
two teams, refresh one phone, briefly disconnect it, and run all three games while
checking Host/Audience updates. Two tabs in one browser are one Captain, not two teams.

## No Context — functional five-round game

Add **No Context** from **Event → Add round**, open its controls, and choose
**Prepare No Context**. Show it on stage, then **Start round 1**. It uses the same
room URL, Captain session, event subscription and overall score ledger as the other
games. This phase supports hosted Supabase events, not the no-room local prototype.

Each prompt follows this lifecycle:

1. **Responses (45 seconds):** Captains discuss with their table, submit up to 140
   characters, and may edit until the server deadline. One latest response per team.
   Host/Audience see only the image, instruction, countdown and aggregate progress.
2. **Reading:** Responses are shuffled once on the server. The Host pages through
   four anonymous cards at a time; no team identity or vote totals are exposed.
3. **Voting (30 seconds):** One latest vote per participating Captain. Missing an
   answer does not remove voting rights. Ownership, participation, ballot identity,
   deadlines and the no-self-vote rule are checked in Postgres, not just the UI.
4. **Tie break (15 seconds, when needed):** Only a tied vote group touching the
   podium participates. Fixed places stay fixed. Separate tied groups are resolved
   independently; each group gets only one tiebreak. Remaining equal totals are
   ordered randomly on the server and the result is persisted. No original votes,
   or no meaningful contest, resolve directly without trapping the Host in a loop.
5. **Locked results and reveal:** Host reveals **3rd → 2nd → 1st**. Each reveal
   publishes that response's team/mascot, determining vote count and **1/3/5 points**.
   Scores enter the shared ledger at the official placement reveal to avoid leaking
   unrevealed winners through score totals. Unique play/team award keys make retries
   idempotent. Non-podium authors remain anonymous.
6. **Next Round:** Loads a fresh play with empty inputs, votes, tie and reveal state;
   teams, Captain sessions and previous scores remain. After round five,
   **Finish No Context** opens the normal event leaderboard.

Close buttons allow the Host to end either timed phase early, with confirmation
when inputs are outstanding and more than five seconds remain. A server-side
`pg_cron` job closes expired phases even if every browser disconnects. Browser
countdowns are informational and polling/Realtime restores authoritative state.

**Restart No Context** resets all five plays and removes only this game's ledger
awards. It preserves teams, manual corrections, other game scores and the event.
New play IDs reject stale requests from before the restart. **Start New Session**
retains the existing project convention (a new event/room, with Guess the Age copied);
prepare No Context separately in that new event.

### Local test content and database setup

`src/no-context-content.js` supplies five temporary prompt/media records. Their
hand-authored SVG illustrations are in `public/no-context/`. Setup snapshots the
records into `no_context_prompts`, so gameplay does not depend on the JavaScript
array after preparation. This is intentionally not a content manager. Media is
represented as a typed record for future replacement, but only local images are
accepted in this phase.

Apply `supabase/migrations/202609240020_no_context.sql` before deploying this
frontend. It adds the prompt/play/participation/response/vote tables, constrained
Host and Captain RPCs, safe state projections, a ledger uniqueness index and the
one-second transition job. The existing anonymous Auth, Realtime and Cron setup is
reused. There is no new external service or storage configuration. Direct table
reads are revoked, including from authenticated Hosts; clients use shaped RPCs.

Frontend integration lives in `src/no-context.js`/`.css`, `admin.js`, the Audience
and Team entry modules, Host/Team services, the Admin application and round navigator.
The existing three games retain their gameplay rules.

### Validation and deliberate limits

- `npm test` covers Captain editing/voting, deadline displays, focus/draft preservation,
  pagination, escaping, reveal feedback, Host action ordering and existing games.
- `npx supabase test db` includes `120_no_context.test.sql`: five-round progression,
  privacy, ownership, automatic/manual closure, changeable votes, multiple tie groups,
  degenerate rounds, staged scoring, restart and stale-request protection.
- `scripts/no-context-smoke.mjs` runs the complete five-round loop through local Auth
  and PostgREST with three independent Captains, then deletes its test event/users.
  Supply local `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` through
  environment variables. It refuses non-local URLs. Never embed keys in source.
- `npm run build` produces the static frontend, including all five local SVGs.

Participation is frozen at each response phase's start. Teams that become available
later participate in the next round. Captains may omit an answer and still vote.
A sole response takes first place (5 points); two responses can take first and
second; empty rounds award nothing. All-zero votes use persisted random ordering.
For tiebreak winners the reveal labels the final tiebreak vote count explicitly.
There is no content moderation or answer filtering beyond whitespace/length and
safe HTML rendering; test this with a trusted group before public venue use.
Captain identity remains a persistent browser session, not a physical-device lock.
Cross-device reassignment and production content/presentation remain later work.
