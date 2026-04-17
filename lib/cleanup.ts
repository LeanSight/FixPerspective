"use client"

/**
 * Flat-field (shading) correction: divides each channel by the illumination map
 * (a blurred version of the image). Uniform-illumination backgrounds become
 * near-white; darker content is preserved proportionally.
 *
 * out[c] = clamp(src[c] * 255 / illum[c]); alpha unchanged.
 * If illum[c] == 0, output is 0 (avoid divide-by-zero).
 */
export function flatFieldCorrect(src: ImageData, illumination: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data.length)
  const s = src.data
  const i = illumination.data
  for (let p = 0; p < s.length; p += 4) {
    for (let c = 0; c < 3; c++) {
      const ill = i[p + c]
      out[p + c] = ill === 0 ? 0 : Math.min(255, Math.round((s[p + c] * 255) / ill))
    }
    out[p + 3] = s[p + 3]
  }
  return { data: out, width: src.width, height: src.height } as ImageData
}

/**
 * Stretches the histogram so that the given percentile of pixel brightness
 * maps to pure white (255). Anything brighter saturates. Darker pixels scale
 * proportionally.
 *
 * Brightness is max(R, G, B) per pixel. percentile is in [0, 100].
 */
export function stretchWhitePoint(src: ImageData, percentile: number): ImageData {
  const data = src.data
  const pixelCount = data.length / 4

  const brightnesses = new Uint8Array(pixelCount)
  for (let p = 0, k = 0; p < data.length; p += 4, k++) {
    brightnesses[k] = Math.max(data[p], data[p + 1], data[p + 2])
  }
  const sorted = Array.from(brightnesses).sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((percentile / 100) * (sorted.length - 1))))
  const whitePoint = sorted[idx]

  const out = new Uint8ClampedArray(data.length)
  if (whitePoint === 0) {
    out.set(data)
    return { data: out, width: src.width, height: src.height } as ImageData
  }
  const scale = 255 / whitePoint
  for (let p = 0; p < data.length; p += 4) {
    out[p] = Math.min(255, Math.round(data[p] * scale))
    out[p + 1] = Math.min(255, Math.round(data[p + 1] * scale))
    out[p + 2] = Math.min(255, Math.round(data[p + 2] * scale))
    out[p + 3] = data[p + 3]
  }
  return { data: out, width: src.width, height: src.height } as ImageData
}

/**
 * Boost saturation in HSL space by the given factor (1.0 = identity).
 * Gray pixels (S=0) stay gray.
 */
export function boostSaturation(src: ImageData, factor: number): ImageData {
  const data = src.data
  const out = new Uint8ClampedArray(data.length)
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p] / 255
    const g = data[p + 1] / 255
    const b = data[p + 2] / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    let h = 0
    let s = 0
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0)
          break
        case g:
          h = (b - r) / d + 2
          break
        default:
          h = (r - g) / d + 4
      }
      h /= 6
    }

    s = Math.min(1, Math.max(0, s * factor))

    const [nr, ng, nb] = hslToRgb(h, s, l)
    out[p] = Math.round(nr * 255)
    out[p + 1] = Math.round(ng * 255)
    out[p + 2] = Math.round(nb * 255)
    out[p + 3] = data[p + 3]
  }
  return { data: out, width: src.width, height: src.height } as ImageData
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hueToChannel(p, q, h + 1 / 3), hueToChannel(p, q, h), hueToChannel(p, q, h - 1 / 3)]
}

function hueToChannel(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

/**
 * End-to-end cleanup pipeline: flat-field correction (illumination estimated
 * via a heavy blur of the canvas), white-point stretch to pure white, and
 * saturation boost. strength in [0, 1] blends the cleaned result with the
 * original (0 = no change, 1 = fully cleaned).
 *
 * Mutates the given canvas context in place. Blur uses the native GPU-backed
 * CanvasRenderingContext2D.filter, which is not available in jsdom; this
 * function is only exercised at runtime in the browser.
 */
export function applyCleanupPipeline(ctx: CanvasRenderingContext2D, strength: number): void {
  if (strength <= 0) return

  const canvas = ctx.canvas
  const { width, height } = canvas
  const original = ctx.getImageData(0, 0, width, height)

  // Illumination map: heavily blurred copy of the source.
  const blurRadius = Math.max(20, Math.round(Math.min(width, height) * 0.08))
  const scratch = document.createElement("canvas")
  scratch.width = width
  scratch.height = height
  const scratchCtx = scratch.getContext("2d")
  if (!scratchCtx) return
  scratchCtx.filter = `blur(${blurRadius}px)`
  scratchCtx.drawImage(canvas, 0, 0)
  const illumination = scratchCtx.getImageData(0, 0, width, height)

  const flat = flatFieldCorrect(original, illumination)
  const stretched = stretchWhitePoint(flat, 95)
  const saturated = boostSaturation(stretched, 1 + 0.3 * strength)

  // Blend original with fully-cleaned by strength.
  const out = new Uint8ClampedArray(original.data.length)
  const o = original.data
  const c = saturated.data
  for (let i = 0; i < o.length; i += 4) {
    out[i] = Math.round(o[i] * (1 - strength) + c[i] * strength)
    out[i + 1] = Math.round(o[i + 1] * (1 - strength) + c[i + 1] * strength)
    out[i + 2] = Math.round(o[i + 2] * (1 - strength) + c[i + 2] * strength)
    out[i + 3] = o[i + 3]
  }
  ctx.putImageData(new ImageData(out, width, height), 0, 0)
}
