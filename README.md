# Game Night Admin V5

## Phase 2A setup

The Admin and room-query Team flow now use Supabase Auth and the database-backed event identity layer. Copy `.env.example` to `.env.local`, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then run `npm run dev`.

Admin requires a permanent email/password Host account. A Team joins at `team.html?room=ABC123` with anonymous Supabase Auth. Opening `team.html` without a room query intentionally retains the same-browser local gameplay prototype until Guess the Age moves to Supabase.

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
2. Right-click `index.html` and choose **Open with Live Server**.
3. Open **Live Control** in Admin and use **Open Audience**.

## V5 image handling
- The sharp celebrity photo now keeps its natural aspect ratio and uses max-width/max-height, so the Audience frame does not crop it.
- A blurred/darkened copy of the image fills unused space behind it.
- Wikipedia lookup now prefers the original lead image rather than a pre-sized thumbnail.
- Existing celebrity photos saved from V3/V4 may still point at the old thumbnail URL. In the Guess the Age editor, click **Wikipedia** again for that celebrity (or re-upload it) to replace the stored image with the full source.
- Manual uploads are resized/compressed without intentional cropping.


## V6 — Team phone test

Open `team.html` through the same Live Server origin as Admin and Audience. Each tab uses `sessionStorage`, so you can open several Team tabs and select a different test team in each one.

Flow: Admin starts a Guess the Age question → Team tabs get the 15-second numeric keypad answer control → teams lock in an age → Admin and Audience update their locked-in counts → Admin reveals/scores → Team tabs show their points.

This is still a same-browser/local-origin prototype. Separate physical phones will need the next backend/QR-room step.


## V7 changes
- Guess the Age now defaults to 15 seconds per question. Existing prototype rounds using the old 10-second default are migrated to 15 seconds on load.
- Team phones now use a large 0–9 keypad with clear and backspace instead of +/- controls.
- Ages are limited to 1–120 and cannot be locked until a valid number is entered.


## V8 update
- Team phones now show the active celebrity name and image as well as the answer keypad.
- Images preserve their aspect ratio with the same blurred-background treatment as the Audience screen.
- This lets tables play even when the venue screen is difficult to see.
