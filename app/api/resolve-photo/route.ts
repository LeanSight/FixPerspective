import { NextRequest, NextResponse } from "next/server"

const ALLOWED_HOSTS = new Set([
  "photos.app.goo.gl",
  "photos.google.com",
  "goo.gl",
  "drive.google.com",
  "lh3.googleusercontent.com",
])

function extractDriveFileId(parsed: URL): string | null {
  const filePath = parsed.pathname.match(/\/file\/d\/([^/]+)/)
  if (filePath) return filePath[1]
  const q = parsed.searchParams.get("id")
  if (q) return q
  return null
}

async function resolveToDirectUrl(input: URL): Promise<string> {
  if (input.host === "drive.google.com") {
    const id = extractDriveFileId(input)
    if (!id) throw new Error("could not parse drive file id")
    return `https://drive.google.com/uc?export=view&id=${id}`
  }

  if (input.host === "lh3.googleusercontent.com") {
    return input.toString()
  }

  // Google Photos share page: scrape og:image or lh3 URL, upgrade to =s0.
  const page = await fetch(input.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  })
  if (!page.ok) throw new Error(`upstream ${page.status}`)
  const html = await page.text()

  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  const lh = html.match(/"(https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9_\-\/=.]+)"/)
  const raw = og?.[1] ?? lh?.[1]
  if (!raw) throw new Error("no image found in share page")

  return raw.replace(/=[\w-]+$/, "=s0")
}

/**
 * Single endpoint that resolves Google Photos/Drive share URLs and streams the
 * image bytes back. The browser cannot fetch googleusercontent.com directly
 * because those responses omit Access-Control-Allow-Origin; proxying through
 * our server avoids that constraint entirely.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")
  if (!url) {
    return NextResponse.json({ error: "missing url" }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 })
  }

  if (!ALLOWED_HOSTS.has(parsed.host)) {
    return NextResponse.json(
      { error: `host not allowed: ${parsed.host}` },
      { status: 400 }
    )
  }

  try {
    const directUrl = await resolveToDirectUrl(parsed)
    const upstream = await fetch(directUrl, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
    }
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream"
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: `unexpected content-type: ${contentType}` }, { status: 502 })
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=0, no-store",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
