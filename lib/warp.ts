"use client"

import type { Point } from "./store"
import { applyCleanupPipeline } from "./cleanup"

/**
 * Clamps (width, height) to the canvas.
 *
 * - If neither axis overflows: returns unchanged.
 * - If only ONE axis overflows: clips that axis to the canvas limit, leaves
 *   the other axis untouched. Preserves the caller's per-axis intent (e.g.
 *   heightScale stretching height without shrinking width).
 * - If BOTH axes overflow: falls back to proportional scaling to preserve
 *   aspect ratio while fitting inside the canvas (needed for OOB source
 *   points that produce a drastically oversized rect).
 *
 * The single-axis clipping case replaces the older "always proportional"
 * behavior, which silently converted a pure-height stretch into a width
 * shrink whenever the stretched height exceeded canvas.height.
 */
export function fitRectToCanvas(
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number
): { width: number; height: number } {
  const widthOverflows = width > canvasWidth
  const heightOverflows = height > canvasHeight

  if (!widthOverflows && !heightOverflows) {
    return { width, height }
  }
  if (widthOverflows && !heightOverflows) {
    return { width: canvasWidth, height }
  }
  if (!widthOverflows && heightOverflows) {
    return { width, height: canvasHeight }
  }
  const scale = Math.min(canvasWidth / width, canvasHeight / height)
  return { width: width * scale, height: height * scale }
}

/**
 * Computes the output rectangle dimensions from 4 sorted corner points
 * using max Euclidean distances between opposite edges (PyImageSearch method).
 * Corners must be ordered: [topLeft, topRight, bottomRight, bottomLeft].
 */
export function computeOutputSize(
  corners: { x: number; y: number }[]
): { width: number; height: number } {
  const [tl, tr, br, bl] = corners
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)

  const widthTop = dist(tl, tr)
  const widthBottom = dist(bl, br)
  const heightLeft = dist(tl, bl)
  const heightRight = dist(tr, br)

  return {
    width: Math.max(widthTop, widthBottom),
    height: Math.max(heightLeft, heightRight),
  }
}

/**
 * Intersection of line through p1-p2 with line through p3-p4.
 * Returns null if lines are parallel.
 */
export function lineIntersect(
  p1: { x: number; y: number }, p2: { x: number; y: number },
  p3: { x: number; y: number }, p4: { x: number; y: number }
): { x: number; y: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y
  const cross = d1x * d2y - d1y * d2x
  if (Math.abs(cross) < 1e-10) return null
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross
  return { x: p1.x + t * d1x, y: p1.y + t * d1y }
}

/**
 * Computes the output rectangle dimensions using 3D reconstruction via
 * vanishing points and estimated focal length. Falls back to Euclidean
 * method if vanishing points are degenerate.
 *
 * Corners: [TL, TR, BR, BL] in pixel coordinates.
 * imageWidth/imageHeight: dimensions of the source image (for principal point).
 */
