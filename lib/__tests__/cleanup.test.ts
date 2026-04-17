import { describe, it, expect } from "vitest"
import { flatFieldCorrect, stretchWhitePoint, boostSaturation } from "@/lib/cleanup"

// Helper to build an ImageData-like object from flat RGBA array
// (jsdom does not expose ImageData globally; the functions operate on plain shapes.)
const makeImageData = (rgba: number[], width: number, height: number): ImageData => {
  return { data: new Uint8ClampedArray(rgba), width, height } as ImageData
}

describe("flatFieldCorrect", () => {
  // --- AT: iluminación desigual se normaliza dividiendo por el mapa de iluminación
  it("AT: píxel igual a su iluminación local se vuelve blanco puro, contenido más oscuro se preserva relativamente", () => {
    // 2 pixels: dark content on lighter background
    const src = makeImageData(
      [
        30, 30, 30, 255, // content: muy oscuro
        150, 150, 150, 255, // background: gris medio
      ],
      2, 1
    )
    // Illumination: content se "contamina" por el blur (promediado con fondo) → 90
    // background recibe iluminación plena → 150
    const illum = makeImageData(
      [
        90, 90, 90, 255,
        150, 150, 150, 255,
      ],
      2, 1
    )

    const out = flatFieldCorrect(src, illum)

    // content: 30/90 * 255 ≈ 85
    expect(out.data[0]).toBe(85)
    expect(out.data[1]).toBe(85)
    expect(out.data[2]).toBe(85)
    // background: 150/150 * 255 = 255
    expect(out.data[4]).toBe(255)
    expect(out.data[5]).toBe(255)
    expect(out.data[6]).toBe(255)
  })

  it("alpha se preserva tal cual", () => {
    const src = makeImageData([100, 100, 100, 180], 1, 1)
    const illum = makeImageData([100, 100, 100, 255], 1, 1)
    const out = flatFieldCorrect(src, illum)
    expect(out.data[3]).toBe(180)
  })

  it("cuando iluminación es cero, el píxel sale en 0 (evita divide-by-zero)", () => {
    const src = makeImageData([50, 50, 50, 255], 1, 1)
    const illum = makeImageData([0, 0, 0, 255], 1, 1)
    const out = flatFieldCorrect(src, illum)
    expect(out.data[0]).toBe(0)
    expect(out.data[1]).toBe(0)
    expect(out.data[2]).toBe(0)
  })

  it("satura a 255 cuando src > illumination (sin overflow)", () => {
    const src = makeImageData([200, 200, 200, 255], 1, 1)
    const illum = makeImageData([50, 50, 50, 255], 1, 1)
    const out = flatFieldCorrect(src, illum)
    expect(out.data[0]).toBe(255)
  })

  it("preserva color del contenido: post-it rojo sobre fondo gris queda rojo pero más claro", () => {
    // Red post-it: [200, 50, 50], bg gray blurred: [120, 120, 120]
    const src = makeImageData([200, 50, 50, 255], 1, 1)
    const illum = makeImageData([120, 120, 120, 255], 1, 1)
    const out = flatFieldCorrect(src, illum)
    // R: 200*255/120 ≈ 425 → 255
    // G: 50*255/120 ≈ 106
    // B: 50*255/120 ≈ 106
    expect(out.data[0]).toBe(255)
    expect(out.data[1]).toBe(106)
    expect(out.data[2]).toBe(106)
  })
})

describe("stretchWhitePoint", () => {
  // --- AT: estira los píxeles más brillantes hasta blanco puro
  it("AT: percentil indicado se mapea a 255; valores proporcionales por debajo", () => {
    // 5 pixels, brightnesses: 100, 150, 180, 200, 240
    // percentil 80 → valor = 200
    // stretch factor = 255/200 = 1.275
    const src = makeImageData(
      [
        100, 100, 100, 255,
        150, 150, 150, 255,
        180, 180, 180, 255,
        200, 200, 200, 255,
        240, 240, 240, 255,
      ],
      5, 1
    )

    const out = stretchWhitePoint(src, 80)

    // 240 estaba arriba del percentil → satura a 255
    expect(out.data[16]).toBe(255)
    // 200 (percentil 80) → 255
    expect(out.data[12]).toBe(255)
    // 100 * 255/200 = 127.5 → 128 (round)
    expect(out.data[0]).toBeCloseTo(127, 0)
  })

  it("percentil 100 no cambia nada (el valor máximo ya es white-point)", () => {
    const src = makeImageData([100, 100, 100, 255, 200, 200, 200, 255], 2, 1)
    const out = stretchWhitePoint(src, 100)
    // Max brightness is 200; 200*255/200 = 255, 100*255/200 = 127.5 → 128
    expect(out.data[4]).toBe(255)
    expect(out.data[0]).toBeCloseTo(127, 0)
  })

  it("alpha se preserva tal cual", () => {
    const src = makeImageData([100, 100, 100, 180, 200, 200, 200, 90], 2, 1)
    const out = stretchWhitePoint(src, 90)
    expect(out.data[3]).toBe(180)
    expect(out.data[7]).toBe(90)
  })
})

describe("boostSaturation", () => {
  // --- AT: un color saturado se vuelve más vívido; gris queda gris
  it("AT: factor=1.5 aumenta la saturación de un color; factor=1 no cambia nada", () => {
    // Color: rojo saturado medio [200, 100, 100]
    // S en HSL = (max-min)/(max+min si L<0.5 else 2-max-min) — 100/300 = 0.333 si L<0.5
    // Con factor 1.5, S pasa a ~0.5
    const src = makeImageData([200, 100, 100, 255], 1, 1)
    const out = boostSaturation(src, 1.5)
    // Rojo debe volverse más rojo (mayor distancia R - G/B)
    const origRedDominance = 200 - 100
    const newRedDominance = out.data[0] - out.data[1]
    expect(newRedDominance).toBeGreaterThan(origRedDominance)
  })

  it("factor=1.0 deja el color sin cambios (identity)", () => {
    const src = makeImageData([123, 77, 200, 255], 1, 1)
    const out = boostSaturation(src, 1.0)
    expect(out.data[0]).toBe(123)
    expect(out.data[1]).toBe(77)
    expect(out.data[2]).toBe(200)
  })

  it("gris (saturación=0) queda gris con cualquier factor", () => {
    const src = makeImageData([128, 128, 128, 255], 1, 1)
    const out = boostSaturation(src, 3.0)
    expect(out.data[0]).toBe(128)
    expect(out.data[1]).toBe(128)
    expect(out.data[2]).toBe(128)
  })

  it("alpha se preserva", () => {
    const src = makeImageData([200, 100, 100, 170], 1, 1)
    const out = boostSaturation(src, 1.5)
    expect(out.data[3]).toBe(170)
  })
})
