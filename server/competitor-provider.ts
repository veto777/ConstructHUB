type Point = { lat: number; lng: number };
export function distanceMiles(a: Point, b: Point): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dlat = rad(b.lat - a.lat), dlon = rad(b.lng - a.lng);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export async function placesResponse(url: string, label: string, allowEmpty = false): Promise<any> {
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error(`${label} could not be reached. Please try again later.`); }
  if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status}).`);
  const data = await response.json();
  if (data.status !== "OK" && !(allowEmpty && data.status === "ZERO_RESULTS")) {
    const status = /^[A-Z_]+$/.test(data.status) ? data.status : "INVALID_RESPONSE";
    throw new Error(`${label} failed (${status}). Check provider access and quota.`);
  }
  return data;
}
export async function competitorPlaces(industry: string, location: string, radius: number, key: string) {
  const geo = await placesResponse(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${key}`, "Location geocoding");
  const center: Point = geo.results?.[0]?.geometry?.location;
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) throw new Error("Location could not be geocoded. Use a city and state or a full address.");
  const places = new Map<string, any>();
  let token: string | undefined;
  for (let page = 0; page < 3; page++) {
    const url = token
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(token)}&key=${key}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${industry} in ${location}`)}&location=${center.lat},${center.lng}&radius=${Math.round(radius * 1609.344)}&key=${key}`;
    const data = await placesResponse(url, "Competitor search", true);
    for (const place of data.results || []) {
      const point = place.geometry?.location;
      if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && distanceMiles(center, point) <= radius) places.set(place.place_id, place);
    }
    token = data.next_page_token;
    if (!token) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  return { center, places: [...places.values()] };
}
