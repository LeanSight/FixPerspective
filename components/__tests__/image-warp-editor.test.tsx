import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import ImageWarpEditor from "@/components/image-warp-editor"

// Mock child components to avoid canvas/complex rendering
vi.mock("@/components/image-canvas", () => ({
  default: () => <div data-testid="image-canvas" />,
}))
vi.mock("@/components/control-panel", () => ({
  default: () => <div data-testid="control-panel" />,
}))
vi.mock("@/hooks/use-mobile", () => ({
  useMobile: () => false,
}))

describe("ImageWarpEditor: cambiar imagen", () => {
  // AT: el file input siempre esta en el DOM, incluso despues de cargar una imagen
  it("AT: el file input existe en el DOM cuando hay una imagen cargada", () => {
    const { container } = render(<ImageWarpEditor />)

    // Simular carga de imagen: buscar el input y disparar change
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    // Crear un archivo fake y disparar change
    const file = new File(["fake"], "test.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file] })
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))

    // Despues de cargar la imagen, el input debe seguir en el DOM
    const fileInputAfter = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInputAfter).not.toBeNull()
  })
})

describe("ImageWarpEditor: drag and drop", () => {
  // AT: drop de una imagen sobre el dropzone activa el editor (ImageCanvas aparece)
  it("AT: drop de un archivo de imagen en el dropzone carga la imagen", () => {
    const { container } = render(<ImageWarpEditor />)
    const findCanvas = () => container.querySelector('[data-testid="image-canvas"]')

    // Precondition: sin imagen, ImageCanvas no esta montado
    expect(findCanvas()).toBeNull()

    // El dropzone es el div con borde dashed (el receptor)
    const dropzone = container.querySelector(".border-dashed") as HTMLElement
    expect(dropzone).not.toBeNull()

    // Simular drop con un archivo de imagen
    const file = new File(["fake"], "test.jpg", { type: "image/jpeg" })
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    // Postcondition: se cargo la imagen y ImageCanvas aparece
    expect(findCanvas()).not.toBeNull()
  })
})

describe("ImageWarpEditor: cargar desde URL", () => {
  // AT: pegar URL + click en "Cargar URL" carga la imagen en el editor
  it("AT: cargar por URL activa el editor", async () => {
    // Mock de fetch para devolver un blob tipo imagen
    const fakeBlob = new Blob(["fake"], { type: "image/jpeg" })
    const originalFetch = global.fetch
    global.fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => fakeBlob,
    })) as any

    try {
      const { container } = render(<ImageWarpEditor />)
      const findCanvas = () => container.querySelector('[data-testid="image-canvas"]')

      expect(findCanvas()).toBeNull()

      // El input de URL debe existir en el DOM
      const urlInput = container.querySelector('input[type="url"]') as HTMLInputElement
      expect(urlInput).not.toBeNull()

      // Cambiar el valor y disparar el boton "Cargar URL"
      fireEvent.change(urlInput, { target: { value: "https://example.com/pizarra.jpg" } })
      const loadBtn = screen.getByRole("button", { name: /cargar url|load url/i })
      fireEvent.click(loadBtn)

      // Esperar a que el fetch resuelva
      await new Promise((r) => setTimeout(r, 10))

      // Postcondition: la imagen se cargo y ImageCanvas aparece
      expect(findCanvas()).not.toBeNull()
    } finally {
      global.fetch = originalFetch
    }
  })
})
