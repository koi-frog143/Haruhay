# Visitor QR passes and logbook

Visitor requests, approvals, passes, visits, movements and audit events are now database-backed in live workspaces. Sample previews still use their original isolated fixtures. Resident entry/exit credentials remain deferred.

## Run and use locally

Follow [REGISTRATION.md](REGISTRATION.md) for the existing owner credentials and backend startup. This feature needs no new secrets, SMTP configuration or external QR service. Flyway applies V7 automatically. The project targets Java 21 / Spring Boot 4.1.1; development verification used Temurin 25, H2 and PostgreSQL 18.

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

1. Sign in at `http://localhost:5173/#/login`. Complete the existing resident registration, email verification and owner approval flow to obtain an active tenancy.
2. Resident: **Logbook → Add visitor**. Enter identity/contact, purpose and both expected times. If there are several active tenancies, select the authorized host/property. Pending requests do not create visits or count as arrivals.
3. Owner: **Visitor logbook**, choose the property and **Review request**. Approve or decline with a reason. Approval creates an **Expected** visit.
4. Resident: open **Visitor pass → Generate visitor pass**. Download the QR image or share/copy its code privately. A visitor needs no account. After refresh, the previous code cannot be redisplayed; explicitly choose **Replace** to invalidate old copies and obtain a new pass.
5. Owner or guard: **Scan QR**, start the camera or paste the pass code. Validate, check the presented ID and explicitly **Confirm check-in**. Scanning alone records no movement. Without a readable pass, find the expected visit and use **Verify entry**, recording the manual verification reason.
6. At departure, scan again or find the open visit and select **Check out**. Confirm explicitly. An expired or revoked arrival pass never prevents controlled checkout through the open record.
7. Use search/status filters and **Export CSV** for the visible property-scoped records. Residents see and export only their hosted records. **History**, **Record correction** and **Property activity** retain actor/time/reason evidence.

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

Tokens contain 32 cryptographically random bytes, encoded as `haruhay:visit:<base64url>`, with no personal information. Only SHA-256 verification hashes are stored. The secret exists only in the issuance response and component memory, or in a pass deliberately downloaded/shared by the resident. It is excluded from workspace caches, list/history endpoints, database audit and CSV exports. Sensitive request/response DTOs redact their logging representation. Reissue is explicit and audited; request/visit locks replace the prior active token atomically. Closing the pass loses its raw token, so save it before closing.

Entry is permitted from the exact expected arrival (inclusive) until expected departure (exclusive), using the server clock. There is no implicit early-arrival grace period. A different window requires a new request. Pass expiry equals the approved departure. A revoked pass prevents QR and manual entry until an authorized new pass is issued. Revoked/replaced/expired credentials can identify their already-open visit for checkout; property scope and explicit staff confirmation still apply. Completed visits cannot re-enter: a returning visitor needs a new request/visit.

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
| POST `/requests` | `{tenancyId,fullName,contact,purpose,arrival,departure}` (ISO timestamps with offset) |
| POST `/requests/{id}/review` | `{action: APPROVE or DECLINE,reason}`; owner/reviewer |
| POST `/requests/{id}/cancel` | Host or authorized reviewer, before entry |
| POST `/visits/{id}/pass` | `{replace:false}` for first issuance; `{replace:true}` for audited replacement |
| POST `/properties/{property}/scan` | `{token}`; returns allowed/message or verified record; no movement |
| POST `/properties/{property}/visits/{id}/movement` | `{action:ENTRY or EXIT,method:QR or MANUAL,token?,identityConfirmed,idType?,idLastFour?,reason?}` |
| POST `/walk-ins` | `{visitor:{...request fields},hostAuthorized:true,reason}`; reviewer creates expected visit, then explicit identity/check-in |
| POST `/properties/{property}/visits/{id}/amend` | `{action:CORRECTION or REVOKE or VOID,reason}`; reviewer required |
| GET `/properties/{property}/visits/{id}/history` | Visit audit history |
| GET `/properties/{property}/activity` | Latest property audit including denied/invalid scans |
| GET / POST `/properties/{property}/guards` | Owner lists/creates guards (`email,fullName,password,canReview`) |
| POST `/properties/{property}/guards/{account}` | Owner updates `{enabled,canReview}` |

