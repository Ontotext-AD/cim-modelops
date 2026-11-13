import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages project site: https://ontotext-ad.github.io/cim-modelops/
  base: "/cim-modelops/",
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
