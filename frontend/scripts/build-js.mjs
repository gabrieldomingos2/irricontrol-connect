import { build, context } from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(FRONTEND_DIR, "dist");

// Ordem importa: scripts classicos (nao-modulo) compartilham um unico
// escopo global no documento, entao a ordem de concatenacao precisa
// reproduzir exatamente a ordem em que os <script> tags eram carregados.
const BUNDLES = [
  {
    name: "app.bundle.js",
    files: [
      "assets/js/i18n.js",
      "assets/js/api.js",
      "assets/js/map.js",
      "assets/js/drawing/draw.core.js",
      "assets/js/drawing/draw.markers.js",
      "assets/js/drawing/draw.sector.js",
      "assets/js/drawing/draw.pacman.js",
      "assets/js/drawing/draw.circle.js",
      "assets/js/drawing/draw.export.js",
      "assets/js/drawing/index.js",
      "assets/js/3d_analysis.js",
      "assets/js/ui.js",
      "assets/js/main/bootstrap.js",
      "assets/js/lucide-init.js",
    ],
  },
  {
    name: "main-modules.bundle.js",
    files: [
      "assets/js/main/core.state.js",
      "assets/js/main/core.modes.js",
      "assets/js/main/feature.los.js",
      "assets/js/main/feature.pivots.js",
      "assets/js/main/feature.repeaters.js",
    ],
  },
];

const watch = process.argv.includes("--watch");

function concatSource(files) {
  return files
    .map((f) => readFileSync(join(FRONTEND_DIR, f), "utf8"))
    .join("\n;\n");
}

async function buildBundle({ name, files }) {
  mkdirSync(DIST_DIR, { recursive: true });
  const source = concatSource(files);
  const outfile = join(DIST_DIR, name);

  const options = {
    stdin: {
      contents: source,
      loader: "js",
      sourcefile: name.replace(/\.js$/, ".concat.js"),
    },
    outfile,
    bundle: false,
    minify: true,
    sourcemap: true,
    target: "es2019",
    logLevel: "info",
  };

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log(`[build-js] watching ${name} (${files.length} files)`);
    return ctx;
  }

  await build(options);
  console.log(`[build-js] built ${name} (${files.length} files)`);
}

async function main() {
  const results = await Promise.all(BUNDLES.map(buildBundle));
  if (watch) {
    console.log("[build-js] watch mode active, press Ctrl+C to stop");
    // Keep the process alive; esbuild's watch contexts run in the background.
    await new Promise(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
