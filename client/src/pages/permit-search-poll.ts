/** Stored matches per page on the Search page: the first page (POST /api/search and the poll) and each older page. */
export const SEARCH_PAGE_SIZE = 50;

/** A failed update never means an empty search. Terminal access/expired IDs stop polling. */
export async function readSearchUpdate<T>(searchId: string, signal: AbortSignal, stop: () => void, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher('/api/search/live/' + encodeURIComponent(searchId) + '?limit=' + SEARCH_PAGE_SIZE, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
  if (!res.ok) {
    if ([401, 402, 404].includes(res.status)) stop();
    throw new Error(res.status + ': ' + (res.status === 404 ? 'This search was interrupted or has expired. Run it again for fresh results.' : await res.text()));
  }
  return res.json();
}
