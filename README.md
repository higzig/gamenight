# Game Night Admin V5

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
