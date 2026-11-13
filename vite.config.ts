import { defineConfig } from "vite";

export default defineConfig({
  // Served at https://cim.ontotext.com/modelops/ (reverse-proxied from GitHub Pages).
  base: "/modelops/",
  server: {
    proxy: {
      "/graphdb": {
        target: "https://cim.ontotext.com",
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          // GraphDB's CORS filter rejects browser Origin from localhost.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
        },
      },
    },
  },
});
