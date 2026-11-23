# Visitor QR passes and logbook

Visitor requests, approvals, passes, visits, movements and audit events are now database-backed in live workspaces. Sample previews still use their original isolated fixtures. Resident entry/exit credentials remain deferred.

## Run and use locally

Follow [REGISTRATION.md](REGISTRATION.md) for credentials and backend startup. Flyway applies V7 and V8 automatically. The dev profile creates and reuses `.local/visitor-pass.key`.

From `haruhay-backend/haruhay-backend`:

```powershell
.\mvnw.cmd spring-boot:run '-Dspring-boot.run.profiles=dev'
```

This selects the existing local H2 database, `.local/haruhay-live`. Existing owner credentials are retained. To bootstrap a new empty database, configure `DEV_OWNER_EMAIL`, `DEV_OWNER_PASSWORD` and `DEV_OWNER_NAME` as described in the registration guide. The dev profile uses local-file registration email. The existing `start-gmail.ps1` remains available for deliberately testing real registration emails; visitor passes never send emails automatically.

From `frontend`, in a second terminal:

```powershell
npm.cmd ci
npm.cmd run dev
```

1. Sign in at `http://localhost:5173/#/login` as a resident with an active tenancy.
2. In **Logbook**, select **Invite a guest**. Enter their name and purpose. Contact is optional. Open **Planning for another day?** to choose a Philippine calendar date. **Invite again** prefills details from a previous visit in a new request.
3. Staff select the property and open **Needs review**. Select **Approve visit** or **Decline visit**. The resident can read the decline reason.
4. The resident selects **Share pass** and copies the private guest link. The guest can open or refresh it without signing in. Send the link from the deployed site when the guest uses another device. Localhost only works on the Haruhay development machine.
5. On arrival, use **Scan pass** or **Find guest**. Review the guest, host, room and status. Check the presented ID and select **Confirm check-in**. If a camera fails, **Find guest** opens record search. Manual confirmation requires a reason.
6. At departure, scan again or select **Who’s inside?**, find the open record and select **Confirm checkout**. Staff can check out an open visit after expiry or without the QR.
7. Use **Export CSV** for the visible records. Consult **History**, **Record correction**, and **Property activity** for evidence.

### Guard setup

Owner → **Visitor logbook → Manage guards**. Create a dedicated staff email, name and initial 12+ character password. Share these credentials privately; no email is sent. The owner controls assignment enablement and **review permission**. Use the ordinary sign-in form: guards land at `#/guard/logbook`, with only assigned properties and a sign-out action.

Assignments are real database permissions, separate from the frontend sample staff settings. Review permission allows request approval/decline, walk-in authorization, cancellation and administrative amendments. Any enabled assigned guard can validate passes and record verified arrival/departure. Disabling an assignment takes effect on the next API request, including existing sessions.

To preserve the existing account-role constraint, staff identity remains an account with the base APPLICANT role; enabled `property_guard_assignments` derive the API/UI GUARD identity. Security does not trust that derived label: every staff operation queries current ownership/assignment and review permission. A guard gains no owner, billing, Holding Station or resident-services authority from this assignment. Owner-only account creation and property assignment cannot attach a guard role to an existing resident email.

### Scanner requirements and fallback

Camera access requires a secure context (HTTPS or localhost), a supported browser and granted camera permission. Remote phones cannot access a development server's `localhost`; use an HTTPS deployment/tunnel if testing on a separate device. Camera denial, unsupported media APIs and unavailable cameras leave manual pass entry available. Record search is also available for controlled manual verification.

