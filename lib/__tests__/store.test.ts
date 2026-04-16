import { describe, it, expect, beforeEach } from "vitest"
import { useImageWarpStore } from "@/lib/store"

describe("store: contrato de puntos fuera de rango", () => {
  beforeEach(() => {
    useImageWarpStore.getState().resetPoints()
  })

  // --- Acceptance Test ---
  it("AT: almacena un punto con coordenadas fuera de [0,1]", () => {
    const { updatePoint } = useImageWarpStore.getState()
    updatePoint(0, { x: -0.2, y: 1.3 })

    const point = useImageWarpStore.getState().points[0]
    expect(point).toEqual({ x: -0.2, y: 1.3 })
  })

  // --- Unit Tests ---
  it("almacena coordenada x negativa sin modificar", () => {
    const { updatePoint } = useImageWarpStore.getState()
    updatePoint(1, { x: -0.5, y: 0.5 })

    const point = useImageWarpStore.getState().points[1]
    expect(point.x).toBe(-0.5)
  })

  it("almacena coordenada y mayor que 1 sin modificar", () => {
    const { updatePoint } = useImageWarpStore.getState()
    updatePoint(2, { x: 0.5, y: 1.8 })

    const point = useImageWarpStore.getState().points[2]
    expect(point.y).toBe(1.8)
  })

  it("resetPoints restaura defaults dentro de [0,1]", () => {
    const store = useImageWarpStore.getState()
    store.updatePoint(0, { x: -0.5, y: 2.0 })
    store.resetPoints()

    const points = useImageWarpStore.getState().points
    expect(points[0]).toEqual({ x: 0.2, y: 0.2 })
    expect(points[1]).toEqual({ x: 0.8, y: 0.2 })
    expect(points[2]).toEqual({ x: 0.8, y: 0.8 })
    expect(points[3]).toEqual({ x: 0.2, y: 0.8 })
  })
})

describe("store: isCorrected flag y auto-reset", () => {
  beforeEach(() => {
    useImageWarpStore.getState().resetPoints()
  })

  // --- AT: updatePoint resetea isCorrected ---
  it("AT: setCorrected(true) seguido de updatePoint resulta en isCorrected=false", () => {
    const store = useImageWarpStore.getState()
    store.setCorrected(true)
    expect(useImageWarpStore.getState().isCorrected).toBe(true)

    store.updatePoint(0, { x: 0.3, y: 0.3 })
    expect(useImageWarpStore.getState().isCorrected).toBe(false)
  })

  // --- Unit tests ---
  it("isCorrected inicia en false", () => {
    expect(useImageWarpStore.getState().isCorrected).toBe(false)
  })

  it("setCorrected(true) activa el flag", () => {
    useImageWarpStore.getState().setCorrected(true)
    expect(useImageWarpStore.getState().isCorrected).toBe(true)
  })

  it("setCorrected(false) desactiva el flag", () => {
    const store = useImageWarpStore.getState()
    store.setCorrected(true)
    store.setCorrected(false)
    expect(useImageWarpStore.getState().isCorrected).toBe(false)
  })

  it("resetPoints resetea isCorrected a false", () => {
    const store = useImageWarpStore.getState()
    store.setCorrected(true)
    store.resetPoints()
    expect(useImageWarpStore.getState().isCorrected).toBe(false)
  })
})

describe("store: heightScale para ajuste vertical", () => {
  beforeEach(() => {
    useImageWarpStore.getState().resetPoints()
  })

  // --- AT: el usuario puede ajustar el heightScale para expandir verticalmente ---
  it("AT: setHeightScale(1.5) se refleja en el estado", () => {
    const store = useImageWarpStore.getState()
    store.setHeightScale(1.5)
    expect(useImageWarpStore.getState().heightScale).toBe(1.5)
  })

  it("heightScale inicia en 1.0", () => {
    expect(useImageWarpStore.getState().heightScale).toBe(1.0)
  })

  it("resetPoints resetea heightScale a 1.0", () => {
    const store = useImageWarpStore.getState()
    store.setHeightScale(2.0)
    store.resetPoints()
    expect(useImageWarpStore.getState().heightScale).toBe(1.0)
  })
})
