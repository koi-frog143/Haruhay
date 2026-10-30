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