export function computeRealOutputSize(
  corners: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number,
  heightScale = 1.0
): { width: number; height: number } {
  const [tl, tr, br, bl] = corners
  const dist2d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)

  // Vanishing point of vertical edges (left/right sides converge here)
  const vv = lineIntersect(tl, bl, tr, br)

  if (!vv) {
    const fallback = computeOutputSize(corners)
    return { width: fallback.width, height: fallback.height * heightScale }
  }

  // Euclidean edge lengths
  const eucWidthTop = dist2d(tl, tr)
  const eucWidthBot = dist2d(bl, br)
  const eucHeightLeft = dist2d(tl, bl)
  const eucHeightRight = dist2d(tr, br)
  const eucWidth = Math.max(eucWidthTop, eucWidthBot)
  const eucHeight = Math.max(eucHeightLeft, eucHeightRight)

  // For edges on lines converging to VP, depth is inversely proportional to
  // distance to VP. The top and bottom edges are at different depths.
  // Opposite edges of a rectangle have equal real-world length, so:
  //   realWidth = eucWidthTop * depthTop / f = eucWidthBot * depthBot / f
  // where depthTop ∝ 1/dist(midTop, vv) and depthBot ∝ 1/dist(midBot, vv)
  //
  // We can estimate the "average depth" at each edge using midpoints' distance to vv.
  const midTop = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 }
  const midBot = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 }
  const midLeft = { x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 }
  const midRight = { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 }

  const dMidTopVV = dist2d(midTop, vv)
  const dMidBotVV = dist2d(midBot, vv)

  // Depth ratio: top is further from camera (closer to VP) so dMidTopVV < dMidBotVV
  // depthTop/depthBot = dMidBotVV/dMidTopVV
  // Real width (from top edge): eucWidthTop * depthTop = eucWidthTop * (dMidBotVV/dMidTopVV) * k
  // Real width (from bot edge): eucWidthBot * depthBot = eucWidthBot * k
  // These should be equal (opposite sides): average for robustness
  const realWidthFromTop = eucWidthTop * (dMidBotVV / dMidTopVV)
  const realWidthFromBot = eucWidthBot
  const realWidth = (realWidthFromTop + realWidthFromBot) / 2

  // For height: the height edges go from near (bottom) to far (top).
  // The real height is larger than the Euclidean height because the edge is foreshortened.
  // For an edge from A to B converging to VP, the real length is:
  //   realLen = integral of ds, where each infinitesimal piece ds at depth z has
  //   image length ds_img = f * ds / z
  //
  // For a straight line from A to B going toward VP:
  //   The depth at A: zA ∝ 1/dist(A, VP), at B: zB ∝ 1/dist(B, VP)
  //   Real height ∝ eucHeight * log(zA/zB) / (1/zB - 1/zA) ... actually this is complex.
  //
  // Simpler approximation: real height / euc height ≈ geometric mean of depth at endpoints
  // divided by depth at midpoint ≈ correction based on VP distance ratio.
  //
  // For left edge: endpoints TL (far, dist dTL_vv) and BL (near, dist dBL_vv)
  // The real height is proportional to: eucHeight * sqrt(dBL/dTL) approximately
  // (geometric mean correction for depth change along the edge)
  const dTL_vv = dist2d(tl, vv)
  const dBL_vv = dist2d(bl, vv)
  const dTR_vv = dist2d(tr, vv)
  const dBR_vv = dist2d(br, vv)

  // Correction factor: ratio of depths at endpoints
  // A segment going from depth Z1 to Z2 has its image compressed by the average depth factor.
  // Real length ≈ image_length * (Z_near + Z_far) / (2 * Z_midpoint)
  // Since Z ∝ 1/dist_to_VP:
  // ≈ image_length * (1/dA + 1/dB) / (2 / ((dA+dB)/2))
  // = image_length * (dA + dB)/(2*dA*dB) * (dA+dB)/2 ... doesn't simplify well.
  //
  // Practical approximation using the log-mean:
  // For a segment where depth changes linearly from Z1 to Z2:
  // real_length / image_length ≈ (Z2-Z1) / (ln(Z2/Z1) * Z_ref) ... still complex.
  //
  // Simplest effective approach: use the ratio of VP distances to correct height.
  // The foreshortening factor for an edge from A to B toward VP is approximately:
  //   correction = ln(dA/dB) / (1/dB - 1/dA) * dMid (for dA > dB, i.e. A is nearer)
  //
  // Even simpler: depth at midpoint of height edge vs depth at midpoint of width edge.
  // The width edge at the bottom is at depth ∝ 1/dMidBotVV
  // The height edge midpoint is at ∝ 1/dMidLeftVV
  // If the height edge were at the same depth as the width edge, its real length would
  // be eucHeight. But it's at a different "average" depth that's a mix of near and far.
  //
  // Most practical: the real aspect ratio is:
  // W/H = realWidth / realHeight
  // where realHeight = eucHeight * correctionFactor
  // correctionFactor = average(dBL_vv, dBR_vv) / average(dMidLeft_vv, dMidRight_vv)
  // (ratio of "bottom depth" to "average height depth")
  //
  // Actually let me use a cleaner approach. Since opposite width edges have the same
  // real length, the ratio eucWidthTop/eucWidthBot = depthBot/depthTop = dMidTopVV/dMidBotVV.
  // This gives us the depth ratio between top and bottom.
  //
  // The real height can be estimated as:
  // For left edge going from BL (near) to TL (far):
  //   Average depth along the edge = geometric mean of endpoints' depths
  //   = sqrt(depthBL * depthTL)
  //   = sqrt((1/dBL_vv) * (1/dTL_vv)) * k
  //   = k / sqrt(dBL_vv * dTL_vv)
  //
  //   Real height = eucHeightLeft * avg_depth / f_ref
  //
  // For the width, the bottom edge is entirely at depth = k/dMidBotVV:
  //   Real width = eucWidthBot * depthBot / f_ref = eucWidthBot * k / dMidBotVV / f_ref
  //
  // Aspect ratio W/H:
  //   = (eucWidthBot / dMidBotVV) / (eucHeightLeft / sqrt(dBL_vv * dTL_vv))
  //   = (eucWidthBot * sqrt(dBL_vv * dTL_vv)) / (eucHeightLeft * dMidBotVV)

  const corrHeightLeft = eucHeightLeft * dMidBotVV / Math.sqrt(dBL_vv * dTL_vv)
  const corrHeightRight = eucHeightRight * dMidBotVV / Math.sqrt(dBR_vv * dTR_vv)
  const realHeight = Math.max(corrHeightLeft, corrHeightRight)

  if (realHeight <= 0) {
    const fallback = computeOutputSize(corners)
    return { width: fallback.width, height: fallback.height * heightScale }
  }

  return {
    width: eucWidth,
    height: realHeight * heightScale,
  }
}

