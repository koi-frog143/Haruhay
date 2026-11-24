# Maintenance tickets

Haruhay saves maintenance tickets for real accounts in the database. The sample workspace uses its existing fixtures. Flyway V9 creates the maintenance tables and standard categories.

## Use the workflow

1. Start the Spring Boot backend and Vite frontend using the local setup in [REGISTRATION.md](REGISTRATION.md). Sign in with an owner account and have an approved resident with an active tenancy.
2. In the owner workspace, open **Maintenance → Manage technicians**. Choose the property and create a technician with a dedicated email and an initial password of at least 12 characters. Share those credentials privately. This action creates the account without sending email.
3. As the resident, select **Maintenance → Report an issue**. Choose a category and describe the issue. The property and room come from the tenancy. For shared areas, enter the specific location. Upload an optional JPEG or PNG photo.
4. The owner opens **Needs assignment**, chooses a technician and priority, and saves the assignment. Critical escalation records the external technician and follow-up details. The assigned internal technician remains responsible for the ticket.
5. The technician signs in through the same login page and lands on **My jobs**. Open the ticket, select **Start work**, post progress, and select **Ready for confirmation** with a completion note.
6. The resident opens the maintenance notification and selects **It’s fixed** or **Still having the issue**. A confirmed ticket appears in **History**. A reopened ticket returns to the assigned technician if enabled, or to **Needs assignment**. An owner can also close a verified repair with a reason.

## Records and permissions

- Ticket states are Submitted, Assigned, In progress, Ready for confirmation, Closed, and Cancelled. Closing and cancelling archive the record. Activity, completion reports, and assignment history remain available.
- An active resident submits through a tenancy they own and can see only their records. Owners manage tickets and technicians for their properties. Each technician account belongs to one property and can see its currently assigned jobs. Disabling or reassigning removes that technician’s access to the affected job.
- State changes use a ticket version and a database lock. A stale action asks the user to reload the latest ticket. A repeat submission with the same request key returns the original ticket. Comments and photos append to the timeline independently.
- Photos are stored with the ticket in the database. Upload supports up to four JPEG or PNG files per ticket, each up to 5 MB and 16 megapixels. Photo writes happen separately from ticket creation. Each download checks ticket access and uses no-store caching headers.
- Maintenance notifications are saved for the recipient and link to their ticket. They appear on navigation, refresh, or opening the notification panel. External technician dispatch and push or email delivery are outside this workflow.

## API

Routes are under `/api/maintenance` and require sign-in. Write requests use the existing CSRF protection.

| Endpoints | Purpose |
| --- | --- |
| `GET /categories`, `GET /locations` | Report options and the signed-in resident’s authorized locations |
| `GET /tickets`, `POST /tickets`, `GET /tickets/{id}` | List, submit and view tickets |
| `POST /tickets/{id}/actions` | Submit a versioned assignment, escalation, start, progress, ready, reopen, close, or cancellation action |
| `POST /tickets/{id}/comments` | Add a comment |
| `POST /tickets/{id}/photos`, `GET /tickets/{id}/photos/{photoId}` | Upload multipart field `photo` or read an authorized photo |
| `GET /properties/{id}/technicians`, `POST /properties/{id}/technicians`, `POST /properties/{id}/technicians/{staff}` | List, create or enable/disable technicians as an owner |
| `GET /notifications`, `POST /notifications/read` | List notifications and mark one or all as read |

## Checks

Run the backend tests against the isolated H2 test profile or a dedicated PostgreSQL database named `haruhay_registration_test`. Run `npm.cmd run lint` and `npm.cmd run build` from `frontend`.

For browser verification, create the owner and approved test resident with `frontend/scripts/check-onboarding-ui.mjs` against a fresh disposable backend. Then run `frontend/scripts/check-maintenance-ui.mjs` with the same browser and backend settings. The script creates and exercises dedicated technician accounts.
