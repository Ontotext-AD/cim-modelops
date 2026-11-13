# CIM ModelOps

Browser demo for CIM switch toggles, GraphDB History, and difference/full models against [cim.ontotext.com](https://cim.ontotext.com/graphdb).

**Live (via reverse proxy):** https://cim.ontotext.com/modelops/  
**Origin (GitHub Pages):** https://ontotext-ad.github.io/cim-modelops/

## Local development

```bash
npm install
npm run dev
```

Vite serves the UI (`base: /modelops/`) and proxies `/graphdb` → `https://cim.ontotext.com`, stripping `Origin`/`Referer` so GraphDB’s CORS filter accepts the requests.

## Production on cim.ontotext.com

The app and GraphDB share the host, so the UI calls `/graphdb/...` with no CORS change needed.

Ask IT for an ingress/nginx path (leave `/graphdb` and `/chat` alone):

```nginx
location /modelops/ {
    proxy_pass https://ontotext-ad.github.io/cim-modelops/;
    proxy_ssl_server_name on;
    proxy_set_header Host ontotext-ad.github.io;
}
```

Trailing slashes matter: `/modelops/` is rewritten to `/cim-modelops/` on GitHub Pages. Vite `base` is `/modelops/` so asset URLs match the public path.

Pushes to `main` rebuild and publish Pages via Actions.

## Scripts

| Command | |
|---------|-|
| `npm run dev` | Local UI + GraphDB proxy |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve `dist/` locally |
