# CIM ModelOps

Browser demo for CIM switch toggles, GraphDB History, and difference/full models against [cim.ontotext.com](https://cim.ontotext.com/graphdb).

**Live (GitHub Pages):** https://ontotext-ad.github.io/cim-modelops/  
**Optional reverse proxy:** https://cim.ontotext.com/modelops/ (not required once GraphDB CORS allows the Pages origin)

## Local development

```bash
npm install
npm run dev
```

Vite serves the UI (`base: ./`) and proxies `/graphdb` → `http://localhost:7200` (strips the `/graphdb` prefix). Local repos: `cim`, `cim-diff-models`.

## Production (GitHub Pages)

The production build calls GraphDB at `https://cim.ontotext.com/graphdb` (repos `cim-history`, `cim-modelops`). Asset URLs are relative (`base: ./`) so they work under `/cim-modelops/`.

Allow CORS on GraphDB for origin `https://ontotext-ad.github.io` (SPARQL query + update). Until that is set, the UI loads but data requests fail.

Pushes to `main` rebuild and publish Pages via Actions.

## Optional: same-host proxy

If preferred later (leave `/graphdb` and `/chat` alone):

```nginx
location /modelops/ {
    proxy_pass https://ontotext-ad.github.io/cim-modelops/;
    proxy_ssl_server_name on;
    proxy_set_header Host ontotext-ad.github.io;
}
```

## Scripts

| Command | |
|---------|-|
| `npm run dev` | Local UI + GraphDB proxy |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve `dist/` locally |
