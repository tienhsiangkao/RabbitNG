let screenshotModulePromise = null;
let jimpModulePromise = null;

let cachedImage = null;
let cachedAt = 0;

function parseHexColor(hex) {
  if (!hex) return null;
  const normalized = hex.replace("#", "").trim();
  if (normalized.length === 3) {
    const r = normalized[0];
    const g = normalized[1];
    const b = normalized[2];
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16)
    };
  }
  if (normalized.length !== 6) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function colorDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

async function getScreenshotModule() {
  if (!screenshotModulePromise) {
    screenshotModulePromise = import("screenshot-desktop").then((mod) => mod.default ?? mod);
  }
  return screenshotModulePromise;
}

async function getJimpModule() {
  if (!jimpModulePromise) {
    jimpModulePromise = import("jimp").then((mod) => {
      if (mod?.Jimp) return mod.Jimp;
      if (mod?.default?.Jimp) return mod.default.Jimp;
      return mod.default ?? mod;
    });
  }
  return jimpModulePromise;
}

async function captureScreen(cacheMs = 0) {
  const now = Date.now();
  if (cachedImage && cacheMs > 0 && now - cachedAt <= cacheMs) {
    return cachedImage;
  }

  const screenshotDesktop = await getScreenshotModule();
  const Jimp = await getJimpModule();

  const buffer = await screenshotDesktop({ format: "png" });
  cachedImage = await Jimp.read(buffer);
  cachedAt = now;
  return cachedImage;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPixelColor(image, x, y) {
  const clampedX = clamp(x, 0, image.bitmap.width - 1);
  const clampedY = clamp(y, 0, image.bitmap.height - 1);
  const idx = image.getPixelIndex(clampedX, clampedY);
  const data = image.bitmap.data;
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2]
  };
}

function resolveSamples(config) {
  if (!config?.samples) return [];
  return config.samples
    .map((sample) => ({
      name: sample?.name || "sample",
      xPct: typeof sample?.xPct === "number" ? sample.xPct : 0.5,
      yPct: typeof sample?.yPct === "number" ? sample.yPct : 0.5,
      xOffset: Math.floor(sample?.xOffset || 0),
      yOffset: Math.floor(sample?.yOffset || 0),
      radius: Math.max(0, Math.floor(sample?.radius || 0)),
      color: parseHexColor(sample?.color),
      tolerance: Math.max(0, Math.floor(sample?.tolerance ?? config?.tolerance ?? 35))
    }))
    .filter((s) => s.color);
}

async function evaluateColorSamples(win, config, options = {}) {
  const samples = resolveSamples(config);
  if (samples.length === 0) {
    throw new Error("No valid color samples configured");
  }

  const bounds = win?.getBounds?.();
  if (!bounds) {
    throw new Error("Window bounds unavailable");
  }

  const cacheMs = Math.max(0, config.cacheMs ?? 120);
  const image = await captureScreen(cacheMs);
  const matches = [];

  for (const sample of samples) {
    const baseX = Math.round(bounds.x + bounds.width * sample.xPct) + sample.xOffset;
    const baseY = Math.round(bounds.y + bounds.height * sample.yPct) + sample.yOffset;

    if (baseX < 0 || baseY < 0 || baseX >= image.bitmap.width || baseY >= image.bitmap.height) {
      matches.push({ sample, matched: false, reason: "out-of-bounds" });
      continue;
    }

    let bestDistance = Number.POSITIVE_INFINITY;
    if (sample.radius > 0) {
      const diameter = sample.radius * 2 + 1;
      for (let dx = -sample.radius; dx <= sample.radius; dx++) {
        for (let dy = -sample.radius; dy <= sample.radius; dy++) {
          const px = baseX + dx;
          const py = baseY + dy;
          if (px < 0 || py < 0 || px >= image.bitmap.width || py >= image.bitmap.height) {
            continue;
          }
          const color = getPixelColor(image, px, py);
          const distance = colorDistance(color, sample.color);
          if (distance < bestDistance) {
            bestDistance = distance;
          }
        }
      }
    } else {
      const color = getPixelColor(image, baseX, baseY);
      bestDistance = colorDistance(color, sample.color);
    }
    const matched = bestDistance <= sample.tolerance;
    matches.push({ sample, matched, distance: bestDistance });
  }

  const minMatches = Math.max(1, Math.min(samples.length, config.minMatches ?? samples.length));
  const successCount = matches.filter((m) => m.matched).length;
  return {
    matched: successCount >= minMatches,
    matches
  };
}

export async function isPlayerTurn(win, config, options = {}) {
  if (!config?.enabled) return true;
  if (!win) {
    throw new Error("No window supplied for turn detection");
  }

  switch (config.strategy) {
    case "color-sample": {
      const result = await evaluateColorSamples(win, config, options);
      if (!result.matched && options.debug) {
        console.log(
          `[turn-detector] Color samples did not match. Success=${result.matches
            .filter((m) => m.matched)
            .map((m) => m.sample.name)
            .join(", ")}`
        );
      }
      return result.matched;
    }
    default:
      return true;
  }
}
