#!/usr/bin/env node

// ==============================================================================
// 🪐 Solar Explorer 3D - Tiered Asset Manager
// ==============================================================================
// Downloads high-resolution textures from official NASA/scientific sources
// and generates Low (1k), Mid (2k) and High (4k+) tiers automatically.
// Supports WebP (Fallback) and KTX2 (VRAM Optimized) via toktx CLI.
// ==============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TARGET_DIR = path.join(PROJECT_ROOT, "public", "textures");

// --- Tooling Check ---
let hasToktx = false;
try {
  execSync("toktx --version", { stdio: "ignore" });
  hasToktx = true;
} catch {
  // Will log warning in main
}

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[90m",
};

// ==============================================================================
// NASA & SCIENTIFIC TEXTURE SOURCES
// ==============================================================================
// Priority: NASA official > Solar System Scope > Planet Pixel Emporium > Fallback
// All sources are public domain or CC-BY licensed

const TEXTURE_SOURCES = {
  sun: {
    urls: [
      "https://www.solarsystemscope.com/textures/download/2k_sun.jpg",
      "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/frames/5760x2880_16x9_30p/BlackMarble_2016_928m_africa_s.jpg",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/sun.jpg",
  },
  mercury: {
    urls: [
      "https://www.solarsystemscope.com/textures/download/2k_mercury.jpg",
      "https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003935/mercury_messanger_8192x4096.jpg",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/mercury.jpg",
  },
  venus: {
    urls: [
      "https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/venus.jpg",
  },
  earth: {
    urls: [
      "https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74393/world.200412.3x5400x2700.jpg",
      "https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg",
  },
  mars: {
    urls: [
      "https://www.solarsystemscope.com/textures/download/2k_mars.jpg",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/mars_1024.jpg",
  },
  jupiter: {
    urls: [
      "https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg",
      "https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003936/jupiter_4096x2048.jpg",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/jupiter.jpg",
  },
  saturn: {
    urls: [
      "https://www.solarsystemscope.com/textures/download/2k_saturn.jpg",
      "https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003937/saturn_4096x2048.jpg",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/saturn.jpg",
  },
  uranus: {
    urls: ["https://www.solarsystemscope.com/textures/download/2k_uranus.jpg"],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/uranus.jpg",
  },
  neptune: {
    urls: ["https://www.solarsystemscope.com/textures/download/2k_neptune.jpg"],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/neptune.jpg",
  },
  moon: {
    urls: ["https://www.solarsystemscope.com/textures/download/8k_moon.jpg"],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg",
  },
  io: {
    urls: [
      "https://commons.wikimedia.org/wiki/Special:FilePath/Io_highest_resolution_true_color.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  europa: {
    urls: [
      "https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/medres/europa.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  ganymede: {
    urls: [
      "https://commons.wikimedia.org/wiki/Special:FilePath/Ganymede_map_NASA_JPL_Voyager.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  callisto: {
    urls: [
      "https://commons.wikimedia.org/wiki/Special:FilePath/Callisto_map_NASA_JPL_Voyager.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  titan: {
    urls: [
      "https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/hires/titan.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  enceladus: {
    urls: [
      "https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/hires/enceladus.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  triton: {
    urls: [
      "https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/hires/triton.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  generic_moon: {
    urls: [
      "https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/hires/rhea.jpg",
    ],
    fallback: "https://www.solarsystemscope.com/textures/download/2k_moon.jpg",
  },
  saturn_ring: {
    urls: [
      "https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png",
    ],
    fallback:
      "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/saturn_ring.png",
    isRing: true,
  },
};

// ==============================================================================
// TIER CONFIGURATION
// ==============================================================================
const TIERS = [
  { name: "low", width: 1024, quality: 70 }, // Mobile - ~50-100KB
  { name: "mid", width: 2048, quality: 80 }, // Laptop/Tablet - ~200-400KB
  { name: "high", width: 4096, quality: 85 }, // Desktop - ~800KB-2MB
];

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================
async function generateKTX2(inputPath, outputPath, isDataMap = false) {
  if (!hasToktx) return false;

  try {
    // Flag selection based on map type
    const colorSpaceFlags = isDataMap
      ? "--assign_oetf linear"
      : "--assign_oetf srgb --assign_primaries srgb";

    // Modern toktx flags: --encode uastc + --zcmp for high quality
    // --genmipmap for mipmaps
    // --lower_left_maps_to_s0t0 to match Three.js/OpenGL orientation (fixes upside down issue)
    const cmd = `toktx --t2 --genmipmap --lower_left_maps_to_s0t0 --encode uastc --zcmp 3 ${colorSpaceFlags} "${outputPath}" "${inputPath}"`;
    execSync(cmd);
    return true;
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : "";
    const stdout = error.stdout ? error.stdout.toString() : "";
    console.error(`\n    -> ⚠️ [KTX2 Error] ${error.message}`);
    if (stderr) console.error(`       Stderr: ${stderr.trim()}`);
    if (stdout) console.error(`       Stdout: ${stdout.trim()}`);
    return false;
  }
}

async function downloadFile(url, dest) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "SolarExplorer3D-AssetBuilder/1.0 (https://github.com/liviocandman/sse3d)",
      Accept: "image/jpeg, image/png, image/webp, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(dest, buffer);
}

async function tryDownload(urls, outputPath, fallback) {
  for (const url of urls) {
    try {
      await downloadFile(url, outputPath);
      return { success: true, source: "primary" };
    } catch (err) {
      console.log(`\n    -> ⚠️ [Aviso] Falha na URL primária: ${err.message}`);
    }
  }

  if (fallback) {
    try {
      await downloadFile(fallback, outputPath);
      return { success: true, source: "fallback" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: "All sources failed" };
}

async function generateTiers(inputPath, baseName, sharp) {
  const results = [];

  try {
    const metadata = await sharp(inputPath).metadata();
    const originalWidth = metadata.width || 2048;

    for (const tier of TIERS) {
      const ktx2Path = path.join(TARGET_DIR, `${baseName}_${tier.name}.ktx2`);

      // Generate KTX2 (VRAM Optimized)
      if (hasToktx && !fs.existsSync(ktx2Path)) {
        const tempResized = path.join(TARGET_DIR, `${baseName}_${tier.name}_temp.png`);
        
        let pipeline = sharp(inputPath);
        if (tier.width && originalWidth > tier.width) {
          pipeline = pipeline.resize({ width: tier.width });
        }
        
        await pipeline.png().toFile(tempResized);
        
        const isDataMap = baseName.includes('_normal') || baseName.includes('_roughness');
        const success = await generateKTX2(tempResized, ktx2Path, isDataMap);
        
        if (fs.existsSync(tempResized)) fs.unlinkSync(tempResized);
        if (success) results.push(`${tier.name}(ktx2)`);
      }
    }
  } catch (error) {
    console.error(
      `\n${colors.red}   Error processing ${baseName}: ${error.message}${colors.reset}`,
    );
  }

  return results;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// ==============================================================================
// MAIN
// ==============================================================================
async function main() {
  console.log(
    `\n${colors.blue}╔══════════════════════════════════════════════════════════════╗${colors.reset}`,
  );
  console.log(
    `${colors.blue}║  🪐 Solar Explorer 3D - Tiered Texture Generator             ║${colors.reset}`,
  );
  console.log(
    `${colors.blue}║  NASA & Scientific Sources | KTX2 VRAM Optimization          ║${colors.reset}`,
  );
  console.log(
    `${colors.blue}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`,
  );

  if (!hasToktx) {
    console.log(
      `${colors.yellow}⚠️  toktx (KTX-Software) not found in PATH.${colors.reset}`,
    );
    console.log(
      `${colors.dim}   KTX2 generation will be skipped. Only WebP will be generated.${colors.reset}\n`,
    );
  } else {
    console.log(
      `${colors.green}✓ toktx CLI found. KTX2 hardware-native textures will be generated.${colors.reset}\n`,
    );
  }

  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  let sharp;
  try {
    sharp = (await import("sharp")).default;
    console.log(
      `${colors.green}✓ Sharp image processor found${colors.reset}\n`,
    );
  } catch {
    console.error(
      `${colors.red}✗ Sharp not found. Run: npm install sharp${colors.reset}`,
    );
    process.exit(1);
  }

  const stats = { success: 0, failed: 0, skipped: 0 };

  for (const [name, config] of Object.entries(TEXTURE_SOURCES)) {
    const tempPath = path.join(TARGET_DIR, `${name}_master.tmp`);
    
    const ktx2Exist = !hasToktx || TIERS.every((t) =>
      fs.existsSync(path.join(TARGET_DIR, `${name}_${t.name}.ktx2`)),
    );

    if (ktx2Exist) {
      console.log(
        `${colors.dim}⏭  ${name}: All tiers exist, skipping${colors.reset}`,
      );
      stats.skipped++;
      continue;
    }

    process.stdout.write(`🌍 ${colors.cyan}${name.padEnd(12)}${colors.reset} `);

    try {
      process.stdout.write(`Downloading... `);
      const result = await tryDownload(config.urls, tempPath, config.fallback);

      if (!result.success) {
        console.log(`${colors.red}FAILED (${result.error})${colors.reset}`);
        stats.failed++;
        continue;
      }

      const sourceType =
        result.source === "fallback"
          ? `${colors.yellow}(fallback)${colors.reset}`
          : `${colors.green}(NASA/SSS)${colors.reset}`;
      process.stdout.write(`${sourceType} `);

      process.stdout.write(`Generating tiers... `);
      const generated = await generateTiers(
        tempPath,
        name,
        sharp,
        config.isRing,
      );
      if (generated.length === 0) {
        console.log(`${colors.red}FAILED (no tiers generated)${colors.reset}`);
        stats.failed++;
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        continue;
      }

      const sizes = TIERS.map((t) => {
        const k = path.join(TARGET_DIR, `${name}_${t.name}.ktx2`);
        return fs.existsSync(k) ? formatBytes(fs.statSync(k).size) : "N/A";
      }).join(" | ");

      console.log(`${colors.green}OK${colors.reset} [${sizes}]`);
      stats.success++;

      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      console.log(`${colors.red}ERROR: ${error.message}${colors.reset}`);
      stats.failed++;
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  console.log(
    `\n${colors.blue}════════════════════════════════════════════════════════════════${colors.reset}`,
  );
  console.log(
    `📊 Summary: ${colors.green}${stats.success} success${colors.reset}, ${colors.yellow}${stats.skipped} skipped${colors.reset}, ${colors.red}${stats.failed} failed${colors.reset}`,
  );
  console.log(`📂 Output: ${TARGET_DIR}`);
  console.log(
    `\n${colors.dim}Tier sizes: Low (1024px) / Mid (2048px) / High (4096px)${colors.reset}`,
  );
  console.log(
    `${colors.blue}════════════════════════════════════════════════════════════════${colors.reset}\n`,
  );
}

main().catch(console.error);
