## Status

A representatives/senators lookup form (`src/components/LookupForm.tsx`)
is the landing page. Each result card links to that member's detail page
(`src/components/MemberDetailPage.tsx`, backed by cd-server's
`getMember(bioguideId)` → `MemberDetail`, which adds `state`/`inOffice`
over the list resolvers' `Representative`/`Senator`). The detail page
currently shows identity + contact + an `inOffice: false` banner for a
departed member; the plain-language voting-record search from the UX
mockup is the next piece and not built yet.
Plus a minimal Cognito login/logout affordance in the header
(hand-rolled Authorization Code + PKCE flow via the Web Crypto API — no
`oidc-client-ts`/`react-oidc-context`, since those libraries' issuer
auto-discovery targets Cognito's default domain, not the custom
`auth.civicdog.com` Managed Login domain, requiring manual metadata
overrides anyway). See `src/auth/`. Tokens live in `localStorage` (so the
"Hi, [name]" greeting survives reloads); the PKCE verifier/state live in
`sessionStorage` for the redirect round trip only. Access/id tokens (1hr
validity) are silently renewed via the refresh token (30-day validity) on
a scheduled timer — see `scheduleRefresh` in `src/auth/session.ts`.

Routing is hand-rolled in `src/lib/router.ts` (`useRoute`/`navigate`/
`parseRoute`, ~50 lines over `useSyncExternalStore` + `history.pushState`
+ `popstate`), same hand-rolled-over-library posture as `src/auth/` and
`src/lib/cdServer.ts`. Two real screens: `/` (lookup form) and
`/member/:bioguideId` (detail page). `RouterLink` (`src/components/`)
wraps `<a>` so plain left-clicks transition client-side while
modified/middle clicks fall through to the browser. `/callback` has no
route of its own: `parseRoute` doesn't match it, so it falls through to
the home screen and `LookupForm` renders (firing `getStates()`) during
the OAuth code exchange — same as before this app had a router.
`src/auth/session.ts` then handles the exchange and `history.replaceState`s
back to wherever the user started login from — `login()` stashes
`pathname + search` in `sessionStorage` (`cd_return_to`) and
`handleCallback()` restores it (validated same-origin absolute path, `/`
fallback). Reach for `react-router` only if a third screen with nested
routes / real URL params shows up.

Cognito infra (User Pool, the `cd-webapp-dev`/`cd-webapp-prod` app
clients, `auth.civicdog.com` Managed Login domain) is provisioned in
`cd-infra`'s Terraform (`terraform/cd-webapp/main.tf`), not this repo.
Both app clients are public (no secret) — PKCE is inherent to that, not a
separate Terraform toggle. Local dev needs a `.env.local` (see
`.env.example`) with the dev client's values; prod's are set as the
Amplify app's build env vars.

`cd-server` (a GraphQL API, in the `cd-platform` monorepo) is deployed at
`https://server.civicdog.com/graphql`, which prod is wired to via the
Amplify app's `VITE_CD_SERVER_URL` build env var. `src/lib/cdServer.ts`'s
default is still `http://localhost:8000/graphql` for local dev — run
cd-server locally via `cd-platform`'s `make start-server` (plus
`make start-api` for cd-api, which cd-server calls out to). The lookup
form and member detail page talk to it through a hand-rolled GraphQL
client in `src/lib/cdServer.ts` — no Apollo/urql, same
hand-rolled-over-library posture as `src/auth/`. Introspection is disabled server-side, so
the query strings/types in `cdServer.ts` are hand-written against the
schema, not generated — keep them in sync manually if `cd-server`'s
schema changes. `getStates` and `getDistrict` are both real backend
calls (the states list and the address→district geocoding both happen
server-side) — don't reintroduce a hardcoded state list or a client-side
mock, both existed briefly during planning and are gone now that the
real fields work. The address field also has a "use my location" icon
button: browser Geolocation → `getDistrictByCoords(lat, lng)` →
`getRepresentatives`, auto-running the search. The coord→district
geocoding is server-side too (`getDistrictByCoords`, cd-platform#173) —
the Census geocoder sends no CORS headers, so the browser can't call it
directly.

`cd-server`'s `CORSMiddleware` (`app.py`) allow-lists exactly
`http://localhost:5183` and `https://app.civicdog.com` (see
`cd-server/src/cd/server/settings.py`'s `CORS_ALLOWED_ORIGINS`) — verified
working end-to-end against a real local `cd-server` + `cd-api`. If you're
running the dev server on a different port, requests will fail with a
CORS error; that's the allow-list, not a bug to chase in this repo.

## Checking what's deployed

`npm run build` writes `dist/version.json` (commit SHA + build timestamp)
as a `postbuild` hook (`scripts/write-version.mjs`), deployed alongside
`index.html` at the site root. To check what's live:
`curl https://app.civicdog.com/version.json`.

## Commands

```bash
npm install
npm run dev      # start dev server
npm run build     # tsc -b && vite build
npm run preview   # preview the production build locally
npm run lint       # run oxlint
```

Requires Node >= 22.12.0.

## Styling

Tailwind CSS v4, CSS-first config — brand tokens (navy/blue palette,
`--font-sans`) live in the `@theme` block in `src/index.css`, mirrored
from `cd-website/apps/site/src/styles/global.css` for visual consistency
with the marketing site. There is no `tailwind.config.js` — don't add
one; add or change tokens in the `@theme` block instead.

## Brand assets

Logo/favicon assets in `public/` and `public/logo/` are copied from
`cd-website` (a sibling repo), not shared via a package — mirrors
cd-website's own convention of duplicating these per-app rather than
sharing them.

`public/logo/civicdog-mark-white-bg.png` (+ `.webp`) is a derived asset:
the original `civicdog-mark.png` has a transparent background everywhere
except the ring/dog/capitol art, so on a dark page background the ring's
interior shows the page background instead of white. The white-bg variant
was generated by flood-filling only the *fully enclosed* transparent gaps
inside the ring (leaving the ear that pokes out above the ring, and the
true exterior, transparent) — a plain CSS circle behind the image doesn't
work because the ring isn't perfectly centered/circular in the source
canvas. If the source mark ever changes, regenerate with the same
flood-fill approach rather than approximating with a CSS shape.

## Git conventions

PRs are merged with a merge commit (`gh pr merge --merge`), not squash or
rebase — preserves the individual commit history from the PR branch.
After merging, delete the branch both locally and remotely
(`gh pr merge --merge --delete-branch` does both in one step).

When addressing review comments on an open PR, break the fixes up into
separate commits along logical lines (one commit per distinct issue/fix,
not one commit for everything) rather than a single catch-all commit, and
reply to each review comment on GitHub referencing the specific commit
hash that addressed it, formatted as a hyperlink to the commit rather than
just backticked text (e.g. "Fixed in
[abc1234](https://github.com/<owner>/<repo>/commit/abc1234).") -- keeps
the review thread traceable to the exact change that resolved it, one
click away, rather than a generic "addressed" reply pointing at the whole
PR.

When *submitting* a code review on a PR, post each finding as its own
separate inline review comment (anchored to the specific file/line via
`gh api repos/{owner}/{repo}/pulls/{number}/comments`, not a single bundled
`gh pr comment`) -- a combined comment listing every finding only supports
one flat reply thread, making it impossible to reply to (or resolve)
individual findings separately later.
