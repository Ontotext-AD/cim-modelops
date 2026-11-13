# CIM ModelOps

Browser demo for CIM switch toggles, GraphDB History, and difference/full models against [cim.ontotext.com](https://cim.ontotext.com/graphdb).

**Live:** https://ontotext-ad.github.io/cim-modelops/

## Local development

```bash
npm install
npm run dev
```

Vite serves the UI and proxies `/graphdb` → `https://cim.ontotext.com`, stripping `Origin`/`Referer` so GraphDB’s CORS filter accepts the requests.

## GitHub Pages

Pushes to `main` build with Vite (`base: /cim-modelops/`) and deploy via Actions.

For the hosted app to talk to GraphDB, allow origin `https://ontotext-ad.github.io` in the GraphDB CORS allow-list (without that, browser calls get `403`).

## Scripts

| Command | |
|---------|-|
| `npm run dev` | Local UI + GraphDB proxy |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve `dist/` locally |
