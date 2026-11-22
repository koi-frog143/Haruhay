# Haruhay registration: signup, one email verification, owner approval

Room browsing, owner-managed pricing, applicant room selection and versioned accepted agreements are documented in [ROOMS.md](ROOMS.md). New signup requests require roomId, roomVersion and acceptedTerms. Owners must publish real room details before applicants can choose a room. Revised offers require applicant acceptance before final owner approval.

## The single registration flow

1. The resident creates an account and chooses their property.
2. They verify their email once, using the signup email link.
3. Their application is pending owner approval.
4. The owner assigns the agreed room and approves.
5. The application becomes APPROVED and the tenancy becomes ACTIVE immediately, atomically. No code or second email verification is required.

Approval sends an informational welcome email only. Failure of that notification does not undo approval; the owner is informed that delivery failed. Signup verification delivery failure still rolls back signup. Corrections and rejection are available before approval. Existing held reservations stay held until explicit release; active tenancies cannot be rejected or cancelled through those application actions.

## Start with your own blank owner account

Use JDK 21+ and Node/npm. The project targets Java 21 / Spring Boot 4.1.1 and was tested with Temurin 25. Maven is provided by the wrapper.

From the repository root in PowerShell:

~~~powershell
cd haruhay-backend/haruhay-backend
$env:DEV_OWNER_EMAIL = 'your-personal-email@example.com'
$env:DEV_OWNER_NAME = 'Your real name'
$env:DEV_OWNER_PASSWORD = 'Choose-your-own-long-password42'
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=dev"
~~~

Use your own values, not the examples. Passwords need at least 12 characters and at most 72 UTF-8 bytes.

In a second terminal, from the repository root:

~~~powershell
cd frontend
npm.cmd ci
npm.cmd run dev
~~~

Open **http://localhost:5173/#/login**. Sign in with the owner email/password you configured. Add your property and rooms under **Property & rooms**. A room capacity of 1 represents a private room; shared rooms support multiple occupants. The minimal setup currently accepts capacities 1–100. It is not the full property-management interface.

Applicants use **http://localhost:5173/#/register** and choose the property you added. Until then, signup clearly says that no properties are available.

The dev profile now defaults to **.local/haruhay-live.mv.db**, relative to the backend folder. It creates **no sample properties, rooms, residents, balances, payments, tickets or visits**. Only the owner explicitly configured through environment variables is bootstrapped. If both owner email/password are absent, the backend starts empty; configure both and restart to create your owner.

The earlier **.local/registration.mv.db** is preserved and no longer selected by default. No existing data was deleted. To deliberately use an existing database, set SPRING_DATASOURCE_URL to its H2 JDBC URL before starting; Flyway applies V2 and retains its records. Make a backup before migrating important data. Existing active tenancies remain active. Existing pending room invitations are reviewed through the current application UI.

Existing account passwords are hashes and cannot be recovered. Changing DEV_OWNER_PASSWORD does not reset an account that already exists at that email in the selected database. A fresh database bootstraps the configured credentials. Stop the server before moving or backing up a local H2 database.

## Real email versus local development delivery

**By default dev mode sends no email.** It writes private local delivery files:

- Email-verification link: **.local/mail/ACCOUNT_ID.txt**
- Approval notification (no action required): **.local/mail/ACCOUNT_ID.approval.txt**

Each file identifies its recipient. The account ID is available from GET /api/account after login. Open the verification link, then wait for owner approval. Development files are ignored by Git; keep them private.

### Gmail setup for earldomingo165@gmail.com

The gmail profile configures smtp.gmail.com:587 with required STARTTLS, certificate-host checks and authentication. The From address and login default to earldomingo165@gmail.com. It overrides development file delivery when enabled after dev.

Enable Google 2-Step Verification and generate an app password at httpvvs://myaccount.google.com/apppasswords while signed in to that Gmail account. Use the app password, not your normal Google password. Do not share it in chat or commit it.

From the backend folder:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-gmail.ps1
~~~

The script privately prompts for the Google app password and, if missing from your terminal environment, the separate Haruhay owner password. It defaults DEV_OWNER_EMAIL to the sender only when no owner email was configured. An existing owner keeps its stored Haruhay password; this does not reset accounts. Secrets exist only in the process environment while the backend runs and are restored/removed when the script exits. No password is saved in a configuration file.

