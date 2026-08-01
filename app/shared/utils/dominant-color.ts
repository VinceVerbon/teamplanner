// F20 pure logo-color derivation. Runs in the browser on canvas ImageData at upload
// time (the server never decodes images); pure over a pixel array so it is testable.

/**
 * Dominant color from RGBA pixel data: quantize opaque, non-extreme pixels into
 * coarse buckets and return the average color of the fullest bucket as '#rrggbb'.
 * Near-white and near-black pixels are ignored (logo backgrounds and outlines);
 * returns null when nothing usable remains.
 */
export function dominantColorFromPixels(pixels: Uint8ClampedArray | number[]): string | null {
  const buckets = new Map<string, { r: number, g: number, b: number, n: number }>()
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    const a = pixels[i + 3]!
    if (a < 128) continue // transparent
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (min > 230 || max < 25) continue // near-white / near-black
    if (max - min < 20) continue // grey - not a brand color
    const key = `${r >> 5}-${g >> 5}-${b >> 5}` // 8x8x8 buckets
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.n++
    buckets.set(key, bucket)
  }
  let best: { r: number, g: number, b: number, n: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.n > best.n) best = bucket
  }
  if (!best) return null
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, '0')
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`
}
