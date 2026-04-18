"use client"

import type React from "react"

import { useRef, useEffect, useState } from "react"
import { useImageWarpStore, useLanguageStore } from "@/lib/store"
import { drawPath, drawControlPoints, cropImage, perspectiveTransform } from "@/lib/warp"
import { applyCleanupPipeline } from "@/lib/cleanup"
import { useMobile } from "@/hooks/use-mobile"
import { pointToCanvas, canvasToPoint, getPaddedCanvasSize, findHitPoint, PADDING_RATIO } from "@/lib/canvas-utils"
import { Slider } from "@/components/ui/slider"
import { getTranslation } from "@/lib/translations"

interface ImageCanvasProps {
  imageUrl: string
}

export default function ImageCanvas({ imageUrl }: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const croppedCanvasRef = useRef<HTMLCanvasElement>(null)
  const magnifierCanvasRef = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPointIndex, setDragPointIndex] = useState<number | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState({ imageWidth: 0, imageHeight: 0 })
  const [originalSize, setOriginalSize] = useState({ width: 0, height: 0 })
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit")
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 })
  const [showMagnifier, setShowMagnifier] = useState(false)
  const isMobile = useMobile()

  const magnifierSize = 130; // Size of the magnifier in pixels
  const magnifierZoom = 3; // Zoom level
  
  const { points, updatePoint, heightScale, setHeightScale, cleanupStrength, setCleanupStrength } = useImageWarpStore()
  const { language } = useLanguageStore()
  const t = getTranslation(language)

  // Load image
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setImage(img)
      if (canvasRef.current && previewCanvasRef.current && croppedCanvasRef.current) {
        // Set image size based on viewport constraints
        const maxWidth = isMobile ? window.innerWidth - 32 : Math.min(800, window.innerWidth - 40)
        const scale = maxWidth / img.width
        const imgW = maxWidth
        const imgH = img.height * scale

        setImageSize({ imageWidth: imgW, imageHeight: imgH })
        setOriginalSize({ width: img.width, height: img.height })

        // Padded canvas is larger to allow control points outside image bounds
        const padded = getPaddedCanvasSize({ imageWidth: imgW, imageHeight: imgH })
        setCanvasSize(padded)

        canvasRef.current.width = padded.width
        canvasRef.current.height = padded.height
        // Preview and cropped canvases use original image resolution for quality
        previewCanvasRef.current.width = img.width
        previewCanvasRef.current.height = img.height
        croppedCanvasRef.current.width = img.width
        croppedCanvasRef.current.height = img.height

        if (magnifierCanvasRef.current) {
          magnifierCanvasRef.current.width = magnifierSize;
          magnifierCanvasRef.current.height = magnifierSize;
        }
      }
    }
    img.src = imageUrl
  }, [imageUrl, isMobile])

  // Draw magnifier
  useEffect(() => {
    if (!showMagnifier || !magnifierCanvasRef.current || !canvasRef.current || !image) return;
    
    const magnifierCtx = magnifierCanvasRef.current.getContext('2d');
    if (!magnifierCtx) return;
    
    // Clear the magnifier canvas
    magnifierCtx.clearRect(0, 0, magnifierSize, magnifierSize);
    
    // Calculate the source rectangle in the original canvas
    const sourceX = magnifierPosition.x - (magnifierSize / magnifierZoom / 2);
    const sourceY = magnifierPosition.y - (magnifierSize / magnifierZoom / 2);
    const sourceWidth = magnifierSize / magnifierZoom;
    const sourceHeight = magnifierSize / magnifierZoom;
    
    // Draw the zoomed portion of the main canvas onto the magnifier
    magnifierCtx.drawImage(
      canvasRef.current,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, magnifierSize, magnifierSize
    );
    
    // Draw a border for the magnifier
    magnifierCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    magnifierCtx.lineWidth = 2;
    magnifierCtx.beginPath();
    magnifierCtx.arc(magnifierSize/2, magnifierSize/2, magnifierSize/2 - 1, 0, Math.PI * 2);
    magnifierCtx.stroke();
    
    // If we have a dragging point, draw a precise crosshair at its position
    if (dragPointIndex !== null) {
      const point = points[dragPointIndex];

      // Calculate where the point should be in the magnifier view (using padded coords)
      const { px: ptPx, py: ptPy } = pointToCanvas(point, imageSize);
      const zoomedX = (ptPx - sourceX) * magnifierZoom;
      const zoomedY = (ptPy - sourceY) * magnifierZoom;
      
      // Draw a more precise crosshair
      magnifierCtx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
      magnifierCtx.lineWidth = 1;
      
      // Horizontal line
      magnifierCtx.beginPath();
      magnifierCtx.moveTo(zoomedX - 10, zoomedY);
      magnifierCtx.lineTo(zoomedX + 10, zoomedY);
      magnifierCtx.stroke();
      
      // Vertical line
      magnifierCtx.beginPath();
      magnifierCtx.moveTo(zoomedX, zoomedY - 10);
      magnifierCtx.lineTo(zoomedX, zoomedY + 10);
      magnifierCtx.stroke();
      
      // Small circle at the center point
      magnifierCtx.beginPath();
      magnifierCtx.arc(zoomedX, zoomedY, 3, 0, Math.PI * 2);
      magnifierCtx.stroke();
    } else {
      // Default crosshair at center of magnifier
      magnifierCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      magnifierCtx.lineWidth = 1;
      
      // Horizontal line
      magnifierCtx.beginPath();
      magnifierCtx.moveTo(magnifierSize/2 - 10, magnifierSize/2);
      magnifierCtx.lineTo(magnifierSize/2 + 10, magnifierSize/2);
      magnifierCtx.stroke();
      
      // Vertical line
      magnifierCtx.beginPath();
      magnifierCtx.moveTo(magnifierSize/2, magnifierSize/2 - 10);
      magnifierCtx.lineTo(magnifierSize/2, magnifierSize/2 + 10);
      magnifierCtx.stroke();
    }
  }, [showMagnifier, magnifierPosition, points, dragPointIndex, canvasSize, image, magnifierZoom]);

  // Resize canvas on window resize
  useEffect(() => {
    const handleResize = () => {
      if (!image || !canvasRef.current || !previewCanvasRef.current || !croppedCanvasRef.current) return

      const maxWidth = isMobile ? window.innerWidth - 32 : Math.min(800, window.innerWidth - 40)
      const scale = maxWidth / image.width
      const imgW = maxWidth
      const imgH = image.height * scale

      setImageSize({ imageWidth: imgW, imageHeight: imgH })

      const padded = getPaddedCanvasSize({ imageWidth: imgW, imageHeight: imgH })
      setCanvasSize(padded)

      canvasRef.current.width = padded.width
      canvasRef.current.height = padded.height
      // Preview/cropped keep original resolution (no change on resize)
      previewCanvasRef.current.width = image.width
      previewCanvasRef.current.height = image.height
      croppedCanvasRef.current.width = image.width
      croppedCanvasRef.current.height = image.height
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [image, isMobile])

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current || !image || !previewCanvasRef.current || !croppedCanvasRef.current) return

    const ctx = canvasRef.current.getContext("2d")
    const previewCtx = previewCanvasRef.current.getContext("2d")
    const croppedCtx = croppedCanvasRef.current.getContext("2d")

    if (!ctx || !previewCtx || !croppedCtx) return

    // Clear canvases
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    previewCtx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height)
    croppedCtx.clearRect(0, 0, croppedCanvasRef.current.width, croppedCanvasRef.current.height)

    // Draw padding area background (checkerboard pattern to distinguish from image)
    const padX = PADDING_RATIO * imageSize.imageWidth
    const padY = PADDING_RATIO * imageSize.imageHeight
    ctx.fillStyle = "rgba(128, 128, 128, 0.15)"
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)

    // Draw image on edit canvas with padding offset
    ctx.drawImage(image, padX, padY, imageSize.imageWidth, imageSize.imageHeight)

    // Draw path on edit canvas using padded coordinates
    ctx.strokeStyle = "rgba(59, 130, 246, 0.8)"
    ctx.lineWidth = 2
    ctx.beginPath()
    const startPt = pointToCanvas(points[0], imageSize)
    ctx.moveTo(startPt.px, startPt.py)
    for (let i = 1; i < points.length; i++) {
      const pt = pointToCanvas(points[i], imageSize)
      ctx.lineTo(pt.px, pt.py)
    }
    ctx.closePath()
    ctx.stroke()

    // Draw control points on edit canvas, but skip the currently dragged point
    points.forEach((point, index) => {
      if (isDragging && dragPointIndex === index) return;

      const pointRadius = isMobile ? 12 : 8;
      const fontSize = isMobile ? "12px" : "10px";

      ctx.fillStyle = "rgba(59, 130, 246, 0.7)";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;

      const { px, py } = pointToCanvas(point, imageSize);

      ctx.beginPath();
      ctx.arc(px, py, pointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "white";
      ctx.font = `${fontSize} Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((index + 1).toString(), px, py);
    });

    // Preview/cropped canvases use original image resolution for full quality
    const fullResSize = { width: originalSize.width, height: originalSize.height }

    // Preview canvas is hidden when activeTab === "edit" (className="hidden"),
    // so only paint it when actually visible.
    if (activeTab === "preview") {
      croppedCtx.drawImage(image, 0, 0, fullResSize.width, fullResSize.height)
      cropImage(croppedCtx, image, points, fullResSize)
      previewCtx.clearRect(0, 0, fullResSize.width, fullResSize.height)
      perspectiveTransform(previewCtx, croppedCanvasRef.current, points, fullResSize, heightScale)
      applyCleanupPipeline(previewCtx, cleanupStrength)
    }
  }, [image, points, canvasSize, imageSize, originalSize, activeTab, heightScale, cleanupStrength, isMobile, isDragging, dragPointIndex])

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return

    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Check if we're clicking on a control point
    const hitRadius = isMobile ? 15 : 10
    const hitIndex = findHitPoint(x, y, points, imageSize, hitRadius)
    if (hitIndex !== null) {
      setIsDragging(true)
      setDragPointIndex(hitIndex)
      setShowMagnifier(true)
      setMagnifierPosition({ x, y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return
    
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    if (isDragging && dragPointIndex !== null) {
      // Convert padded-canvas pixel position to normalized image coordinates
      const normalized = canvasToPoint(x, y, imageSize)
      updatePoint(dragPointIndex, normalized)

      setMagnifierPosition({ x, y });
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setDragPointIndex(null)
    setShowMagnifier(false)
  }

  // Touch event handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return
    e.preventDefault() // Prevent scrolling while dragging

    const rect = canvasRef.current.getBoundingClientRect()
    const touch = e.touches[0]
    const x = touch.clientX - rect.left
    const y = touch.clientY - rect.top

    // Check if we're touching a control point
    const hitIndex = findHitPoint(x, y, points, imageSize, 15)
    if (hitIndex !== null) {
      setIsDragging(true)
      setDragPointIndex(hitIndex)
      setShowMagnifier(true)
      setMagnifierPosition({ x, y })
    }
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging || !canvasRef.current || dragPointIndex === null) return
    e.preventDefault() // Prevent scrolling while dragging

    const rect = canvasRef.current.getBoundingClientRect()
    const touch = e.touches[0]
    const x = touch.clientX - rect.left
    const y = touch.clientY - rect.top

    // Convert padded-canvas pixel position to normalized image coordinates
    const normalized = canvasToPoint(x, y, imageSize)
    updatePoint(dragPointIndex, normalized)

    setMagnifierPosition({ x, y });
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    setDragPointIndex(null)
    setShowMagnifier(false)
  }

  // Calculate magnifier position to stay on screen and avoid being under the finger
  const getMagnifierStyle = () => {
    // Canvas center coordinates
    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;
    
    // Initial position - place on opposite quadrant from touch point
    let left, top;
    
    // Determine which quadrant the touch is in and place the magnifier in the opposite quadrant
    if (magnifierPosition.x < centerX) {
      // Touch is on left side, place magnifier on right
      left = canvasSize.width - magnifierSize - 30;
    } else {
      // Touch is on right side, place magnifier on left
      left = 30;
    }
    
    // For vertical positioning, never place below the finger
    // If touch is in top half, place at top; if touch is in bottom half, also place at top
    top = 30; // Default to top
    
    // If the magnifier would be too close to the touch point horizontally,
    // adjust to ensure good visibility
    const touchDistX = Math.abs(left + magnifierSize/2 - magnifierPosition.x);
    if (touchDistX < 100) {
      // If the touch is near left edge, move magnifier to right
      if (magnifierPosition.x < centerX) {
        left = Math.min(canvasSize.width - magnifierSize - 20, magnifierPosition.x + 100);
      } else {
        // If the touch is near right edge, move magnifier to left
        left = Math.max(20, magnifierPosition.x - magnifierSize - 100);
      }
    }
    
    // Ensure magnifier stays on screen
    if (left < 10) left = 10;
    if (left > canvasSize.width - magnifierSize - 10) left = canvasSize.width - magnifierSize - 10;
    if (top < 10) top = 10;
    
    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${magnifierSize}px`,
      height: `${magnifierSize}px`,
      position: 'absolute',
      pointerEvents: 'none',
      borderRadius: '50%',
      boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
      zIndex: 100,
      display: showMagnifier ? 'block' : 'none',
    };
  };

  return (
    <div className="relative border rounded-lg bg-muted/20">
      <div className="relative">
        <div className="tabs flex border-b">
          <button
            className={`tab px-4 py-2 ${activeTab === "edit" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("edit")}
          >
            {t.editTab}
          </button>
          <button
            className={`tab px-4 py-2 ${activeTab === "preview" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("preview")}
          >
            {t.previewCorrectionTab}
          </button>
        </div>
        <div className="relative">
          <canvas
            ref={canvasRef}
            className={`block touch-none ${activeTab === "edit" ? "block" : "hidden"}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              width: canvasSize.width,
              height: canvasSize.height,
            }}
          />
          <canvas
            id="preview-canvas"
            ref={previewCanvasRef}
            className={activeTab === "preview" ? "block" : "hidden"}
            style={{
              width: imageSize.imageWidth,
              height: imageSize.imageHeight,
            }}
          />
          <canvas
            id="cropped-canvas"
            ref={croppedCanvasRef}
            className="hidden"
            style={{
              width: imageSize.imageWidth,
              height: imageSize.imageHeight,
            }}
          />
          <canvas
            ref={magnifierCanvasRef}
            style={getMagnifierStyle() as React.CSSProperties}
          />
        </div>
        {activeTab === "preview" && (
          <div className="p-3 border-t bg-card space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">{t.verticalAdjust}</label>
                <span className="text-xs text-muted-foreground tabular-nums">{heightScale.toFixed(2)}x</span>
              </div>
              <Slider
                value={[heightScale]}
                min={0.5}
                max={3.0}
                step={0.05}
                onValueChange={(value) => setHeightScale(value[0])}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">{t.backgroundCleanup}</label>
                <span className="text-xs text-muted-foreground tabular-nums">{Math.round(cleanupStrength * 100)}%</span>
              </div>
              <Slider
                value={[cleanupStrength]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(value) => setCleanupStrength(value[0])}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
