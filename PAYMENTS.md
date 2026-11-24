# Payment verification and receipts

Haruhay records payments made outside the app. The owner verifies each report against their own records. The workflow does not move money. Live records use Flyway V10 and the existing monthly bills. The sample workspace keeps its original fixtures.

## Try the flow

1. Start the backend and frontend using [REGISTRATION.md](REGISTRATION.md). Sign in as an owner with a property and an approved resident whose room terms were accepted.
2. In **Billing & payments**, select **Post monthly bill**. The bill uses the accepted rent and fixed monthly charges.
3. As the resident, open **Payments → Posted bills → Report a payment**. Enter the amount paid, date, method and reference. Attach an optional JPEG or PNG proof image up to 5 MB and 16 megapixels. Front desk payments use the reference the desk supplied.
4. As the owner, open **Payment approvals → Review payment**. Confirm you checked the actual payment before approving. If you decline, enter a reason. The resident can submit corrected details from **Payment history**.
5. As the resident, refresh billing to see the adjusted balance. Open the numbered receipt from **Payment history** and select **Print receipt** to print or save a PDF in the browser. The CSV export contains transaction records.
6. For a mistaken approval, open the approved record and select **Reverse approval** with a reason. The ledger restores the amount to the bill and marks the original receipt as reversed.

## Amounts and audit

- A report applies to one bill. Approve multiple partial payments until the bill is paid. The current scope has no overpayment credit or cross-bill allocation.
- Pending and declined reports leave the balance unchanged. Approval saves the review, ledger credit, and receipt together. Reversal records a separate negative ledger entry with its own date and actor. Collection totals are net posted ledger entries by Philippine calendar month.
- Duplicate checks use property, payment method, and the reference with surrounding spaces removed and case normalized. A reversed report retains its history and releases the active reference for a correctly reported payment.
- Money uses server-side decimal arithmetic. The bill row and property are locked during review, and the owner must review the current balance. Retry keys prevent duplicate submissions and repeated approvals and reversals are safe.
- Proof is stored privately with the report. Residents access their own records, and owners access records for their own properties. Downloads require the same authorization checks as the payment.

## API

| Endpoints | Purpose |
| --- | --- |
| `GET /api/{resident\|owner}/bills` | Posted amounts, paid amounts, balances, and bill states |
| `GET /api/{resident\|owner}/payments` and `GET /api/{resident\|owner}/payments/{id}` | Payment history or review data |
| `POST /api/resident/payments` | Report a payment with a request key and optional `correctsId` |
| `POST /api/owner/payments/{id}/{approve\|decline\|reverse}` | Record a decision. Approval requires `verified` and `expectedBalance`; decline and reversal require `reason` |
| `POST /api/resident/payments/{id}/proof` | Upload the multipart field `proof` |
| `GET /api/{resident\|owner}/payments/{id}/proof` and `.../receipt` | Authorized proof or receipt |
| `GET /api/owner/payment-collections` | Net ledger totals by month and outstanding bills |

Run the backend tests using the isolated H2 test profile or the dedicated PostgreSQL database `haruhay_registration_test`. For the browser suite, seed a fresh disposable environment with `frontend/scripts/check-onboarding-ui.mjs`, then run `frontend/scripts/check-live-payments-ui.mjs` against the same backend.
