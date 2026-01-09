import { resolve, join } from "path";
import { defineConfig } from "vite";
import { DynamicPublicDirectory } from "vite-multiple-assets";
import { NodePackageImporter } from "sass";

export default defineConfig({
  server: {
    host: "127.0.0.1"
  },
  base: "./",
  plugins: [
    {
      apply: "build"
    },
    DynamicPublicDirectory(["kirchhoff/public"], {
      ssr: false
    })
  ],
  build: {
    target: "es2020",
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html")
      },
      output: {
        assetFileNames: `assets/[name].[ext]`
      }
    }
  },
  resolve: {
    preserveSymlinks: true,
    alias: [
      {
        find: /~(.+)/,
        replacement: join(process.cwd(), "node_modules/$1")
      }
    ]
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
        importers: [new NodePackageImporter()]
      }
    }
  }
});
