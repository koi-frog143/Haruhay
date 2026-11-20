# Haruhay frontend

React + TypeScript + Vite implementation of the Haruhay website, authentication previews, resident portal and administrator workspace from Figma.

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
- Register a visitor: http://localhost:5173/#/resident/logbook/register
- Resident access history: http://localhost:5173/#/resident/logbook/access-history
- Maintenance tickets: http://localhost:5173/#/resident/maintenance
- New maintenance request: http://localhost:5173/#/resident/maintenance/new
- Maintenance ticket details: http://localhost:5173/#/resident/maintenance/TCK-1042
- Billing and payments: http://localhost:5173/#/resident/payments
- Resident Holding Station: http://localhost:5173/#/resident/holding-station
- Front desk Holding Station: http://localhost:5173/#/front-desk/holding-station
- Resident profile: http://localhost:5173/#/resident/profile
- Payment history: http://localhost:5173/#/resident/payments/history
- Community board: http://localhost:5173/#/resident/community

Use the links in the forms to switch screens. Browser Back and Forward also work.
Stop the preview with Ctrl+C. Do not open index.html directly; Vite serves the TypeScript application.

No Spring Boot server, database, API keys, or environment files are needed.
These forms validate locally without sending or saving credentials. A valid login opens the resident dashboard UI preview; registration and password reset display preview confirmations without creating an account or sending email. The property dropdown contains one clearly labeled demo property. The login screen's administrator preview button opens the admin dashboard directly, without authentication.

Try a valid email and any non-empty password for login; registration requires a name, valid email, password of at least eight characters, and demo property. Password visibility can be toggled. Check the layout at desktop and mobile widths.

## Checks and production preview

```bash
npm run lint
npm run build
npm run preview
```

The production preview URL is normally http://localhost:4173. It also runs without the backend.
The existing Vite /api proxy is retained for future integration; these screens never call it.

## Resident interactions

The resident and admin portals share sample records and browser session storage. Changes survive navigation and refresh in the same tab; this is a frontend preview with no server authentication, real notification delivery or payment processing. Staff review actions update local preview records only.

- Access-log export opens a date-range dialog and exports matching records from the current activity filter as CSV.
- Payment history lets residents select individual records for CSV export. These files are spreadsheets, not official receipt documents.
- Maintenance comments use a dialog and persist by ticket. Ticket creation, list totals, resolved history and dashboard counts use the same records. Unknown ticket URLs display a missing-record state.
- Visitor requests appear separately in the logbook as pending review, with local cancellation. Requests never count as actual arrivals or guests on site. Expected arrival times use Philippine time.
- Upcoming payments show the sample bill breakdown and due date. Payment methods save only a preferred channel name, with no account details or payment submission.
- Search covers resident pages, tickets, packages, visitor requests, announcements and payment history. A search button is available on phone layouts.
- Notifications derive from local records, honor resident reminder preferences and persist read status. Support creates local drafts; no message is sent. Speak with the front desk for actual assistance.
- All services opens a destination list. Community View all opens a searchable announcement list, and individual cards open notice details.

Figma supplies lightweight preview dialogs for exports and comments. Functional fields were added using the same dialog colors, type and spacing. Search, support drafts, notifications, payment preferences and service/announcement lists use matching minimal dialogs because detailed designs for those interactions were not supplied. Billing and activity fixtures retain the October 2026 design period and are explicitly labeled as sample data; counts reflect the available records rather than Figma's illustrative totals.

For browser integration verification, start Vite and an isolated Chrome instance with remote debugging on port 9227, then run `node scripts/check-resident-ui.mjs` from this folder. The script creates its own browser tab, clears only that tab's session storage, checks all 12 resident routes at 1440px and 390px, and verifies exports, persistence, errors, focus, navigation and the existing Holding Station routes. Screenshots, asset geometry, downloaded CSVs and results are written to the ignored `.ui-verification` folder. `UI_ORIGIN` and `UI_DEBUG` can override the local URLs.

## Assets

Figma artwork is stored locally in public/assets/auth, public/assets/landing, public/assets/dashboard and public/assets/admin. Admin artwork reuses existing files when their content matches exactly; admin-artwork.json maps each design screen to its local assets and original SVG dimensions. DM Sans is bundled locally with its OFL license, so the UI does not depend on a font CDN.

## Administrator workspace

Use **Preview administrator workspace** on the login screen or open these hash routes:

- Dashboard: `#/admin/dashboard`
- Resident directory: `#/admin/residents`
- Resident details: `#/admin/residents/RES-0204`
- Visitor logbook: `#/admin/logbook`
- Maintenance operations: `#/admin/maintenance`
- Maintenance details: `#/admin/maintenance/TCK-1043`
- Holding Station manager: `#/admin/holding-station`
- Billing overview: `#/admin/billing`
- Payment approvals: `#/admin/payments/approvals`
- Announcements: `#/admin/announcements`
- Property and staff settings: `#/admin/settings`

The dashboard derives metrics and collection charts from the same records used by the modules. Directory search, filters, add/edit forms and missing-record states work locally. Resident detail links can restrict visitor/payment lists to that resident. Contact actions save drafts and never send messages.

Visitor requests remain pending until registered as **Expected** visits. Staff must separately record check-in and check-out; requests and expected visits do not count as guests on site. Arrival and activity times use Philippine time.

Maintenance priority is separate from workflow status. Technician assignment, priority, status, comments and activity updates persist and appear in the resident's own maintenance screens. Property-wide tickets belonging to other residents stay out of the current resident's list.

Payment review shows sample transaction evidence, requires a verification checkbox, and requires a reason for rejection. Approvals update local collected totals, remaining balances and resident payment history. No payment is processed, no external evidence is fetched and no real transaction is verified. Monthly rules determine the selected preview period's charges; historical payment amounts are retained.

Announcements can be created, edited, published or kept as drafts. Only published notices appear on the resident board. Property, staff roles/permission flags, billing rules, notification preferences and security/retention policies have editable dialogs. Reports export selected date ranges as CSV for residents, visits, payments, maintenance and held items.

Design assumptions and boundaries:

- The Figma dialogs contain short preview descriptions rather than complete forms. Functional fields expand those dialogs using the existing colors, typography and spacing.
- Sample totals are derived from six initial resident records and the available transactions, rather than reproducing illustrative Figma counts such as 48 residents. Existing resident/package identifiers are preserved, including the current resident `RES-0204`.
- This preview treats each room as one active resident assignment. Inactive records can retain a room. Room capacity/bed management is not modeled.
- Local storage is session storage in the same browser tab. There is no cross-device synchronization, server authorization, automatic retention deletion, email delivery or PDF receipt generation. Staff permissions and security options are saved policy preferences, not enforced backend controls.
- The existing front desk URL, release validation, shelf occupancy, inquiries, editing/deletion and history use the same HoldingStation component inside the admin layout. Package release identity checks remain mandatory regardless of the saved security-policy preference.

Run `node scripts/check-admin-ui.mjs` with Vite and the same isolated Chrome debugging setup described above. It checks all 11 admin screens at desktop and narrow widths, cross-portal state changes, forms, settings, exports, keyboard focus, navigation and the Holding Station workflows. Its screenshots, local asset geometry, CSV downloads and results are saved under `.ui-verification/admin`. Re-run the resident browser checks after modifying shared data helpers.

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
