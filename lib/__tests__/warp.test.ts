import { describe, it, expect } from "vitest"

// We need to test identifyCorners and the perspective transform with OOB points.
// identifyCorners is not exported, so we test it indirectly via a re-export or
// we extract and test the core logic. For now, let's export it for testing.
import { identifyCorners, computeOutputSize, computeRealOutputSize, lineIntersect } from "@/lib/warp"

describe("warp: puntos fuera de rango", () => {
  // --- AT: identifyCorners funciona con coordenadas negativas ---
  it("AT: identifyCorners identifica esquinas correctamente con coordenadas negativas", () => {
    const points = [
      { x: -10, y: -10 },   // top-left (OOB)
      { x: 800, y: -5 },    // top-right (OOB y)
      { x: 810, y: 600 },   // bottom-right
      { x: -5, y: 610 },    // bottom-left (OOB x)
    ]
    const sorted = identifyCorners(points)
    // top-left should be the one closest to (minX, minY) = (-10, -10)
    expect(sorted[0]).toEqual({ x: -10, y: -10 })
    // top-right closest to (810, -10)
    expect(sorted[1]).toEqual({ x: 800, y: -5 })
    // bottom-right closest to (810, 610)
    expect(sorted[2]).toEqual({ x: 810, y: 600 })
    // bottom-left closest to (-10, 610)
    expect(sorted[3]).toEqual({ x: -5, y: 610 })
  })

  it("identifyCorners funciona con todos los puntos dentro de rango", () => {
    const points = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ]
    const sorted = identifyCorners(points)
    expect(sorted[0]).toEqual({ x: 100, y: 100 })
    expect(sorted[1]).toEqual({ x: 700, y: 100 })
    expect(sorted[2]).toEqual({ x: 700, y: 500 })
    expect(sorted[3]).toEqual({ x: 100, y: 500 })
  })

  it("identifyCorners con puntos desordenados los reordena correctamente", () => {
    const points = [
      { x: 700, y: 500 },   // bottom-right
      { x: -10, y: -10 },   // top-left
      { x: -5, y: 510 },    // bottom-left
      { x: 710, y: -5 },    // top-right
    ]
    const sorted = identifyCorners(points)
    expect(sorted[0]).toEqual({ x: -10, y: -10 })  // top-left
    expect(sorted[1]).toEqual({ x: 710, y: -5 })   // top-right
    expect(sorted[2]).toEqual({ x: 700, y: 500 })   // bottom-right
    expect(sorted[3]).toEqual({ x: -5, y: 510 })   // bottom-left
  })
})

describe("computeOutputSize", () => {
  // AT: trapecio perspectiva produce height mayor que bounding-box height
  it("AT: trapecio con perspectiva produce height mayor que el span vertical del bbox", () => {
    // Simula la mesa del usuario: bottom mas ancho, lados inclinados
    // BBox height = 490 - 108 = 382
    // Left edge dist = sqrt((56-28)^2 + (528-108)^2) = sqrt(784+176400) ≈ 421
    // Right edge dist = sqrt((912-712)^2 + (512-108)^2) = sqrt(40000+163216) ≈ 451
    const corners = [
      { x: 56, y: 108 },   // TL
      { x: 712, y: 108 },  // TR
      { x: 912, y: 512 },  // BR
      { x: 28, y: 528 },   // BL (OOB-ish)
    ]
    const result = computeOutputSize(corners)
    const bboxHeight = 528 - 108 // = 420
    expect(result.height).toBeGreaterThan(bboxHeight)
  })

  it("cuadrado perfecto 100x100 retorna width=100, height=100", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    const result = computeOutputSize(corners)
    expect(result.width).toBeCloseTo(100)
    expect(result.height).toBeCloseTo(100)
  })

  it("rectangulo 200x100 retorna width=200, height=100", () => {
    const corners = [
      { x: 50, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 150 },
      { x: 50, y: 150 },
    ]
    const result = computeOutputSize(corners)
    expect(result.width).toBeCloseTo(200)
    expect(result.height).toBeCloseTo(100)
  })

  it("usa el mayor de los dos lados opuestos para width", () => {
    // Top edge = 600, bottom edge = 800 -> maxWidth = 800
    const corners = [
      { x: 100, y: 0 },
      { x: 700, y: 0 },
      { x: 800, y: 400 },
      { x: 0, y: 400 },
    ]
    const result = computeOutputSize(corners)
    expect(result.width).toBeCloseTo(800)
  })

  it("usa el mayor de los dos lados opuestos para height", () => {
    // Left edge = sqrt(100^2 + 400^2) ≈ 412, right edge = sqrt(100^2 + 400^2) ≈ 412
    const corners = [
      { x: 100, y: 0 },
      { x: 700, y: 0 },
      { x: 800, y: 400 },
      { x: 0, y: 400 },
    ]
    const result = computeOutputSize(corners)
    // Left: sqrt((0-100)^2 + (400-0)^2) = sqrt(10000+160000) ≈ 412.3
    // Right: sqrt((800-700)^2 + (400-0)^2) = sqrt(10000+160000) ≈ 412.3
    expect(result.height).toBeCloseTo(412.3, 0)
  })
})

describe("lineIntersect", () => {
  it("encuentra la interseccion de dos lineas", () => {
    const result = lineIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 })
    expect(result).not.toBeNull()
    expect(result!.x).toBeCloseTo(0.5)
    expect(result!.y).toBeCloseTo(0.5)
  })

  it("retorna null para lineas paralelas", () => {
    const result = lineIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })
    expect(result).toBeNull()
  })
})

describe("computeRealOutputSize", () => {
  // AT: para un trapecio con perspectiva fuerte (mesa vista desde angulo),
  // el height debe ser significativamente mayor que el Euclidean height
  it("AT: trapecio perspectiva produce height mayor que el metodo Euclidiano", () => {
    // Simula la foto de la mesa: bottom mas ancho (cercano), top mas angosto (lejano)
    // Los lados van "hacia adentro" de la escena
    const corners = [
      { x: 56, y: 144 },   // TL (lejano)
      { x: 712, y: 120 },  // TR (lejano)
      { x: 912, y: 512 },  // BR (cercano)
      { x: -24, y: 528 },  // BL (cercano)
    ]
    const eucResult = computeOutputSize(corners)
    const realResult = computeRealOutputSize(corners, 800, 600)

    // El height real debe ser mayor que el Euclidiano (los lados estan acortados por perspectiva)
    expect(realResult.height).toBeGreaterThan(eucResult.height)
  })

  it("rectangulo sin perspectiva retorna dimensiones similares al Euclidiano", () => {
    // Un rectangulo casi sin distorsion (bordes casi paralelos)
    const corners = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ]
    const result = computeRealOutputSize(corners, 800, 600)
    // Deberia ser cercano a 600x400
    expect(result.width).toBeCloseTo(600, -1)
    expect(result.height).toBeCloseTo(400, -1)
  })

  it("el aspect ratio width/height es menor que el Euclidiano para perspectiva fuerte", () => {
    // Bottom edge mucho mas ancho que top = perspectiva fuerte
    const corners = [
      { x: 200, y: 100 },  // TL
      { x: 600, y: 100 },  // TR
      { x: 900, y: 500 },  // BR
      { x: -100, y: 500 }, // BL
    ]
    const eucResult = computeOutputSize(corners)
    const realResult = computeRealOutputSize(corners, 1000, 600)

    const eucRatio = eucResult.width / eucResult.height
    const realRatio = realResult.width / realResult.height

    // El ratio real debe ser menor (mas alto) que el Euclidiano
    expect(realRatio).toBeLessThan(eucRatio)
  })
})