// Draw the straight path connecting the control points
export function drawPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  canvasSize: { width: number; height: number },
) {
  if (points.length < 2) return

  ctx.strokeStyle = "rgba(59, 130, 246, 0.7)"
  ctx.lineWidth = 2
  ctx.beginPath()

  // Start at the first point
  const startPoint = points[0]
  ctx.moveTo(startPoint.x * canvasSize.width, startPoint.y * canvasSize.height)

  // Draw lines between each pair of points
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    ctx.lineTo(point.x * canvasSize.width, point.y * canvasSize.height)
  }

  // Close the path
  ctx.lineTo(startPoint.x * canvasSize.width, startPoint.y * canvasSize.height)
  ctx.stroke()
}

// Draw the control points
export function drawControlPoints(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  canvasSize: { width: number; height: number },
  isMobile = false,
) {
  const pointRadius = isMobile ? 12 : 8
  const fontSize = isMobile ? "12px" : "10px"

  points.forEach((point, index) => {
    // Draw the main control point
    ctx.fillStyle = "rgba(59, 130, 246, 0.7)"
    ctx.strokeStyle = "white"
    ctx.lineWidth = 2

    const x = point.x * canvasSize.width
    const y = point.y * canvasSize.height

    ctx.beginPath()
    ctx.arc(x, y, pointRadius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Draw point index
    ctx.fillStyle = "white"
    ctx.font = `${fontSize} Arial`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText((index + 1).toString(), x, y)
  })
}

// Crop the image to the shape defined by the control points
export function cropImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  points: Point[],
  canvasSize: { width: number; height: number },
) {
  // Clear the canvas
  ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)

  // Convert normalized points to canvas coordinates
  const sourcePoints = points.map((point) => ({
    x: point.x * canvasSize.width,
    y: point.y * canvasSize.height,
  }))

  // Draw the original image
  ctx.save()

  // Create a clipping path using straight lines
  ctx.beginPath()
  ctx.moveTo(sourcePoints[0].x, sourcePoints[0].y)

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(sourcePoints[i].x, sourcePoints[i].y)
  }

  ctx.closePath()
  ctx.clip()

  // Draw the image
  ctx.drawImage(image, 0, 0, canvasSize.width, canvasSize.height)

  ctx.restore()
}