Stop an already running backend with Ctrl+C before launching this script. Start the frontend separately with npm.cmd run dev. Sign up using the resident's own email; verification and approval messages are addressed to that email, while the Gmail account is the sender. When currently signed in, use **Create account with another email** to sign out and start a blank signup form. To apply with the current identity, leave its email unchanged.

For a deployment or an already configured environment, enable profiles dev,gmail and supply GMAIL_APP_PASSWORD through your secret configuration. GMAIL_ADDRESS overrides the sender/login. Never use the dev database/profile for production. A real Gmail message still requires a valid app password; automated tests exercise the mail adapter with a mocked SMTP sender, not your Gmail inbox.

For another SMTP provider, configure the backend terminal:

~~~powershell
$env:HARUHAY_DELIVERY = 'smtp'
$env:SPRING_MAIL_HOST = 'your-smtp-host'
$env:SPRING_MAIL_PORT = '587'
$env:SPRING_MAIL_USERNAME = 'your-smtp-username'
$env:SPRING_MAIL_PASSWORD = 'your-smtp-password-or-app-password'
$env:SPRING_MAIL_PROPERTIES_MAIL_SMTP_AUTH = 'true'
$env:SPRING_MAIL_PROPERTIES_MAIL_SMTP_STARTTLS_ENABLE = 'true'
$env:MAIL_FROM = 'your-verified-sender@example.com'
~~~

Restart the backend. Use the authentication/TLS settings required by your provider; the example assumes authenticated STARTTLS on port 587. Do not put SMTP credentials in source code.

Signup verification and informational approval notifications go through SMTP. Signup verification failure rolls back signup; approval notification failure does not undo an approved tenancy and is reported separately. No second verification code is sent.

FRONTEND_URL defaults to http://localhost:5173. Set it to your actual frontend origin for outgoing messages. Use one hostname throughout the flow: localhost and 127.0.0.1 have different cookies. Vite proxies /api to localhost:8080; HARUHAY_API_TARGET can select another backend during isolated testing.

## Full frontend with empty starting data

Applicants see only Application status until approval. Their status page shows email verification progress, property, owner feedback and correction actions; search, notifications and resident services remain hidden. Direct resident URLs return pending applicants to their status page, while backend permission checks continue to enforce access. An open status page checks for approval every 15 seconds while visible and when refocused. Approval opens the complete resident dashboard and removes Application status from navigation; old status URLs redirect to the dashboard.

Local development preference: after requested changes, back up and reset test resident accounts and registration records, preserving the owner's credentials, properties and rooms. This preference is recorded in AGENTS.md. It applies to local test records only.

Login opens the original complete admin dashboard for the owner and the original resident dashboard for an approved resident. Existing tabs, pages, dialogs, exports and Holding Station interactions are retained. Applications and Property & rooms are additional admin tabs; pending residents can view their application status while resident services remain approval-gated.

The workspace uses the signed-in account identity and approved room assignment. The owner resident directory is derived from approved backend applications. Payments, maintenance, visitor records, access logs and announcements start empty rather than loading dummy records. Holding Station records and transaction history are stored in the backend database; owners manage records and approved residents see only their own items. Other modules retain their frontend-only interactions and account-scoped browser storage; registration, verification, approval and Holding Station use the backend database. Those other modules are not yet backend integrations.

To test registration with the existing UI: sign in as owner, open Applications, register a separate resident through Create an account, verify that email once, approve the room in Applications, then sign in as the resident. All original resident tabs remain available after approval. The owner account, property and rooms were preserved when local test registrations were reset. A database backup and the old local delivery files were archived under backend .local/backups before reset.

Explicit sample fixtures remain available through #/preview/login for design/interaction regression checks. Sample storage is separate from the actual-account workspace, and none of its dummy identities or records are imported into a registered account. The canonical #/login and #/register use real account authentication.

## States and security

Application flow: AWAITING_EMAIL -> PENDING_APPROVAL -> APPROVED. The last step creates the active tenancy in the same room-locked transaction. Repeated/concurrent approvals cannot create duplicate tenancies or exceed room capacity. The account email must be verified before approval. Pending accounts cannot access resident APIs.

CORRECTIONS_REQUESTED can return to PENDING_APPROVAL. REJECTED and CANCELLED applications cannot become tenancies without a new review. Room reservations have no automatic expiry. No new activation-code records are created.