Lists deliberately expose no password hashes or token hashes. A failed scan/movement can return HTTP 200 with `allowed:false`, preserving the denial audit transaction; consumers must check that field. Authorization, validation and state conflicts use 4xx responses with clear messages. Successful no-body mutations return 204.

## Verification

From the backend directory: `.\mvnw.cmd test`. Tests require an isolated `registration-tests` H2 database or a dedicated `haruhay_registration_test` PostgreSQL database; fixture cleanup rejects other names. Never point these tests at normal local/production records. Existing registration, monthly billing and Holding Station tests run alongside `VisitorTests`.

For PostgreSQL configure `SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:<test-port>/haruhay_registration_test`, username/password and `SPRING_DATASOURCE_DRIVER_CLASS_NAME=org.postgresql.Driver` in that test terminal. The destructive fixture cleanup applies only to this dedicated test database. Remove these variables before starting the normal app.

From frontend: `npm.cmd run lint`, `npm.cmd run build`. Browser scripts use a disposable backend with local-file email, `UI_ORIGIN`, `UI_DEBUG` (Chrome debugging endpoint), and `DEV_OWNER_PASSWORD`. Run `scripts/check-onboarding-ui.mjs` first to seed its isolated scenario, then `scripts/check-live-workspaces-ui.mjs` while activity is empty, followed by `scripts/check-visitor-qr-ui.mjs`. `check-approval-billing-ui.mjs` and `check-holding-fixes-ui.mjs` provide adjacent regression checks. Ignored artifacts go under `frontend/.ui-verification/`.

After `check-visitor-qr-ui`, stop and restart that disposable backend with the **same file-backed database**, then run `scripts/check-visitor-restart-ui.mjs`. It checks stored movement evidence, direct routes, refresh, Back/Forward, the existing resident-specific logbook URL, and delayed responses during property switching. Its second test property is created only in that disposable database. Use a fresh Vite process when running scripts that directly import source modules, to avoid duplicate module instances left over from hot reload during development.

Verification performed on 2026-11-23:

- Backend: **43 tests passed on isolated H2; 43 on dedicated PostgreSQL 18**. Includes registration/billing/Holding Station regression tests, concurrent entry and pass replacement, lifecycle/permissions, validation, CSRF and secret redaction.
- Frontend lint/build passed. QR/scanner code loads on demand. Vite retains a non-failing main-chunk size advisory.
- Dependency audit reports nine moderate advisories in the existing ESLint/TypeScript lint toolchain through minimatch; those dependency versions were unchanged by this feature. No advisories were reported for the added QR runtime libraries. Lint-toolchain dependency updates remain follow-up maintenance.
- Browser: **96 checks passed** across registration (17), existing live resident/admin pages (48), approval/billing (6), Holding Station cache/release (7), visitor QR/walk-in flow (14), and restart/navigation/property isolation (4).
- Viewed actual screenshots of desktop admin/resident logbooks, narrow resident/guard logbooks, the QR pass and identity confirmation. Browser geometry, dialog focus, camera denial/manual fallback, generated PNG decoding, exports and simulated server failure were checked. Screenshots are in the ignored verification folders above. Physical-camera scanning was not performed.
- Checked the disposable server and final test logs: no raw visitor-pass tokens were present.
- The configured normal local H2 test database was backed up under `.local/backups/visitor-qr-2026-11-23T11-23-01.128344100Z/` before clearing test accounts/registration dependencies. Comparison checks preserved the existing owner record/password, one property, two rooms and room pricing. Unrelated owner inquiry history was retained; the archived legacy database was not touched. V7 applies when the normal backend next starts.

Figma references inspected: resident logbook **18:479**, register visitor **18:610**, admin logbook **18:2055**, file **BrWLcw8zdtGPEEXgmSzRJ4**. The workbook's UC-05–UC-08, visitor activity and class diagrams informed separation of visitor identity, visit approval, QR credential and explicit movements. Scanner, pass, staff-permission and audit dialogs are adaptations using existing Haruhay layout/dialog components and colors because those detailed states are absent from the supplied Figma screens. Native dialog keyboard/focus behavior is retained. Passes are not automatically emailed; departure is never inferred from a second scan.

Physical-camera/device scanning requires manual testing on camera hardware. Automated camera-denial/manual fallback checks do not establish physical-camera reliability. ID-provider verification, resident movement QR, automatic retention/archival policies, staff password-recovery/self-service, distributed rate limiting and real-time cross-browser updates remain separate integration work.
