# Cloud API on Cloudflare (Workers + KV)

One small Worker (`worker/`) gives the hosted app two things: read-only **share links** (the contract in `sharing-api.md`) and **cloud backup** of your scenarios.

## One-time setup

You need a free Cloudflare account. From the project folder:

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create PLANNER
```

Paste the `id` it prints into `worker/wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`). Check `ALLOWED_ORIGINS` there lists the site that will call the API (the Pages site's origin, for example `https://bobbygenalo.com`). Then:

```bash
npx wrangler deploy
```

It prints the Worker's address, like `https://ashby-planner-api.<your-subdomain>.workers.dev`. Open that address: it answers `{"ok":true,"service":"ashby-planner-api"}`.

## Point the site at it

In the GitHub repository: Settings, Secrets and variables, Actions, Variables, New repository variable. Name `API_BASE`, value the Worker address (no trailing slash). Then re-run the "Deploy to GitHub Pages" workflow (Actions tab, Run workflow). The Scenarios tab then shows working share links and a Cloud backup section.

To try it locally instead: `cd worker && npx wrangler dev --local`, and run the app with `VITE_API_BASE=http://localhost:8787 npm run dev`.

## How it works

- **Share links** use `POST/GET/PUT/DELETE /api/share`. Revoke keys are stored as hashes. KV is eventually consistent, so a revoked link can keep working for up to about a minute at far-away Cloudflare locations.
- **Cloud backup** uses `GET/PUT /api/workspace`. Visitors never see this happen: a browser's first edit quietly generates a random 22-character **sync key**, and changes then save online automatically (30 quiet seconds after an edit, at most every 2 minutes). Pressing "Create link" saves first, then creates the share. The key is sent as `Authorization: Bearer <key>`. The Worker stores your scenarios under a hash of the key, never the key. Anyone with the key can read and replace that workspace, so it is a password. The same key on another browser opens the same scenarios.
- **Conflicts:** each save says which copy it was based on. If another device saved in between, the server answers 409 and the app asks which copy to keep. KV cannot do an atomic compare-and-set, so two saves landing within the same second can still overwrite each other; this is a one-person tool and the app asks before overwriting in the ordinary case.
- **Limits:** a share is at most 2 MB and a workspace at most 4 MB. Cloudflare's free plan allows 1,000 KV writes a day, so the app waits for 30 quiet seconds between backups. Creating a share needs a sync key that already has a saved workspace. Anyone who opens the site gets their own key on their first edit, so the 1,000-writes-a-day free limit is shared by everyone you give the link to; the Workers Paid plan (about $5 a month) raises it to millions if that ever matters. Add a Cloudflare rate-limiting rule if someone abuses the Worker address directly.
- **CORS:** only the origins in `ALLOWED_ORIGINS` can call the API from a browser.
