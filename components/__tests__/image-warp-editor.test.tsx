import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
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