// Compute the coefficients for a perspective transform (homography matrix)
function computeHomography(srcPoints: { x: number; y: number }[], dstPoints: { x: number; y: number }[]): number[] {
  // Create the coefficient matrix for the system of equations
  const A: number[][] = []
  const b: number[] = []

  // For each point correspondence, add two rows to the matrix
  for (let i = 0; i < 4; i++) {
    const src = srcPoints[i]
    const dst = dstPoints[i]

    // First row for x coordinate
    A.push([src.x, src.y, 1, 0, 0, 0, -dst.x * src.x, -dst.x * src.y])
    b.push(dst.x)

    // Second row for y coordinate
    A.push([0, 0, 0, src.x, src.y, 1, -dst.y * src.x, -dst.y * src.y])
    b.push(dst.y)
  }

  // Solve the system of equations using Gaussian elimination
  const n = A.length
  const augmentedMatrix = A.map((row, i) => [...row, b[i]])

  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i
    let maxVal = Math.abs(augmentedMatrix[i][i])

    for (let j = i + 1; j < n; j++) {
      const absVal = Math.abs(augmentedMatrix[j][i])
      if (absVal > maxVal) {
        maxVal = absVal
        maxRow = j
      }
    }

    // Swap rows
    if (maxRow !== i) {
      ;[augmentedMatrix[i], augmentedMatrix[maxRow]] = [augmentedMatrix[maxRow], augmentedMatrix[i]]
    }

    // Eliminate
    for (let j = i + 1; j < n; j++) {
      const factor = augmentedMatrix[j][i] / augmentedMatrix[i][i]

      for (let k = i; k <= n; k++) {
        augmentedMatrix[j][k] -= factor * augmentedMatrix[i][k]
      }
    }
  }

  // Back substitution
  const solution = new Array(n).fill(0)

  for (let i = n - 1; i >= 0; i--) {
    let sum = 0
    for (let j = i + 1; j < n; j++) {
      sum += augmentedMatrix[i][j] * solution[j]
    }
    solution[i] = (augmentedMatrix[i][n] - sum) / augmentedMatrix[i][i]
  }

  // Return the homography matrix coefficients (h1 to h8, h9=1)
  return [...solution, 1]
}

// Apply perspective transform to warp the image
export function perspectiveTransform(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  points: Point[],
  canvasSize: { width: number; height: number },
  heightScale = 1.0,
) {
  // Clear the destination canvas
  ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)

  // Convert normalized points to canvas coordinates
  const quadPoints = points.map((point) => ({
    x: point.x * canvasSize.width,
    y: point.y * canvasSize.height,
  }))

  // Sort corners and compute output size using VP-corrected dimensions
  const sortedQuad = identifyCorners(quadPoints)
  const realSize = computeRealOutputSize(sortedQuad, canvasSize.width, canvasSize.height, heightScale)
  // Fit within the preview canvas (OOB source points or large heightScale can produce rect > canvas).
  const { width: rectWidth, height: rectHeight } = fitRectToCanvas(
    realSize.width, realSize.height, canvasSize.width, canvasSize.height
  )

  // Anchor the destination rectangle at (0, 0) so OOB source points never clip the output.
  const minX = 0
  const minY = 0
  const maxX = Math.ceil(rectWidth)
  const maxY = Math.ceil(rectHeight)

  // Define the target rectangle corners (destination points)
  const rectPoints = [
    { x: 0, y: 0 },
    { x: rectWidth, y: 0 },
    { x: rectWidth, y: rectHeight },
    { x: 0, y: rectHeight }
  ]
  
  // We'll use the built-in canvas transformation for better results
  // Create a temporary canvas for the warped image
  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = canvasSize.width
  tempCanvas.height = canvasSize.height
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })
  
  if (!tempCtx) return

  // First, draw the source image to the temp canvas
  tempCtx.drawImage(sourceCanvas, 0, 0)
  
  // Get the source image data
  const imageData = tempCtx.getImageData(0, 0, canvasSize.width, canvasSize.height)
  
  // Create a destination image data
  const destData = ctx.createImageData(canvasSize.width, canvasSize.height)
  
  // Calculate transformation matrix from destination rectangle to source quadrilateral
  const matrix = perspectiveProjectionMatrix(rectPoints, quadPoints)
  
  // Map each pixel from destination to source
  // Clamp loop bounds to valid canvas pixels (OOB points may produce negative minX/minY)
  const startY = Math.max(0, minY)
  const endY = Math.min(maxY, canvasSize.height)
  const startX = Math.max(0, minX)
  const endX = Math.min(maxX, canvasSize.width)
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      
      // Calculate source coordinates using the perspective matrix
      const { srcX, srcY } = applyPerspectiveTransform(x, y, matrix)
      
      // Skip if source coordinates are outside the valid range
      if (srcX < 0 || srcY < 0 || srcX >= canvasSize.width || srcY >= canvasSize.height) continue
      
      // Get the pixel index in the destination
      const destIndex = (y * canvasSize.width + x) * 4
      
      // Get the source pixel value with bilinear interpolation
      const srcX1 = Math.floor(srcX)
      const srcY1 = Math.floor(srcY)
      const srcX2 = Math.min(srcX1 + 1, canvasSize.width - 1)
      const srcY2 = Math.min(srcY1 + 1, canvasSize.height - 1)
      
      const xWeight = srcX - srcX1
      const yWeight = srcY - srcY1
      
      // For each color channel (RGBA)
        for (let c = 0; c < 4; c++) {
        const i11 = ((srcY1 * canvasSize.width) + srcX1) * 4 + c
        const i12 = ((srcY1 * canvasSize.width) + srcX2) * 4 + c
        const i21 = ((srcY2 * canvasSize.width) + srcX1) * 4 + c
        const i22 = ((srcY2 * canvasSize.width) + srcX2) * 4 + c
        
        // Bilinear interpolation
        const top = imageData.data[i11] * (1 - xWeight) + imageData.data[i12] * xWeight
        const bottom = imageData.data[i21] * (1 - xWeight) + imageData.data[i22] * xWeight
        const val = Math.round(top * (1 - yWeight) + bottom * yWeight)
        
        destData.data[destIndex + c] = val
      }
    }
  }
  
  // Put the transformed image data to the destination context
  ctx.putImageData(destData, 0, 0)
}