Migration V3 automatically completes the tenancy for previously owner-approved, email-verified applications still waiting on an activation code with a held reservation. It preserves room capacity, existing accounts, and active tenancies, and records an audit event. It never approves an unreviewed or unverified application. Restart the backend to apply it.

Passwords use BCrypt cost 12. Signup email ownership verification uses independent secure tokens with VERIFICATION_TTL (default 24h). Authentication, CSRF protection, property-ownership checks, and throttling remain enabled. Use SESSION_COOKIE_SECURE=true in an HTTPS deployment. A durable email outbox/retry worker and distributed throttling remain future deployment work.

## Current API

All endpoints start with /api. Unsafe methods require a masked token from GET /auth/csrf, sent using its headerName with the same session cookie. Fetch a fresh token after login/logout. Errors return an HTTP status, message and usually code. No password/hash or activation code is returned in list/approval responses.

| Endpoint | Purpose |
| --- | --- |
| GET /public/properties | Real properties available for signup; no sample properties |
| POST /public/accounts/signup | {email,fullName,contact,password,propertyId}; authenticated existing accounts omit password |
| POST /auth/login | Form-encoded username=email and password |
| POST /auth/logout | Ends session |
| GET /account | Current identity and verification status |
| POST /public/email/verify | {token} from verification email |
| POST /account/verification | Resend email-verification link |
| GET /account/admissions | Only the current account’s applications |
| POST /account/admissions/{id}/corrections | {fullName,contact} while corrections requested |
| GET /owner/admissions | Applications belonging to owned properties |
| POST /owner/admissions/{id}/approve | {roomId,reason}; approve and start tenancy |
| POST /owner/admissions/{id}/corrections | {reason} |
| POST /owner/admissions/{id}/reject | {reason}; keep any existing reservation |
| POST /owner/admissions/{id}/release | {reason}; explicitly release a held place |
| GET /owner/properties | Owned properties |
| POST /owner/properties | {name}; minimal initial setup |
| GET /owner/rooms | Owned room capacity, held/active counts |
| POST /owner/rooms | {propertyId,label,capacity} |
| GET /resident/tenancies | Own active tenancies; active tenancy required |

Old manual invitation creation, link replacement, invitation-first registration and old approval writes return 410 with instructions to use the current flow. This preserves the current approval rules. Existing read/audit endpoints and explicit legacy cancellation remain for record continuity.

## Tests

From the backend folder:

~~~powershell
.\mvnw.cmd test
~~~

Default tests run against isolated in-memory H2. The suite was also run against a dedicated PostgreSQL 18 database named **haruhay_registration_test** using datasource environment overrides. Tests delete their fixtures and refuse other database names; never point tests at real records.

From frontend:

~~~powershell
npm.cmd run lint
npm.cmd run build
~~~

Browser checks use the existing Chrome DevTools helper on port 9227. Run sequentially:

~~~powershell
node scripts/check-onboarding-ui.mjs
node scripts/check-live-workspaces-ui.mjs
node scripts/check-application-status-ui.mjs
node scripts/check-admin-ui.mjs
node scripts/check-resident-ui.mjs
node scripts/check-signup-email-ui.mjs
~~~

The onboarding suite requires a fresh disposable dev database, with DEV_OWNER_EMAIL=owner@onboarding.test, DEV_OWNER_NAME=Browser Owner, a DEV_OWNER_PASSWORD also set in the test shell, and HARUHAY_LOCAL_MAIL_DIR=target/onboarding-mail. Set SPRING_DATASOURCE_URL to a fresh H2 file under target; do not use your normal local account database. UI_OWNER_EMAIL and UI_MAIL_DIR override the defaults. It creates its own real-form fixtures and active tenancy. Run the live-workspaces suite immediately afterward against that same disposable database. It checks the complete original navigation, actual account identity, empty module data, desktop/narrow pages and backend sign-out. Admin/resident preview suites explicitly select sample mode in their isolated browser tabs; the signup-email suite mocks delivery and creates no backend records.

Screenshots/results are ignored under frontend/.ui-verification/onboarding. Browser checks cover signup, one email verification, corrections, immediate access after owner approval, duplicate-account prevention, rejection before approval, keyboard navigation and responsive layouts. Backend tests additionally cover concurrent approvals, notification failure, existing-account reuse and migration of previously approved accounts without a second code.

The old activation/resend endpoints are retired. An already-approved account can follow an old activation URL to view its active stay; there is no further verification step.
