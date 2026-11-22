# Room browsing and accepted agreements

Start the backend using the existing `start-gmail.ps1` instructions in REGISTRATION.md, then run `npm.cmd run dev` from frontend. Restart the backend after updating so Flyway applies V4. Existing rooms start unpublished with unknown prices; no room or pricing fixtures are inserted into the normal development database.

## Using the flow

1. Owner: open **Property & rooms**, create a room if needed, then **Edit listing & pricing**. Enter type, capacity, rent basis, deposit, advance months, inclusions, rules and additional charges. Publish the listing and enable applications.

   The listing editor ignores outside clicks. Unfinished changes are saved as a draft in the current browser tab, scoped to the signed-in account and room. Closing with X or Escape, navigation and refreshing preserve the draft. **Save listing** publishes to the backend and clears the draft; **Discard draft & reload saved listing** restores saved room data. If the listing changed since the draft began, saving is blocked until the current listing is loaded. If browser storage fails, closing is blocked with an error so edits are not silently lost. Drafts are not shared across devices or browser tabs.
2. Applicant: open **Create an account**, choose a property, inspect room cards and **View details**, choose a room, then review and acknowledge its terms before submitting.
3. Verify the signup email once. The pending page shows the accepted offer and property details; resident services remain hidden and backend protected.
4. Owner: open **Applications**. Approval of the accepted room and current terms starts tenancy immediately. To change the room or terms, use **Propose room / revised terms**, select the current room listing and optionally enter an explicit applicant monthly quote. Explain the changes.
5. Applicant: review the revised offer, changes and previous versions, then explicitly accept. This does not reserve a place or start tenancy. The owner must still approve.
6. Approval opens the full resident portal. **My profile** includes the confirmed room agreement. Existing active tenants without a recorded agreement see an honest missing-record message.

## Pricing decisions

### Monthly billing after approval

Accepted rent and fixed monthly charges appear in resident Payments and the owner's Billing overview immediately after approval. This is an agreed rate, not a payment or an invoice. The dashboard labels unbilled rates as **Agreed monthly charges**.

The owner can use **Billing & payments → Post monthly bill** to choose an approved resident, billing month and due date. V5 saves a bill from the immutable accepted offer. Only rent and fixed monthly charges are included; deposit, advance rent, metered utilities and unconfirmed amounts are not charged again. Resident **Refresh billing**, navigation or refresh loads the saved bill. Owner and resident balances use the same database records. Reposting a tenancy/month keeps the original bill and due date; concurrent requests create only one bill.

Payment collection, payment proof uploads, reconciliation, metered-charge posting and online payment processing remain separate integration work. Live billing does not treat browser-only sample approvals as real payments. No receipt is invented when a bill is posted.

New endpoints: GET `/api/owner/bills`, GET `/api/resident/bills`, POST `/api/owner/bills` with `{applicationId, period: "YYYY-MM", dueDate: "YYYY-MM-DD"}`. Owner property scope and active-tenancy access are enforced on the backend. The due date must belong to the selected billing month.

Approval shows only the latest accepted room; substitutions still require a revised offer and fresh acceptance. Success messages use the existing floating admin notification. Signup verification copy explains that the original email was sent automatically and offers **Resend verification email** only as a fallback. Local-file delivery remains explicitly labelled as no email sent.

- Currency is PHP. Backend amounts use BigDecimal and DECIMAL(12,2), with nonnegative two-decimal validation.
- Null means unconfirmed. Zero explicitly means no charge. Shared per-room rent is never divided by occupancy; an explicit per-applicant quote is required before approval when the applicant amount cannot otherwise be determined.
- Charges can be included, fixed monthly, fixed move-in, usage-based or to be confirmed. Variable/unconfirmed charges require an explanation and have no fabricated amount.
- The known move-in subtotal includes the deposit, advance rent, fixed move-in charges and one occurrence of fixed monthly charges. Usage-based and unknown amounts are excluded and identified. The subtotal is not a final invoice. No payment, ledger or recurring billing records are generated.
- Every listing edit increments its version, conservatively requiring a revised offer and fresh acceptance for pending applications. Accepted snapshots remain immutable; active agreements are not overwritten by later listing edits.
- Room photos are honest placeholders. Photo upload/storage is not implemented.

## API additions

| Endpoint | Purpose |
| --- | --- |
| GET /api/public/rooms?propertyId=UUID | Published public inventory and derived availability |
| GET /api/public/rooms/{id} | Published room details |
| POST /api/owner/rooms/{id}/details | Version-checked owner-scoped listing edits |
| POST /api/public/accounts/signup | Existing signup plus roomId, roomVersion and acceptedTerms |
| POST /api/owner/admissions/{id}/offer | Propose roomId, roomVersion, optional quote and reason |
| POST /api/account/admissions/{id}/accept-offer | Accept the latest offerId for the current applicant |
| GET /api/resident/agreements | Own active tenancy agreements |

Owner room responses include listing details and availability. Admission responses include ordered offer history. Backend room and application locks protect acceptance/approval from stale versions and concurrent capacity changes. Approval is idempotent; consent alone never creates a reservation. Existing legacy held reservations retain their explicit release rules.

Revised offers, corrections and rejection use configured email delivery. Delivery responses distinguish local files, SMTP acceptance and failures. Approval remains valid when its informational email fails. Development checks use disposable databases and local-file email; they send no real messages.

## Design and verification

Figma context/screenshots were obtained for signup (18:158) and admin resident management (18:1809). Existing local branding, DM Sans, blue/powder/mist colors, cards, buttons and dialog components are reused. Room catalogue, pricing editor and agreement history are design adaptations; they are not claimed as exact Figma room screens. No temporary Figma asset URLs are used at runtime.

From the backend folder: `./mvnw.cmd -o test` (or omit -o when dependencies need downloading). Tests use isolated registration-tests H2, not the normal account database.

Browser checks: start an isolated backend with DEV_OWNER_EMAIL=owner@onboarding.test, DEV_OWNER_NAME=Browser Owner, DEV_OWNER_PASSWORD=Browser-owner-password42, a fresh H2 database under target, and HARUHAY_LOCAL_MAIL_DIR=target/room-flow-mail. Point Vite at it with HARUHAY_API_TARGET. Start isolated Chrome remote debugging and set UI_ORIGIN, UI_DEBUG, DEV_OWNER_PASSWORD and UI_MAIL_DIR for the scripts. Run sequentially from frontend:

```
node scripts/check-onboarding-ui.mjs
node scripts/check-room-flow-ui.mjs
node scripts/check-live-workspaces-ui.mjs
node scripts/check-signup-email-ui.mjs
```

The normal local database was backed up and test applicants/registrations reset after implementation, preserving the owner, properties and rooms. Backups are under backend `.local/backups`. Existing credentials are unchanged.

For local resets after V5, delete test monthly_bills before application_offers, tenancies and applications; preserve room_charges and owner room configuration. Stop the normal backend and create a backup first. The normal database remains unchanged when the running backend prevents the backup/reset.
