# server/ — the controlled API of Classroom Manager ver.Next

The API that the page talks to (`/v1/read`, `/v1/commit`, `/v1/receipt`). It runs in one of two modes
(`server/config.mjs`), and nothing else differs between them:

| | emulator | firebase (development project) |
|---|---|---|
| started by | `dev/launcher.mjs` / tests | `server/main.mjs` (on the owner's computer) |
| Firestore | local emulator, owner access | `https://firestore.googleapis.com`, the API's OWN OAuth token (ADC or metadata) |
| ID token check | upstream `verifyEmulatorIdToken` (unsigned emulator tokens) | `token-firebase.mjs`: RS256 + Google certificates + claims + account state (disabled / revoked) |
| URL allow-list | loopback only | this project's documents + `accounts:lookup` only |

## Where the code comes from

- `upstream/` — **verbatim** copies of `hsuanyu9503/class-management-next` at `1e20989` (the reviewed controlled API):
  - authorization `authz.mjs`;
  - request shapes;
  - response shaping;
  - commit / version / operationId / receipt rules `api/commit.mjs`;
  - and their small dependencies.
  - `UPSTREAM.json` holds the SHA-256 of each file. `npm test` checks them, and with `CMN_UPSTREAM_ROOT` set also compares them with the upstream git history. **Do not edit these files.**
- Forks (only the credential / endpoint / token layer):
  - `api.mjs` ← upstream `api/server.mjs`: the backend is injected; demo / emulator guards moved to `config.mjs`; test-only mutation hooks removed;
  - `store.mjs`, `txn.mjs` ← upstream: same operations, URL base / check / credentials from the backend.
- New:
  - `config.mjs`: mode guards;
  - `credentials.mjs`: ADC `authorized_user` / metadata; **no key files**;
  - `token-firebase.mjs`, `backend.mjs`;
  - `admin.mjs`: the owner's trusted binding script;
  - `main.mjs`: the real-mode runner.

Authorization is done by the API on **every** request (binding → principal → membership → capability). Firestore
Security Rules (`/firestore.rules`) deny all client access; they do not apply to the API's own credentials.
