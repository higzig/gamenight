# Game Night Admin V5

## Phase 2A setup

The Admin and room-query Team flow now use Supabase Auth and the database-backed event identity layer. Copy `.env.example` to `.env.local`, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then run `npm run dev`.

Admin requires a permanent email/password Host account. A Team joins at `team.html?room=ABC123` with anonymous Supabase Auth. Opening `team.html` without a room query intentionally retains the same-browser local gameplay prototype until Guess the Age moves to Supabase.

Build the Cloudflare-compatible static output with `npm run build`; publish the `dist` directory.

## Phase 2C hosted flow

Audience lobby QR codes are generated in the browser and point to the current site's `/team.html?room=ABC123` URL. Gameplay state remains in Postgres: `start_question` records a 15-second server deadline and a reveal deadline five seconds later. A one-second Supabase Cron job calls a private, idempotent transition function to enter suspense and then score/reveal atomically. No browser timer has authority to accept submissions, change state, or score.

`display_mode` is independent of gameplay `status`, so the Host can show the join screen or leaderboard and then return to the current game without corrupting a running question. Restart Round and Start New Session are separate Host-owner RPCs: restart retains Teams and manual corrections; new session preserves the old event and copies only event metadata and the Guess the Age configuration into a new room.

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
