import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Copies Cesium's static Workers/ThirdParty/Assets/Widgets into /cesium/ so
    // CESIUM_BASE_URL can point at them (set at runtime, right before Cesium is
    // dynamically imported — see the USE_TERRAIN_3D branches in HikeMap.jsx /
    // HikeMapCard.jsx). Deliberately NOT using vite-plugin-cesium here: it also
    // does this, but unconditionally injects a <script src="/cesium/Cesium.js">
    // (~15MB) into every page's <head> regardless of whether the 3D flyover is
    // ever used — exactly what the toggle is meant to avoid paying for. Plain
    // `import * as Cesium from 'cesium'` (used in src/lib/terrainFlyover.js)
    // combined with a dynamic import at the call site already code-splits
    // Cesium's JS into its own chunk that's only fetched when actually needed —
    // this plugin only needs to handle the separate static-asset files.
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((dir) => ({
        // `**/*` (not `*`) to recurse into nested folders too, e.g. Assets/Images/.
        src: `node_modules/cesium/Build/Cesium/${dir}/**/*`,
        dest: 'cesium',
        // Without this, the plugin preserves the FULL matched path under `dest`
        // (its default behavior, "directory structure is always preserved") —
        // e.g. Assets/Images/ion-credit.png ended up at
        // cesium/Assets/node_modules/cesium/Build/Cesium/Assets/Images/ion-credit.png
        // instead of cesium/Assets/Images/ion-credit.png. stripBase: 4 removes
        // exactly the node_modules/cesium/Build/Cesium/ prefix (4 segments),
        // keeping each folder's own internal structure (e.g. Assets/Images/)
        // intact underneath.
        rename: { stripBase: 4 },
      })),
    }),
  ],
})
