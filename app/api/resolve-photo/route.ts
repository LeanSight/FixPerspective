import { NextRequest, NextResponse } from "next/server"

const ALLOWED_HOSTS = new Set([
  "photos.app.goo.gl",
  "photos.google.com",
  "goo.gl",
])

/**
 * Resolves a Google Photos public share URL to the direct lh3.googleusercontent.com
 * image URL. Does the CORS-blocked fetch server-side and scrapes the og:image meta.
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
    const upstream = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    })
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502 }
      )
    }
    const html = await upstream.text()

    const ogMatch = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    )
    const lhMatch = html.match(
      /"(https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9_\-\/=.]+)"/
    )
    const rawUrl = ogMatch?.[1] ?? lhMatch?.[1]

    if (!rawUrl) {
      return NextResponse.json(
        { error: "no image found in share page" },
        { status: 404 }
      )
    }

    // Strip Google's size/crop suffix (=w600-h315-p-k, =s32-p-no, etc.) and
    // request the original: =s0 yields the full-resolution image.
    const directUrl = rawUrl.replace(/=[\w-]+$/, "=s0")

    return NextResponse.json({ directUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
