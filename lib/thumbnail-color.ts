"use client";

// The main color of a thumbnail, for tinting a card's hover background the
// way youtube.com does. YouTube's image server allows cross-origin reads, so
// the image can be sampled on a small canvas. Results are remembered on the
// device; null means "use the default tint".

export type Rgb = [number, number, number];

const CACHE_KEY = "youtube-course-viewer-thumb-colors-v1";
const CACHE_LIMIT = 400;
const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;

let cache: Record<string, Rgb | null> | null = null;
const pending = new Map<string, Promise<Rgb | null>>();

function readCache() {
  if (cache) return cache;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}");
    cache = value && typeof value === "object" ? (value as Record<string, Rgb | null>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function remember(url: string, color: Rgb | null) {
  const store = readCache();
  delete store[url];
  store[url] = color;
  const keys = Object.keys(store);
  for (const key of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) {
    delete store[key];
  }
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    // Kept in memory for this visit.
  }
}

export function getCachedThumbnailColor(url: string): Rgb | null | undefined {
  return url ? readCache()[url] : null;
}

// A weighted average that favors vivid pixels, so black bars and white
// text don't wash the color out.
function dominantColor(data: Uint8ClampedArray): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const brightness = max / 255;
    const weight = saturation * saturation * brightness + 0.02;
    r += red * weight;
    g += green * weight;
    b += blue * weight;
    total += weight;
  }
  return total > 0 ? [Math.round(r / total), Math.round(g / total), Math.round(b / total)] : null;
}

export function fetchThumbnailColor(url: string): Promise<Rgb | null> {
  const known = getCachedThumbnailColor(url);
  if (known !== undefined) return Promise.resolve(known);
  const running = pending.get(url);
  if (running) return running;

  const request = new Promise<Rgb | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_WIDTH;
        canvas.height = SAMPLE_HEIGHT;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        resolve(dominantColor(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  }).then((color) => {
    remember(url, color);
    pending.delete(url);
    return color;
  });
  pending.set(url, request);
  return request;
}

function toHsl([r, g, b]: Rgb) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: light };
  const delta = max - min;
  const s = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const h =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return { h: h * 60, s, l: light };
}

// CSS variables for the hover background: a pale tint in the light theme and
// a deep shade in the dark theme, both from the thumbnail's hue.
export function tintVariables(color: Rgb | null | undefined) {
  if (!color) return undefined;
  const { h, s } = toHsl(color);
  const hue = Math.round(h);
  return {
    "--tint-light": `hsl(${hue} ${Math.round(Math.min(70, Math.max(25, s * 100)))}% 93%)`,
    "--tint-dark": `hsl(${hue} ${Math.round(Math.min(45, Math.max(15, s * 60)))}% 17%)`,
  } as Record<string, string>;
}
