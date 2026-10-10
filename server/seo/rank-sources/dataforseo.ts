/** The paid search-results source the rank tracker uses today, as a rank source: the baseline the others are measured against. */
import { isConfigured, serpLive } from "../dataforseo";
import type { RankObservation, RankQuery, RankSource } from "./types";

export const dataforseoSource: RankSource = {
  name: "dataforseo",
  label: "Paid results source (today's)",
  async available() { return isConfigured() ? { ok: true } : { ok: false, why: "not configured" }; },
  async check(q) {
    const t0 = Date.now();
    const base: RankObservation = { source: "dataforseo", keyword: q.keyword, device: q.device, place: q.place ? { code: q.place.code, label: q.place.label } : null, position: null, url: null, top: [], mapPack: null, localPosition: null, features: [], costUsd: 0, ms: 0 };
    try {
      const { data, costUsd } = await serpLive({ keyword: q.keyword, keywordId: 0, locationCode: q.place?.code ?? q.countryCode, languageCode: q.languageCode, device: q.device, targetDomain: q.domain, depth: 10 });
      return {
        ...base, ms: Date.now() - t0, costUsd, position: data.position, url: data.url,
        top: data.serpTop.slice(0, 10), mapPack: data.serpFeatures.includes("local_pack"), localPosition: data.localPosition, features: data.serpFeatures,
      };
    } catch (e: any) {
      return { ...base, ms: Date.now() - t0, costUsd: Number(e?.costUsd) || 0, error: String(e?.message ?? e).slice(0, 160) };
    }
  },
};
