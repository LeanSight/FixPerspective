export interface CanvasSize {
  width: number
  height: number
}

/**
 * Converts raw pointer pixel coordinates to normalized coordinates
 * relative to the canvas size. No clamping — values can be outside [0,1].
 */
export function normalizePointerPosition(
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number },
  canvasSize: CanvasSize
): { x: number; y: number } {
  const x = (clientX - canvasRect.left) / canvasSize.width
  const y = (clientY - canvasRect.top) / canvasSize.height
  return { x, y }
}