// Calculate the perspective projection matrix
function perspectiveProjectionMatrix(
  srcPoints: { x: number; y: number }[],
  dstPoints: { x: number; y: number }[]
) {
  // Compute the coefficients of the perspective transformation
  const a = computePerspectiveCoefficients(srcPoints, dstPoints)
  
  return {
    a11: a[0], a12: a[1], a13: a[2],
    a21: a[3], a22: a[4], a23: a[5],
    a31: a[6], a32: a[7], a33: 1
  }
}

// Apply the perspective transform to a point
function applyPerspectiveTransform(
  x: number, 
  y: number, 
  matrix: { 
    a11: number, a12: number, a13: number, 
    a21: number, a22: number, a23: number, 
    a31: number, a32: number, a33: number 
  }
) {
  const { a11, a12, a13, a21, a22, a23, a31, a32, a33 } = matrix
  
  // Calculate the denominator
  const denominator = a31 * x + a32 * y + a33
  
  if (Math.abs(denominator) < 0.0001) {
    return { srcX: -1, srcY: -1 } // Invalid coordinates
  }
  
  // Calculate source coordinates
  const srcX = (a11 * x + a12 * y + a13) / denominator
  const srcY = (a21 * x + a22 * y + a23) / denominator
  
  return { srcX, srcY }
}

// Compute perspective transformation coefficients
function computePerspectiveCoefficients(
  srcPoints: { x: number; y: number }[],
  dstPoints: { x: number; y: number }[]
): number[] {
  // Ensure we have exactly 4 points
  if (srcPoints.length !== 4 || dstPoints.length !== 4) {
    throw new Error('Perspective transform requires exactly 4 points')
  }
  
  // Set up the system of linear equations
  const A: number[][] = []
  const b: number[] = []
  
  // For each point correspondence
  for (let i = 0; i < 4; i++) {
    const src = srcPoints[i]
    const dst = dstPoints[i]
    
    // First row for x coordinate
    A.push([src.x, src.y, 1, 0, 0, 0, -dst.x * src.x, -dst.x * src.y])
    b.push(dst.x)
    
    // Second row for y coordinate
    A.push([0, 0, 0, src.x, src.y, 1, -dst.y * src.x, -dst.y * src.y])
    b.push(dst.y)
  }
  
  // Solve the system using Gaussian elimination
  return solveLinearSystem(A, b)
}

