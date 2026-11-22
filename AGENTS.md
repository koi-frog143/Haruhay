# Local development preferences

- After requested changes, reset local test resident accounts and registration records, preserving the owner's account/password, properties and rooms. This is the user's standing preference for registration testing.
- Back up the local development database before each reset. Reset only the configured local test database; do not reset production, external databases or unrelated data. Stop the local backend before editing its H2 database.
- Keep the complete existing resident and admin UI. Remove dummy account/activity information from real-account workspaces, not the implemented screens or features. Keep sample previews separate.
- Pending applicants see only Application status. After approval, show the complete resident portal and remove Application status from navigation.
