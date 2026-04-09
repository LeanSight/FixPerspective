import { describe, it, expect } from "vitest"
import {
  normalizePointerPosition,
  pointToCanvas,
  canvasToPoint,
  getPaddedCanvasSize,
  PADDING_RATIO,
} from "@/lib/canvas-utils"

describe("normalizePointerPosition", () => {
  const canvasRect = { left: 100, top: 50 }
  const canvasSize = { width: 800, height: 600 }

  // --- AT: pointer beyond right edge produces x > 1 ---
  it("AT: retorna x > 1 cuando el pointer esta mas alla del borde derecho", () => {
    // clientX = 100 + 900 = 1000 (900px into an 800px canvas)
    const result = normalizePointerPosition(1000, 350, canvasRect, canvasSize)
    expect(result.x).toBeCloseTo(900 / 800) // 1.125
    expect(result.x).toBeGreaterThan(1)
  })

  // --- Unit tests ---
  it("retorna x < 0 cuando el pointer esta antes del borde izquierdo", () => {
    // clientX = 100 - 80 = 20 (80px left of canvas)
    const result = normalizePointerPosition(20, 350, canvasRect, canvasSize)
    expect(result.x).toBeCloseTo(-80 / 800) // -0.1
    expect(result.x).toBeLessThan(0)
  })

  it("retorna y > 1 cuando el pointer esta debajo del borde inferior", () => {
    const result = normalizePointerPosition(500, 50 + 700, canvasRect, canvasSize)
    expect(result.y).toBeCloseTo(700 / 600) // ~1.167
    expect(result.y).toBeGreaterThan(1)
  })

  it("retorna valores dentro de [0,1] para un punto dentro del canvas", () => {
    // clientX = 100 + 400 = 500, clientY = 50 + 300 = 350
    const result = normalizePointerPosition(500, 350, canvasRect, canvasSize)
    expect(result.x).toBeCloseTo(0.5)
    expect(result.y).toBeCloseTo(0.5)
  })

  it("retorna {0,0} para la esquina superior izquierda exacta", () => {
    const result = normalizePointerPosition(100, 50, canvasRect, canvasSize)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
  })
})

describe("getPaddedCanvasSize", () => {
  const imageRect = { imageWidth: 800, imageHeight: 600 }

  it("retorna canvas mas grande que la imagen por el factor de padding", () => {
    const size = getPaddedCanvasSize(imageRect, 0.25)
    // 800 * (1 + 2*0.25) = 800 * 1.5 = 1200
    expect(size.width).toBeCloseTo(1200)
    // 600 * 1.5 = 900
    expect(size.height).toBeCloseTo(900)
  })

  it("con padding 0 retorna el tamano de la imagen", () => {
    const size = getPaddedCanvasSize(imageRect, 0)
    expect(size.width).toBeCloseTo(800)
    expect(size.height).toBeCloseTo(600)
  })
})

describe("pointToCanvas / canvasToPoint", () => {
  const imageRect = { imageWidth: 800, imageHeight: 600 }
  const pad = 0.25

  // --- AT: punto fuera de [0,1] se dibuja dentro del canvas paddeado ---
  it("AT: punto en {-0.1, 0.5} se mapea a una posicion dentro del canvas paddeado", () => {
    const { px, py } = pointToCanvas({ x: -0.1, y: 0.5 }, imageRect, pad)
    // padX = 0.25 * 800 = 200, so x=-0.1 => px = 200 + (-0.1)*800 = 120
    expect(px).toBeCloseTo(120)
    // padY = 0.25 * 600 = 150, so y=0.5 => py = 150 + 0.5*600 = 450
    expect(py).toBeCloseTo(450)
    // Must be >= 0 (inside padded canvas)
    expect(px).toBeGreaterThanOrEqual(0)
  })

  it("punto {0,0} se mapea al inicio del area de imagen (offset del padding)", () => {
    const { px, py } = pointToCanvas({ x: 0, y: 0 }, imageRect, pad)
    // padX = 200, padY = 150
    expect(px).toBeCloseTo(200)
    expect(py).toBeCloseTo(150)
  })

  it("punto {1,1} se mapea al final del area de imagen", () => {
    const { px, py } = pointToCanvas({ x: 1, y: 1 }, imageRect, pad)
    // padX + imageWidth = 200 + 800 = 1000
    expect(px).toBeCloseTo(1000)
    expect(py).toBeCloseTo(750)
  })

  it("punto {-0.25, -0.25} se mapea a la esquina superior izquierda del canvas paddeado", () => {
    const { px, py } = pointToCanvas({ x: -pad, y: -pad }, imageRect, pad)
    expect(px).toBeCloseTo(0)
    expect(py).toBeCloseTo(0)
  })

  it("punto {1.25, 1.25} se mapea a la esquina inferior derecha del canvas paddeado", () => {
    const { px, py } = pointToCanvas({ x: 1 + pad, y: 1 + pad }, imageRect, pad)
    expect(px).toBeCloseTo(1200)
    expect(py).toBeCloseTo(900)
  })

  it("canvasToPoint es la inversa de pointToCanvas", () => {
    const original = { x: -0.15, y: 1.1 }
    const { px, py } = pointToCanvas(original, imageRect, pad)
    const roundtrip = canvasToPoint(px, py, imageRect, pad)
    expect(roundtrip.x).toBeCloseTo(original.x)
    expect(roundtrip.y).toBeCloseTo(original.y)
  })

  it("canvasToPoint en el centro del canvas paddeado retorna {0.5, 0.5}", () => {
    // centro = (1200/2, 900/2) = (600, 450)
    const result = canvasToPoint(600, 450, imageRect, pad)
    expect(result.x).toBeCloseTo(0.5)
    expect(result.y).toBeCloseTo(0.5)
  })
})