// Solve a system of linear equations using Gaussian elimination
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
  const augmentedMatrix = A.map((row, i) => [...row, b[i]])
  
  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find row with maximum absolute value in current column
    let maxRow = i
    let maxVal = Math.abs(augmentedMatrix[i][i])
    
    for (let j = i + 1; j < n; j++) {
      const absVal = Math.abs(augmentedMatrix[j][i])
      if (absVal > maxVal) {
        maxVal = absVal
        maxRow = j
      }
    }
    
    // Swap rows if needed
    if (maxRow !== i) {
      [augmentedMatrix[i], augmentedMatrix[maxRow]] = [augmentedMatrix[maxRow], augmentedMatrix[i]]
    }
    
    // Eliminate other rows
    for (let j = i + 1; j < n; j++) {
      const factor = augmentedMatrix[j][i] / augmentedMatrix[i][i]
      
      for (let k = i; k <= n; k++) {
        augmentedMatrix[j][k] -= factor * augmentedMatrix[i][k]
      }
    }
  }
  
  // Back substitution
  const solution = new Array(n).fill(0)
  
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0
    for (let j = i + 1; j < n; j++) {
      sum += augmentedMatrix[i][j] * solution[j]
    }
    solution[i] = (augmentedMatrix[i][n] - sum) / augmentedMatrix[i][i]
  }
  
  // Return the homography matrix coefficients (h1 to h8, h9=1)
  return [...solution, 1]
}

