# Haruhay web redesign

The web redesign uses Haruhay’s DM Sans, navy, soft blues, and ivory. Public pages introduce the property search, resident pages lead with the next useful action, and staff workspaces group navigation and expose review queues.

The separate Figma page contains 14 editable desktop and mobile concept frames. They cover the public landing, applicant status, resident dashboard, owner review, guard workspace, listing editor, and shared feedback states. The original web prototype is the audit baseline. [Redesign concepts](https://www.figma.com/design/BrWLcw8zdtGPEEXgmSzRJ4/?node-id=165-2) · [Original prototype](https://www.figma.com/design/BrWLcw8zdtGPEEXgmSzRJ4/?node-id=73-2)

## Audit and decisions

| Priority | What got in the way | What changed |
| --- | --- | --- |
| High | The landing action led to sign-in, and prospective residents reached room costs after filling in account details. | Browse rooms leads directly to the application route. Property selection, availability, known costs, and room terms precede the applicant’s details. |
| High | Verification and approval were easy to confuse, and the resend action was in a separate account panel. | The application card names the current task and gives email resend a primary action when needed. The owner approval dialog shows the agreed room and monthly rent. |
| High | The owner’s search and status filters reset after refresh or review. | The queue preserves filters while records refresh. Counts provide direct filters and the result count describes the visible set. |
| High | Phone users had to pan across visitor and package records to find the status and action. | Narrow layouts stack labeled fields with actions on the same record. The guard sees the current property, scan action, and alternative search path. |
| High | Escape or backdrop clicks could interrupt edits. A validation error could leave users guessing which field to fix. | Editing dialogs confirm discard, listing drafts remain tab-scoped, and longer signup and visitor forms link error summaries to the fields while preserving input. |
| Medium | A large welcome block pushed useful resident actions below the fold, and staff links were in one long navigation group. | The resident dashboard prioritizes a posted bill or ready pickup. Owner navigation groups overview, operations, and property. Shared styles extend across maintenance, billing, packages, community, profile, and support. |

The work followed guidance on visible system status and user control, field-level recovery, and keyboard focus for modal dialogs. [Nielsen Norman Group heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) · [GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/) · [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/) · [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Review the implementation

Start the backend and frontend as documented in [REGISTRATION.md](REGISTRATION.md). Start at the landing page for the public journey, or sign in as a local test applicant, active resident, owner, or property-assigned guard. Use a separate test account and local-file verification email for automated checks.

- Applicant and owner: choose a room and review terms, verify once, request corrections, then approve the agreed room. The applicant sees only Application status until approval.
- Resident: check the next dashboard action and submit a visitor request with an invalid departure time. Check that the linked error focuses the field. Escape from the edited dialog and choose Keep editing.
- Guard: select a property, scan a visitor pass, and verify a visitor’s identity before recording entry or exit. If the camera is unavailable, try manual input or search. The scan remains separate from confirmation.
- Owner: refresh a filtered application queue, restore an unfinished listing draft, and open the package, maintenance and payment queues at a phone width.

The Figma page represents the key flows and states. The app retains the full detail screens and working interactions from the repository. Physical-camera behavior and manual assistive-technology testing need device follow-up. The design targets WCAG 2.2 AA and has not undergone a full conformance audit.

## Evidence

Local before-and-after public screenshots and representative application, validation, and resident screenshots are in `frontend/.ui-verification/ux-redesign/`. Guard, owner approval, and package screenshots are in the existing browser verification folders. The before images use an archived copy of the starting Git revision and the same disposable environment.

Use `frontend/scripts/check-ux-redesign-ui.mjs` after the onboarding browser suite with the same disposable backend. Set `UI_ORIGIN`, `UI_DEBUG` and `DEV_OWNER_PASSWORD` in the test terminal. An optional `UI_BASE_ORIGIN` serves the starting revision for comparison screenshots.

Lint, the production build, and 189 browser checks passed across onboarding (17), live workspaces (48), approval and billing (6), visitor QR (14), listing drafts (8), Holding Station (7), admin preview (41), resident preview (42), focused UX verification (4), and public accessibility spot checks (2). The focused checks used public widths of 320, 390, 768, and 1440 CSS pixels. The public spot checks covered accessible names, contrast, touch size, larger text, and reduced motion. The existing browser suites also checked keyboard focus, saved data, scoped guard access, camera denial, CSV exports, approval, and package release. Vite reported its usual main bundle size advisory.

The normal local development database was backed up to `.local/backups/web-ux-2026-11-23T12-52-55.809130800Z/database-before-reset.zip` under the Spring Boot project. The reset removed one test account and one application. A comparison confirmed that the owner record, property, two rooms, and prices were preserved. Browser verification ran against a separate disposable H2 database.
