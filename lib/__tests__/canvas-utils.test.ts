import { describe, it, expect } from "vitest"
import { normalizePointerPosition } from "@/lib/canvas-utils"

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