// Export the warped image to a rectangular output with preserved quality
export function exportWarpedImage(canvas: HTMLCanvasElement, points: Point[], quality = 0.9, heightScale = 1.0, cleanupStrength = 0): string {
  console.log("Starting export with canvas dimensions:", canvas.width, "x", canvas.height)

  // Convert normalized points to canvas coordinates
  const sourcePoints = points.map((point) => ({
    x: point.x * canvas.width,
    y: point.y * canvas.height,
  }))

  // Sort corners and compute output size using VP-corrected dimensions
  const sortedCorners = identifyCorners(sourcePoints)
  const outputSize = computeRealOutputSize(sortedCorners, canvas.width, canvas.height, heightScale)
  const width = Math.round(outputSize.width)
  const height = Math.round(outputSize.height)
  
  console.log("Output dimensions:", width, "x", height)

  // Safety check for dimensions
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
    console.error("Invalid export dimensions:", width, "x", height)
    return ""
  }

  try {
    // Create the output canvas with the calculated dimensions
  const outputCanvas = document.createElement("canvas")
  outputCanvas.width = width
  outputCanvas.height = height
    const outputCtx = outputCanvas.getContext("2d", {
      willReadFrequently: true,
      alpha: true
    })
    
    if (!outputCtx) {
      console.error("Failed to create output context")
      return ""
    }

    // For perspective transform (warped images)
    if (sourcePoints.length === 4) {
      console.log("Applying perspective transform to high-resolution image")
      
      // First create a temporary canvas with the full source image
      const tempCanvas = document.createElement("canvas")
      tempCanvas.width = canvas.width
      tempCanvas.height = canvas.height
      const tempCtx = tempCanvas.getContext("2d")
      if (!tempCtx) {
        console.error("Failed to create temporary context")
        return ""
      }
      
      // Draw the source image to the temporary canvas
      tempCtx.drawImage(canvas, 0, 0)
      
      // Create target points for the output - these are relative to the final output canvas
      // Make sure these are in the same order as the source points (typically clockwise from top-left)
      const destPoints = [
        { x: 0, y: 0 },               // Top-left
        { x: width, y: 0 },           // Top-right
        { x: width, y: height },      // Bottom-right
        { x: 0, y: height }           // Bottom-left
      ]

      // Sort source points to ensure correct correspondence with destination points
      // This is critical to get the correct perspective transform
      const sortedSourcePoints = identifyCorners(sourcePoints)
      
      console.log("Source points (sorted):", sortedSourcePoints)
      console.log("Destination points:", destPoints)
      
      // Calculate the perspective transform matrix
      // We need to transform from the selected quadrilateral (sourcePoints) to rectangle (destPoints)
      const transformMatrix = perspectiveProjectionMatrix(destPoints, sortedSourcePoints)
      
      // Process the image using the fallback pixel-processing method
      // This is more reliable for perspective correction
      console.log("Using direct pixel processing method")
      
      // Use the exact perspective transform but process in small tiles to save memory
      const tileSize = 256 // Process in chunks to avoid memory issues
      const sourceData = tempCtx.getImageData(0, 0, canvas.width, canvas.height)
      
      // Process image in tiles to reduce memory pressure
      for (let tileY = 0; tileY < height; tileY += tileSize) {
        const tileHeight = Math.min(tileSize, height - tileY)
        
        for (let tileX = 0; tileX < width; tileX += tileSize) {
          const tileWidth = Math.min(tileSize, width - tileX)
          
          // Create a tile buffer
          const tileData = outputCtx.createImageData(tileWidth, tileHeight)
          
          // Process pixels in this tile
          for (let y = 0; y < tileHeight; y++) {
            for (let x = 0; x < tileWidth; x++) {
              // Get source coordinates (the position in the original image)
              const globalX = x + tileX  // Position in the output image
              const globalY = y + tileY
              
              // Map the output position back to the source image
              const { srcX, srcY } = applyPerspectiveTransform(globalX, globalY, transformMatrix)
              
              // Skip if outside source bounds
              if (srcX < 0 || srcX >= canvas.width || srcY < 0 || srcY >= canvas.height) continue
              
              // Perform bilinear interpolation to get the color
              const srcX1 = Math.floor(srcX)
              const srcY1 = Math.floor(srcY)
              const srcX2 = Math.min(srcX1 + 1, canvas.width - 1)
              const srcY2 = Math.min(srcY1 + 1, canvas.height - 1)
              
              const xWeight = srcX - srcX1
              const yWeight = srcY - srcY1
              
              // Output pixel index in tile
              const destIdx = (y * tileWidth + x) * 4
              
              // For each color channel (RGBA)
              for (let c = 0; c < 4; c++) {
                // Source pixel indices
                const i11 = (srcY1 * canvas.width + srcX1) * 4 + c
                const i12 = (srcY1 * canvas.width + srcX2) * 4 + c
                const i21 = (srcY2 * canvas.width + srcX1) * 4 + c
                const i22 = (srcY2 * canvas.width + srcX2) * 4 + c
                
                // Interpolate the color value
                const top = sourceData.data[i11] * (1 - xWeight) + sourceData.data[i12] * xWeight
                const bottom = sourceData.data[i21] * (1 - xWeight) + sourceData.data[i22] * xWeight
                tileData.data[destIdx + c] = Math.round(top * (1 - yWeight) + bottom * yWeight)
              }
            }
          }
          
          // Put the tile data into the output canvas
          outputCtx.putImageData(tileData, tileX, tileY)
        }
      }
    } else {
      // Simple crop for non-warped images
      console.log("Applying simple crop from region:", minX, minY, width, height)
      
      // Draw only the selected region to the output canvas
      outputCtx.drawImage(
    canvas,
        minX, minY, width, height,  // Source region
        0, 0, width, height         // Destination region (covers the entire output canvas)
      )
    }

    // Apply background cleanup (flat-field + white-point + saturation) if requested.
    if (cleanupStrength > 0) {
      applyCleanupPipeline(outputCtx, cleanupStrength)
    }

    // Convert to data URL with the requested quality
    console.log("Generating data URL with quality:", quality)
    const format = quality >= 0.95 ? "image/png" : "image/jpeg"
    return outputCanvas.toDataURL(format, quality)
  } catch (error) {
    console.error("Error exporting image:", error)
    return ""
  }
}

