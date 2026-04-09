export interface CanvasSize {
  width: number
  height: number
}

/** Ratio of padding on each side relative to image dimensions */
export const PADDING_RATIO = 0.25

export interface ImageRect {
  imageWidth: number
  imageHeight: number
}

/**
 * Converts a normalized point (relative to image, can be outside [0,1])
 * to pixel coordinates within the padded canvas.
 */
export function pointToCanvas(
  point: { x: number; y: number },
  imageRect: ImageRect,
  paddingRatio: number = PADDING_RATIO
): { px: number; py: number } {
  const padX = paddingRatio * imageRect.imageWidth
  const padY = paddingRatio * imageRect.imageHeight
  return {
    px: padX + point.x * imageRect.imageWidth,
    py: padY + point.y * imageRect.imageHeight,
  }
}

/**
 * Inverse of pointToCanvas: converts padded-canvas pixel coordinates
 * back to normalized coordinates (relative to image, can be outside [0,1]).
 */
export function canvasToPoint(
  px: number,
  py: number,
  imageRect: ImageRect,
  paddingRatio: number = PADDING_RATIO
): { x: number; y: number } {
  const padX = paddingRatio * imageRect.imageWidth
  const padY = paddingRatio * imageRect.imageHeight
  return {
    x: (px - padX) / imageRect.imageWidth,
    y: (py - padY) / imageRect.imageHeight,
  }
}

/**
 * Returns the total padded canvas size for a given image size.
 */
export function getPaddedCanvasSize(
  imageRect: ImageRect,
  paddingRatio: number = PADDING_RATIO
): CanvasSize {
  return {
    width: imageRect.imageWidth * (1 + 2 * paddingRatio),
    height: imageRect.imageHeight * (1 + 2 * paddingRatio),
  }
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
