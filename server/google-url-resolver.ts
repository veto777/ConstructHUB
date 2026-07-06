export async function resolveGoogleShortUrl(url: string): Promise<{ resolvedUrl: string; extractedQuery: string | null; kgmid: string | null; htmlBody: string | null; ogTitle: string | null; hexCid: string | null; decimalCid: string | null }> {
  const trimmed = url.trim();
  let resolvedUrl = trimmed;
  let extractedQuery: string | null = null;
  let kgmid: string | null = null;
  let htmlBody: string | null = null;
  let ogTitle: string | null = null;
  let hexCid: string | null = null;
  let decimalCid: string | null = null;

  const isShortlink = /goo\.gl|maps\.app\.goo\.gl|share\.google|g\.page/i.test(trimmed);
  const looksLikeMapsPage = /google\.\w+\/maps|maps\.google\.\w+/i.test(trimmed);

  if (isShortlink || looksLikeMapsPage) {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    try {
      const res = await fetch(trimmed, {
        redirect: "follow",
        headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html,application/xhtml+xml" },
      });
      resolvedUrl = res.url || trimmed;

      try {
        const urlObj = new URL(resolvedUrl);
        const qParam = urlObj.searchParams.get("q");
        if (qParam) extractedQuery = qParam;
        const kgmidParam = urlObj.searchParams.get("kgmid");
        if (kgmidParam) kgmid = kgmidParam;
        const ludocid = urlObj.searchParams.get("ludocid");
        if (ludocid && /^\d+$/.test(ludocid)) decimalCid = ludocid;
      } catch {}

      try {
        htmlBody = await res.text();
      } catch {}

      if (htmlBody) {
        const ogTitleMatch = htmlBody.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
          || htmlBody.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i)
          || htmlBody.match(/<title>([^<]+)<\/title>/i);
        if (ogTitleMatch) {
          ogTitle = ogTitleMatch[1]
            .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/\s*-\s*Google\s*Maps\s*$/i, "")
            .replace(/\s*\|\s*Google\s*Maps\s*$/i, "")
            .trim();
        }

        const ogUrlMatch = htmlBody.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i)
          || htmlBody.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
        if (ogUrlMatch) {
          const cand = ogUrlMatch[1].replace(/&amp;/g, "&");
          if (/google\.\w+\/maps|maps\.google\.\w+/i.test(cand)) {
            resolvedUrl = cand;
          }
        }

        const primaryHex = htmlBody.match(/!1s(0x[0-9a-fA-F]{12,}:0x[0-9a-fA-F]{12,})/);
        if (primaryHex) {
          hexCid = primaryHex[1];
        } else {
          const hexInBody = htmlBody.match(/0x[0-9a-fA-F]{12,}:0x[0-9a-fA-F]{12,}/);
          if (hexInBody) hexCid = hexInBody[0];
        }

        if (!decimalCid) {
          const ludoBody = htmlBody.match(/[?&]ludocid=(\d+)/) || htmlBody.match(/"ludocid"\s*:\s*"?(\d+)"?/);
          if (ludoBody) decimalCid = ludoBody[1];
        }

        if (!extractedQuery) {
          const hrefMatch = htmlBody.match(/href="\/search\?q=([^&"]+)/);
          if (hrefMatch) {
            try { extractedQuery = decodeURIComponent(hrefMatch[1].replace(/\+/g, " ")); } catch {}
          }
        }
      }
    } catch {}
  }

  if (!hexCid) {
    const m = resolvedUrl.match(/0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/);
    if (m) hexCid = m[0];
  }
  if (!decimalCid && hexCid) {
    const parts = hexCid.split(":");
    if (parts.length === 2) {
      try { decimalCid = BigInt(parts[1]).toString(); } catch {}
    }
  }

  return { resolvedUrl, extractedQuery, kgmid, htmlBody, ogTitle, hexCid, decimalCid };
}

export function isGoogleUrl(url: string): boolean {
  return /google\.\w+\/maps|maps\.google\.\w+|goo\.gl\/maps|maps\.app\.goo\.gl|share\.google|g\.page|google\.\w+\/search\?.*(?:rlimm|lqi|kgmid|ludocid)/i.test(url.trim());
}

export function extractPlaceId(url: string): string | null {
  const match = url.match(/place_id[=:]([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

export function extractPlaceName(url: string): string | null {
  const match = url.match(/\/maps\/place\/([^/?@]+)/);
  return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : null;
}

export function extractMapsDataCid(url: string): string | null {
  const match = url.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
  return match ? match[1] : null;
}

export function extractMapsDataSearchQuery(url: string): string | null {
  const match = url.match(/!2m1!1s([^!]+)/);
  if (match) {
    try { return decodeURIComponent(match[1].replace(/\+/g, " ")); } catch {}
  }
  const altMatch = url.match(/!1s([a-z][^!]{2,})!/i);
  if (altMatch && !/^0x/.test(altMatch[1]) && !/^Chh|^Ch[A-Z]/.test(altMatch[1])) {
    try { return decodeURIComponent(altMatch[1].replace(/\+/g, " ")); } catch {}
  }
  return null;
}

export function extractMapsDataKgmid(url: string): string | null {
  const match = url.match(/!16s([^?!&]+)/);
  if (match) {
    try { return decodeURIComponent(match[1]); } catch {}
  }
  return null;
}

export function extractMapsBusinessCoords(url: string): { lat: string; lng: string } | null {
  const latMatch = url.match(/!3d([-\d.]+)/);
  const lngMatch = url.match(/!4d([-\d.]+)/);
  if (latMatch && lngMatch) {
    return { lat: latMatch[1], lng: lngMatch[1] };
  }
  return null;
}

export function hexCidToDecimal(hexCid: string): string | null {
  const parts = hexCid.split(":");
  if (parts.length !== 2) return null;
  try {
    return BigInt(parts[1]).toString();
  } catch {
    return null;
  }
}

export async function resolveGoogleUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!isGoogleUrl(trimmed)) return trimmed;

  const { resolvedUrl, extractedQuery } = await resolveGoogleShortUrl(trimmed);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return resolvedUrl;

  let placeId = extractPlaceId(resolvedUrl);

  if (!placeId) {
    const placeName = extractPlaceName(resolvedUrl) || extractedQuery;
    if (placeName) {
      try {
        const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(placeName)}&inputtype=textquery&fields=place_id&key=${apiKey}`;
        const findRes = await fetch(findUrl);
        const findData = await findRes.json() as any;
        if (findData.candidates?.length) placeId = findData.candidates[0].place_id;
      } catch {}
    }
  }

  if (placeId) {
    return `https://search.google.com/local/writereview?placeid=${placeId}`;
  }

  return resolvedUrl;
}
