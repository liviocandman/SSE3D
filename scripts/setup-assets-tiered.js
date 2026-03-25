#!/usr/bin/env node

// ==============================================================================
// 🪐 Solar Explorer 3D - Tiered Asset Manager
// ==============================================================================
// Downloads high-resolution textures from official NASA/scientific sources
// and generates Low (1k), Mid (2k) and High (4k+) tiers automatically.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(PROJECT_ROOT, 'public', 'textures');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[90m'
};

// ==============================================================================
// NASA & SCIENTIFIC TEXTURE SOURCES
// ==============================================================================
// Priority: NASA official > Solar System Scope > Planet Pixel Emporium > Fallback
// All sources are public domain or CC-BY licensed

const TEXTURE_SOURCES = {
  sun: {
    // NASA SDO (Solar Dynamics Observatory)
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_sun.jpg',
      'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/frames/5760x2880_16x9_30p/BlackMarble_2016_928m_africa_s.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/sun.jpg'
  },
  mercury: {
    // NASA MESSENGER mission data
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_mercury.jpg',
      'https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003935/mercury_messanger_8192x4096.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/mercury.jpg'
  },
  venus: {
    // NASA Magellan mission radar data
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg',
      'https://www.jpl.nasa.gov/images/pia00104-venus-centered-at-180-degrees-east-longitude'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/venus.jpg'
  },
  earth: {
    // NASA Blue Marble - official Earth texture
    urls: [
      'https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74393/world.200412.3x5400x2700.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg'
  },
  mars: {
    // NASA Mars Viking/MGS data
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_mars.jpg',
      'https://astrogeology.usgs.gov/cache/images/7cf0379df3e7e3b8e3b2d78a8c2c9b30_mars_viking_merged_color_global.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/mars_1024.jpg'
  },
  jupiter: {
    // NASA Cassini/Juno data
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg',
      'https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003936/jupiter_4096x2048.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/jupiter.jpg'
  },
  saturn: {
    // NASA Cassini mission
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_saturn.jpg',
      'https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003937/saturn_4096x2048.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/saturn.jpg'
  },
  uranus: {
    // NASA Voyager 2 data
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_uranus.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/uranus.jpg'
  },
  neptune: {
    // NASA Voyager 2 data
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_neptune.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/neptune.jpg'
  },
  moon: {
    // NASA LRO (Lunar Reconnaissance Orbiter)
    urls: [
      'https://www.solarsystemscope.com/textures/download/8k_moon.jpg',
      'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2048x1024.jpg'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg'
  },
  io: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/7/7b/Io_highest_resolution_true_color.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  europa: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/e/e4/Europa-map-voyager-galileo.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  ganymede: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/c/c2/Ganymede_map.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  callisto: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/2/20/Callisto_map.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  titan: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/0/01/Titan_map.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  enceladus: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/a/ad/Enceladus_map.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  triton: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/a/a6/Triton_color_map.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  generic_moon: {
    urls: ['https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Rhea_map.jpg/1024px-Rhea_map.jpg'],
    fallback: 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
  },
  saturn_ring: {
    urls: [
      'https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png'
    ],
    fallback: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/saturn_ring.png',
    isRing: true
  }
};

// ==============================================================================
// TIER CONFIGURATION
// ==============================================================================
const TIERS = [
  { name: 'low', width: 1024, quality: 70 },   // Mobile - ~50-100KB
  { name: 'mid', width: 2048, quality: 80 },   // Laptop/Tablet - ~200-400KB
  { name: 'high', width: 4096, quality: 85 }   // Desktop - ~800KB-2MB
];

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

function downloadFile(url, outputPath, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SolarExplorer3D/1.0'
      }
    };

    const file = fs.createWriteStream(outputPath);

    const request = protocol.get(url, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        return downloadFile(response.headers.location, outputPath, timeout)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      reject(err);
    });

    request.setTimeout(timeout, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function tryDownload(urls, outputPath, fallback) {
  // Try each URL in order
  for (const url of urls) {
    try {
      await downloadFile(url, outputPath);
      return { success: true, source: 'primary' };
    } catch {
      // Continue to next URL
    }
  }

  // Try fallback
  if (fallback) {
    try {
      await downloadFile(fallback, outputPath);
      return { success: true, source: 'fallback' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'All sources failed' };
}

async function generateTiers(inputPath, baseName, sharp, isRing = false) {
  const results = [];

  try {
    const metadata = await sharp(inputPath).metadata();
    const originalWidth = metadata.width || 2048;

    for (const tier of TIERS) {
      const outputPath = path.join(TARGET_DIR, `${baseName}_${tier.name}.webp`);

      // Skip if already exists
      if (fs.existsSync(outputPath)) {
        continue;
      }

      let pipeline = sharp(inputPath);

      // Only downscale, never upscale
      if (tier.width && originalWidth > tier.width) {
        pipeline = pipeline.resize({ width: tier.width });
      }

      // Use appropriate format
      if (isRing) {
        // Preserve alpha for rings
        await pipeline
          .webp({ quality: tier.quality, alphaQuality: 90 })
          .toFile(outputPath);
      } else {
        await pipeline
          .webp({ quality: tier.quality })
          .toFile(outputPath);
      }

      results.push(tier.name);
    }
  } catch (error) {
    console.error(`\n${colors.red}   Error processing ${baseName}: ${error.message}${colors.reset}`);
  }

  return results;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ==============================================================================
// MAIN
// ==============================================================================
async function main() {
  console.log(`\n${colors.blue}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║  🪐 Solar Explorer 3D - Tiered Texture Generator             ║${colors.reset}`);
  console.log(`${colors.blue}║  NASA & Scientific Sources | Low/Mid/High Quality Tiers      ║${colors.reset}`);
  console.log(`${colors.blue}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  // Create directory
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  // Check Sharp
  let sharp;
  try {
    sharp = (await import('sharp')).default;
    console.log(`${colors.green}✓ Sharp image processor found${colors.reset}\n`);
  } catch {
    console.error(`${colors.red}✗ Sharp not found. Run: npm install sharp${colors.reset}`);
    process.exit(1);
  }

  const stats = { success: 0, failed: 0, skipped: 0 };

  for (const [name, config] of Object.entries(TEXTURE_SOURCES)) {
    const tempPath = path.join(TARGET_DIR, `${name}_master.tmp`);
    // Check if all tiers already exist
    const allExist = TIERS.every(t =>
      fs.existsSync(path.join(TARGET_DIR, `${name}_${t.name}.webp`))
    );

    if (allExist) {
      console.log(`${colors.dim}⏭  ${name}: All tiers exist, skipping${colors.reset}`);
      stats.skipped++;
      continue;
    }

    process.stdout.write(`🌍 ${colors.cyan}${name.padEnd(12)}${colors.reset} `);

    try {
      // Download master texture
      process.stdout.write(`Downloading... `);
      const result = await tryDownload(config.urls, tempPath, config.fallback);

      if (!result.success) {
        console.log(`${colors.red}FAILED (${result.error})${colors.reset}`);
        stats.failed++;
        continue;
      }

      const sourceType = result.source === 'fallback' ? `${colors.yellow}(fallback)${colors.reset}` : `${colors.green}(NASA/SSS)${colors.reset}`;
      process.stdout.write(`${sourceType} `);

      // Generate tiers
      process.stdout.write(`Generating tiers... `);
      const generated = await generateTiers(tempPath, name, sharp, config.isRing);
      if (generated.length === 0) {
        console.log(`${colors.red}FAILED (no tiers generated)${colors.reset}`);
        stats.failed++;
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        continue;
      }

      // Get file sizes
      const sizes = TIERS.map(t => {
        const p = path.join(TARGET_DIR, `${name}_${t.name}.webp`);
        return fs.existsSync(p) ? formatBytes(fs.statSync(p).size) : '?';
      }).join(' / ');

      console.log(`${colors.green}OK${colors.reset} [${sizes}]`);
      stats.success++;

      // Cleanup temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

    } catch (error) {
      console.log(`${colors.red}ERROR: ${error.message}${colors.reset}`);
      stats.failed++;
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  // Summary
  console.log(`\n${colors.blue}════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`📊 Summary: ${colors.green}${stats.success} success${colors.reset}, ${colors.yellow}${stats.skipped} skipped${colors.reset}, ${colors.red}${stats.failed} failed${colors.reset}`);
  console.log(`📂 Output: ${TARGET_DIR}`);
  console.log(`\n${colors.dim}Tier sizes: Low (1024px) / Mid (2048px) / High (4096px)${colors.reset}`);
  console.log(`${colors.blue}════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

main().catch(console.error);
