import { describe, it, expect } from "vitest"

// We need to test identifyCorners and the perspective transform with OOB points.
// identifyCorners is not exported, so we test it indirectly via a re-export or
// we extract and test the core logic. For now, let's export it for testing.
import { identifyCorners } from "@/lib/warp"

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
