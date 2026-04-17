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

describe("ImageWarpEditor: cambiar imagen vuelve a la UI inicial", () => {
  // AT: al clickear "Cambiar Imagen" el editor vuelve al estado de upload
  it("AT: click en 'Cambiar Imagen' regresa a la UI de upload", () => {
    const { container } = render(<ImageWarpEditor />)
    const findCanvas = () => container.querySelector('[data-testid="image-canvas"]')
    const findUrlInput = () => container.querySelector('input[type="url"]')

    // Cargar una imagen por drop para llegar al estado de edicion
    const dropzone = container.querySelector(".border-dashed") as HTMLElement
    const file = new File(["fake"], "test.jpg", { type: "image/jpeg" })
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(findCanvas()).not.toBeNull()
    expect(findUrlInput()).toBeNull() // La UI de upload no se muestra mientras hay imagen

    // Click en "Cambiar Imagen" (scoped al container del render actual)
    const buttons = Array.from(container.querySelectorAll("button"))
    const changeBtn = buttons.find((b) =>
      /cambiar imagen|change image/i.test(b.textContent || "")
    ) as HTMLButtonElement
    expect(changeBtn).toBeDefined()
    fireEvent.click(changeBtn)

    // Postcondition: volvimos a la UI de upload
    expect(findCanvas()).toBeNull()
    expect(findUrlInput()).not.toBeNull()
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

      // Cambiar el valor y disparar el boton "Cargar URL" (scoped al container actual)
      fireEvent.change(urlInput, { target: { value: "https://example.com/pizarra.jpg" } })
      const buttons = Array.from(container.querySelectorAll("button"))
      const loadBtn = buttons.find((b) =>
        /cargar url|load url/i.test(b.textContent || "")
      ) as HTMLButtonElement
      expect(loadBtn).toBeDefined()
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
