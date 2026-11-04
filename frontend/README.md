# Haruhay frontend

React + TypeScript + Vite implementation of the Haruhay web landing page (18:20) and authentication screens from Figma: login (18:106), registration (18:158), and password reset (18:217).

## Preview without a backend or database

Open a terminal in this `frontend` folder and run:

```bash
npm ci
npm run dev
```

Open the localhost URL printed by Vite (normally http://localhost:5173).

- Landing page (default): http://localhost:5173/
- Login: http://localhost:5173/#/login
- Registration: http://localhost:5173/#/register
- Password reset: http://localhost:5173/#/forgot-password
- Resident dashboard: http://localhost:5173/#/resident/dashboard
- Visitor logbook: http://localhost:5173/#/resident/logbook
- Maintenance tickets: http://localhost:5173/#/resident/maintenance
- New maintenance request: http://localhost:5173/#/resident/maintenance/new
- Maintenance ticket details: http://localhost:5173/#/resident/maintenance/TCK-1042
- Billing and payments: http://localhost:5173/#/resident/payments
- Resident Holding Station: http://localhost:5173/#/resident/holding-station
- Front desk Holding Station: http://localhost:5173/#/front-desk/holding-station
- Resident profile: http://localhost:5173/#/resident/profile
- Payment history: http://localhost:5173/#/resident/payments/history

Use the links in the forms to switch screens. Browser Back and Forward also work.
Stop the preview with Ctrl+C. Do not open index.html directly; Vite serves the TypeScript application.

No Spring Boot server, database, API keys, or environment files are needed.
These forms validate locally without sending or saving credentials. A valid login opens the resident dashboard UI preview; registration and password reset display preview confirmations without creating an account or sending email. The property dropdown contains one clearly labeled demo property. The administrator link explains that its workspace is outside this preview.

Try a valid email and any non-empty password for login; registration requires a name, valid email, password of at least eight characters, and demo property. Password visibility can be toggled. Check the layout at desktop and mobile widths.

## Checks and production preview

```bash
npm run lint
npm run build
npm run preview
```

The production preview URL is normally http://localhost:4173. It also runs without the backend.
The existing Vite /api proxy is retained for future integration; these screens never call it.

## Assets

Figma artwork is stored locally in public/assets/auth, public/assets/landing, and public/assets/dashboard. DM Sans is bundled locally with its OFL license, so the UI does not depend on a font CDN.

## Holding Station

The former standalone holding-station page is integrated into the React application.
Use the resident sidebar or dashboard package card, or open either Holding Station URL above.
The Resident / Front desk links switch between the two frontend workspaces.

- Residents can see their ready items, pickup codes, all available items, and collection history.
- Front desk can search/filter records, register items, edit descriptions/shelves, view history, and confirm deletions.
- Shelf occupancy prevents two ready items from using the same slot. Full shelves disable registration.
- Release requires a presented ID, claimant name, and receipt confirmation. Owner IDs must match; representatives require an explicit authorization check.
- Walk-in inquiries record visitor details and search by resident and/or tracking number. If both are supplied, both must match.
- Dashboard pickup counts use the same records. Changes and inquiries survive navigation and refresh within the same browser session.
- Light/dark controls affect Holding Station content without changing other screens.

HoldingStation.tsx and HoldingStation.css contain the UI. holdingData.ts contains the sample records and shared session-storage helpers.
Sample resident IDs are RES-0204 (current resident), RES-0101 (Marco), and RES-0312 (Lea).
The front desk view is a preview, not an authenticated staff area. Backend persistence, real notifications, and staff authorization are not connected.
No standalone folder or separate server is required.