The browser scanner uses [ZXing Browser](https://github.com/zxing-js/browser); QR rendering uses [node-qrcode](https://github.com/soldair/node-qrcode). Both run locally. Scanner controls stop on success/close/unmount. Only the Haruhay visitor token format is accepted by the backend. School/government ID barcode integration is outside scope; staff record ID type and optional last four alphanumeric characters, not full ID numbers/photos.

## States, transactions and security

| Entity | Lifecycle |
| --- | --- |
| Request | PENDING → APPROVED / DECLINED / CANCELLED; an approved expected visit can also be cancelled |
| Visit | EXPECTED → CHECKED_IN → CHECKED_OUT; EXPECTED may become CANCELLED |
| Credential | ACTIVE → REPLACED / REVOKED / COMPLETE; expiry is checked separately |
| Movement | Append-only ENTRY and EXIT, one of each per visit |
| Audit | Append-only actor, server time, event and reason; never includes scan secrets |

Separate tables: `visitor_profiles`, `visitor_requests`, `visitor_visits`, `visitor_qr_credentials`, `visitor_movements`, `visitor_audit`, `property_guard_assignments`. Existing Account, Property, Room and Tenancy remain intact. Request tenancy determines the host/property; the client cannot supply an arbitrary resident identity. Only an active host can request/approve/enter; checkout remains possible when tenancy eligibility later changes.

Passes use two independent credentials derived with HMAC-SHA256 from a random credential ID and a persistent 32-byte key. The QR retains the `haruhay:visit:<base64url>` format. The guest link uses a separate token in `/#/visitor-pass/<token>`. The fragment stays out of HTTP request paths and is submitted in a POST body. The public route returns the QR, property name and entry window for just that pass. It has no movement controls. The database keeps only verification hashes. Raw credentials stay out of log representations, record lists, audit history and CSV. Both pass endpoints send `Cache-Control: no-store`.

Set `VISITOR_PASS_KEY` in deployment to a base64-encoded, randomly generated 32-byte secret. Keep it consistent across restarts and instances and back it up securely with the database. For dev, `HARUHAY_VISITOR_PASS_KEY_FILE` overrides the local file path. If the key changes, issued scanner QR codes still verify against their hashes. Reopening existing links requires the original key. Staff or the resident can explicitly replace a pass before entry. V7 credentials retain their original validity and require explicit replacement to get a shareable link.

Without a date, a new invitation allows entry for 24 hours after approval. With a date, entry starts at the later of approval or midnight on the selected Philippine calendar day and ends at the next local midnight. Approval rejects a date already in the past. V8 preserves legacy arrival and departure windows. Actual check-in and checkout use separate server timestamps.

Replacement invalidates all earlier links and QR copies. Revocation blocks new entry until an authorized replacement. The most recent revoked or expired pass can still identify its open visit for a controlled checkout under the existing audit rules. Staff can also check out through record search. Completed visits cannot be opened for entry again.

All movement/cancellation/credential writes lock the request before the visit. DB uniqueness on `(visit_id, movement)` prevents duplicate entry/exit evidence. Repeated same-state movement calls return an already-recorded result. Repeating ENTRY after completed checkout is denied. An idempotent repeated request approval returns the same visit. Administrative correction appends a note; voiding keeps movement evidence, cancels an expected visit and revokes its pass. An open visit must first be checked out before it can be voided. Voided records remain visible and labelled; inside counts reflect open visits.

Denied validation/movement outcomes are committed as audit events. Invalid scans do not reveal another property's visitor details. Property activity shows the latest 250 audit events. Rate limiting uses the existing bounded, per-process IP limiter: scan and movement requests share protection with authentication/verification (`haruhay.attempt-limit`, default 60 attempts per ten minutes). Do not trust unvalidated forwarded IP headers. A multi-instance deployment needs shared rate limiting at the application gateway or datastore. Session authentication and CSRF remain required.

Server timestamps are stored with timezone, normalized to UTC; every visitor UI/export time is displayed in Asia/Manila. In-memory visitor snapshots are invalidated on account/sample-mode changes and sign-out. Generation/identity checks discard late fetches; property switches clear the list/dialog and invalidate prior requests. Dashboard/access-history helpers consume these saved records rather than live-mode sample entries. Refresh/navigation reloads backend records; there is no polling or push synchronization between different browsers.

## API

All endpoints are under `/api/logbook`, authenticated and CSRF-protected for POST. UUID path/query identifiers are validated by Spring. Every property operation checks the current database assignment/owner, not a browser role.

| Method / path | Purpose |
| --- | --- |
| GET `/properties` | Owned/assigned properties and current review capability |
| GET `/hosts?property=UUID` | Active hosts for authorized staff; omit property for own active tenancies |
| GET `/records?property=UUID` | Staff property records; omit property for own hosted records (owners receive records across their owned properties for dashboard totals) |
| POST `/requests` | `{tenancyId,fullName,purpose,contact?,plannedDate?}` with optional `YYYY-MM-DD` date. Legacy clients may still send both ISO `arrival` and `departure` instead. |
| POST `/requests/{id}/review` | `{action: APPROVE or DECLINE,reason}`; owner/reviewer |
| POST `/requests/{id}/cancel` | Host or authorized reviewer, before entry |
| POST `/visits/{id}/pass` | `{replace:false}` opens or issues the current pass. `{replace:true}` replaces it and records an audit event. |
| POST `/visits/{id}/pass/revoke` | `{reason}` revokes the current pass. Host or authorized reviewer. |
| POST `/properties/{property}/scan` | `{token}`; returns allowed/message or verified record; no movement |
| POST `/properties/{property}/visits/{id}/movement` | `{action:ENTRY or EXIT,method:QR or MANUAL,token?,identityConfirmed,idType?,idLastFour?,reason?}` |
| POST `/walk-ins` | `{visitor:{...request fields},hostAuthorized:true,reason}`; reviewer creates expected visit, then explicit identity/check-in |
| POST `/properties/{property}/visits/{id}/amend` | `{action:CORRECTION or REVOKE or VOID,reason}`; reviewer required |
| GET `/properties/{property}/visits/{id}/history` | Visit audit history |
| GET `/properties/{property}/activity` | Latest property audit including denied/invalid scans |
| GET / POST `/properties/{property}/guards` | Owner lists/creates guards (`email,fullName,password,canReview`) |
| POST `/properties/{property}/guards/{account}` | Owner updates `{enabled,canReview}` |

Outside the authenticated namespace, `POST /api/public/visitor-pass` accepts `{token}` with CSRF from `/api/auth/csrf`. It returns display data and the QR for that pass. Ordinary record lists expose no password hashes or token hashes. A failed scan/movement can return HTTP 200 with `allowed:false`, preserving the denial audit transaction; consumers must check that field. Authorization, validation and state conflicts use 4xx responses with clear messages. Successful no-body mutations return 204.

## Verification

From the backend directory: `.\mvnw.cmd test`. Tests require an isolated `registration-tests` H2 database or a dedicated `haruhay_registration_test` PostgreSQL database; fixture cleanup rejects other names. Never point these tests at normal local/production records. Existing registration, monthly billing and Holding Station tests run alongside `VisitorTests`.

For PostgreSQL configure `SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:<test-port>/haruhay_registration_test`, username/password and `SPRING_DATASOURCE_DRIVER_CLASS_NAME=org.postgresql.Driver` in that test terminal. The destructive fixture cleanup applies only to this dedicated test database. Remove these variables before starting the normal app.

From frontend: `npm.cmd run lint`, `npm.cmd run build`. Browser scripts use a disposable backend with local-file email, `UI_ORIGIN`, `UI_DEBUG` (Chrome debugging endpoint), and `DEV_OWNER_PASSWORD`. Run `scripts/check-onboarding-ui.mjs` first to seed its isolated scenario, then `scripts/check-live-workspaces-ui.mjs` while activity is empty, followed by `scripts/check-visitor-qr-ui.mjs`. `check-approval-billing-ui.mjs` and `check-holding-fixes-ui.mjs` provide adjacent regression checks. Ignored artifacts go under `frontend/.ui-verification/`.

After `check-visitor-qr-ui`, restart the disposable backend with the same database file and pass key. Run `scripts/check-visitor-restart-ui.mjs` to verify pass recovery, movement history, direct routes, Back/Forward, and property isolation. Use a fresh Vite process for suites that import source modules directly.

The visitor browser suite uses 390 px and 1440 px layouts. It checks anonymous pass refresh, QR decoding, optional dates, replacement, keyboard focus, ID confirmation, camera denial, and manual checkout after expiry. Scanning with a physical camera requires a camera-enabled device.

The implementation follows the desktop and narrow front desk screens in the [Haruhay redesign](https://www.figma.com/design/BrWLcw8zdtGPEEXgmSzRJ4/?node-id=165-2). The invite form reuses the existing visitor design and dialog components. The guest pass uses the same cards, typography, and colors.