// Helper function to identify the corners of a quadrilateral
export function identifyCorners(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length !== 4) {
    return points;
  }
  
  // Find min and max x, y values
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  
  // Identify each corner by its distance to the extreme corners of the bounding box
  const topLeft = points.reduce((closest, point) => {
    const closestDist = Math.hypot(closest.x - minX, closest.y - minY);
    const pointDist = Math.hypot(point.x - minX, point.y - minY);
    return pointDist < closestDist ? point : closest;
  }, points[0]);
  
  const topRight = points.reduce((closest, point) => {
    const closestDist = Math.hypot(closest.x - maxX, closest.y - minY);
    const pointDist = Math.hypot(point.x - maxX, point.y - minY);
    return pointDist < closestDist ? point : closest;
  }, points[0]);
  
  const bottomRight = points.reduce((closest, point) => {
    const closestDist = Math.hypot(closest.x - maxX, closest.y - maxY);
    const pointDist = Math.hypot(point.x - maxX, point.y - maxY);
    return pointDist < closestDist ? point : closest;
  }, points[0]);
  
  const bottomLeft = points.reduce((closest, point) => {
    const closestDist = Math.hypot(closest.x - minX, closest.y - maxY);
    const pointDist = Math.hypot(point.x - minX, point.y - maxY);
    return pointDist < closestDist ? point : closest;
  }, points[0]);
  
  return [topLeft, topRight, bottomRight, bottomLeft];
}

// This sorting method is less reliable for perspective correction, so we use identifyCorners instead
function sortQuadrilateralPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length !== 4) {
    return points;
  }
  
  // Find center point
  const center = {
    x: points.reduce((sum, p) => sum + p.x, 0) / 4,
    y: points.reduce((sum, p) => sum + p.y, 0) / 4
  };
  
  // Sort points clockwise from top-left
  return [...points].sort((a, b) => {
    // Calculate angles from center
    const angleA = Math.atan2(a.y - center.y, a.x - center.x);
    const angleB = Math.atan2(b.y - center.y, b.x - center.x);
    return angleA - angleB;
  });
}

// Helper function to compute the perspective transform matrix
function computePerspectiveMatrix(
  srcPoints: { x: number; y: number }[],
  dstPoints: { x: number; y: number }[]
): number[] {
  // Compute the coefficients of a perspective transformation
  // that maps a quadrilateral to another quadrilateral
  
  const srcX = srcPoints.map(p => p.x)
  const srcY = srcPoints.map(p => p.y)
  const dstX = dstPoints.map(p => p.x)
  const dstY = dstPoints.map(p => p.y)
  
  // Create matrices for solving the perspective transform
  // We're solving for 8 unknown coefficients
  const A = []
  const b = []
  
  // Setup matrix A and vector b
  for (let i = 0; i < 4; i++) {
    // First row for x
    A.push([
      srcX[i], srcY[i], 1, 0, 0, 0, 
      -srcX[i] * dstX[i], -srcY[i] * dstX[i]
    ])
    b.push(dstX[i])
    
    // Second row for y
    A.push([
      0, 0, 0, srcX[i], srcY[i], 1, 
      -srcX[i] * dstY[i], -srcY[i] * dstY[i]
    ])
    b.push(dstY[i])
  }
  
  // Solve for the coefficients
  try {
    const h = solveLinearSystem(A, b)
    return [...h, 1] // Add h8 = 1 to complete the matrix
  } catch (e) {
    console.error("Failed to compute perspective matrix:", e)
    // Return identity matrix as fallback
    return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  }
}

// Perform bilinear interpolation to get a smoother result
function bilinearInterpolation(
  data: Uint8ClampedArray, 
  x: number, 
  y: number, 
  width: number
): [number, number, number, number] {
  // Get the four surrounding pixels
  const x1 = Math.floor(x)
  const y1 = Math.floor(y)
  const x2 = Math.min(x1 + 1, width - 1)
  const y2 = Math.min(y1 + 1, width - 1)
  
  // Calculate interpolation weights
  const wx = x - x1
  const wy = y - y1
  
  // Get pixel indices
  const i11 = (y1 * width + x1) * 4
  const i12 = (y1 * width + x2) * 4
  const i21 = (y2 * width + x1) * 4
  const i22 = (y2 * width + x2) * 4
  
  // Interpolate each color channel
  const result: [number, number, number, number] = [0, 0, 0, 0]
  
  for (let i = 0; i < 4; i++) {
    const top = data[i11 + i] * (1 - wx) + data[i12 + i] * wx
    const bottom = data[i21 + i] * (1 - wx) + data[i22 + i] * wx
    result[i] = Math.round(top * (1 - wy) + bottom * wy)
  }
  
  return result
}
