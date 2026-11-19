import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so assets resolve under both:
  //   https://ontotext-ad.github.io/cim-modelops/
  //   https://cim.ontotext.com/modelops/ (reverse-proxied from Pages)
  base: "./",
  server: {
    proxy: {
      "/graphdb": {
        // Local GraphDB (Workbench at http://localhost:7200). Strip /graphdb prefix.
        target: "http://localhost:7200",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/graphdb/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
        },
      },
    },
  },
});
