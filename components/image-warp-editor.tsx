"use client"

import type React from "react"

import { useRef, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Upload, Loader2 } from "lucide-react"
import ImageCanvas from "./image-canvas"
import ControlPanel from "./control-panel"
import { useImageWarpStore, useLanguageStore } from "@/lib/store"
import { useMobile } from "@/hooks/use-mobile"
import { getTranslation } from "@/lib/translations"

export default function ImageWarpEditor() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>("image")
  const [isDragOver, setIsDragOver] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [urlError, setUrlError] = useState<string | null>(null)
  const [isLoadingUrl, setIsLoadingUrl] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { resetPoints } = useImageWarpStore()
  const { language } = useLanguageStore()
  const isMobile = useMobile()
  
  // Get translations
  const t = getTranslation(language)

  const processFile = (file: File) => {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl)
    }

    const url = URL.createObjectURL(file)
    setImageUrl(url)

    setFileName(file.name || "image")

    resetPoints()

    // Reset the file input value to ensure change event fires even if the same file is selected
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0])
    }
  }

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const clearImage = () => {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl)
    }
    setImageUrl(null)
    setFileName("image")
    setUrlInput("")
    setUrlError(null)
    resetPoints()
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith("image/")) {
      processFile(file)
    }
  }

  const needsServerProxy = (url: string): boolean => {
    try {
      const host = new URL(url).host
      return (
        host === "photos.app.goo.gl" ||
        host === "photos.google.com" ||
        host === "goo.gl" ||
        host === "drive.google.com" ||
        host === "lh3.googleusercontent.com"
      )
    } catch {
      return false
    }
  }

  const loadFromUrl = async (url: string) => {
    setUrlError(null)
    setIsLoadingUrl(true)
    try {
      // Google Photos / Drive image URLs omit Access-Control-Allow-Origin,
      // so a browser fetch is blocked. Same-origin proxy bypasses that.
      const fetchUrl = needsServerProxy(url)
        ? `/api/resolve-photo?url=${encodeURIComponent(url)}`
        : url
      const response = await fetch(fetchUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      if (!blob.type.startsWith("image/")) throw new Error("not an image")
      const derivedName = url.split("/").pop()?.split("?")[0] || "image"
      const file = new File([blob], derivedName, { type: blob.type })
      processFile(file)
    } catch (err) {
      setUrlError(t.urlLoadError)
    } finally {
      setIsLoadingUrl(false)
    }
  }

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [imageUrl])

  return (
    <div className="grid gap-6">
      <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
      <div
        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 md:p-12 bg-card transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!imageUrl ? (
          <div className="text-center w-full max-w-md">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-2 text-sm font-semibold text-foreground">{t.uploadTitle}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t.uploadDescription}</p>
            <div className="mt-6">
              <Button onClick={triggerFileInput}>{t.selectImage}</Button>
            </div>
            <div className="mt-4 flex gap-2">
              <Input
                type="url"
                placeholder={t.imageUrlPlaceholder}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={isLoadingUrl}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && urlInput.trim() && !isLoadingUrl) loadFromUrl(urlInput.trim())
                }}
              />
              <Button
                variant="outline"
                disabled={!urlInput.trim() || isLoadingUrl}
                onClick={() => loadFromUrl(urlInput.trim())}
              >
                {isLoadingUrl ? (
                  <Loader2 className="h-4 w-4 animate-spin" data-testid="url-loading-spinner" />
                ) : (
                  t.loadUrl
                )}
              </Button>
            </div>
            {urlError && <p className="mt-2 text-xs text-destructive">{urlError}</p>}
          </div>
        ) : (
          <div className="w-full">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-semibold">{t.editImage}</h2>
              <Button variant="outline" onClick={clearImage}>
                {t.changeImage}
              </Button>
            </div>
            <div className={`grid gap-6 ${isMobile ? "" : "md:grid-cols-[1fr_300px]"}`}>
              <ImageCanvas imageUrl={imageUrl} />
              <ControlPanel imageUrl={imageUrl} fileName={fileName} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
