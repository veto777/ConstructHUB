#!/usr/bin/env python3
"""Apply the leftover-places fact-check (2026-10-06/07) to the directory data — deterministic, re-runnable.

Input:  final-verdicts.json from the fact-check run (one row per place; status agree|fixed, verdict, issuer,
        issuerJurisdiction, sourceUrl, quote — every quote already passed check-authority.py on its page).
Output: server/data/permit-routing.json      — existing routes kept; NEW `county`/`town` routes added where the issuer
                                                 (a county or a town) is a directory jurisdiction WITH A LIVE PORTAL and
                                                 the routed place has no live portal of its own (the UI links the
                                                 issuer's portal; never a guessed URL).
        server/data/_permit-candidates.json  — `own` verdicts with an applyUrl are appended as candidates; they still
                                                 pass the full portal gate (scripts/build-permit-portals.ts) before shipping.
        analysis/leftover-apply-report.json  — counts + every skipped row with the reason (nothing is silently dropped).
`none` / `state` / `third_party` / `unknown` are NOT applied here: the directory page has no display for them yet.

Run: python3 scripts/build-permit-routing-from-verdicts.py <final-verdicts.json> [--dry-run]
"""
import json, re, sys, collections, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTING = f"{ROOT}/server/data/permit-routing.json"
PORTALS = f"{ROOT}/server/data/permit-portals.json"
CANDS = f"{ROOT}/server/data/_permit-candidates.json"
REPORT = f"{ROOT}/analysis/leftover-apply-report.json"
BAD_SOURCE = re.compile(r"wikipedia|facebook\.com|archive\.org", re.I)
COUNTY_RE = re.compile(r"(County|Parish|Borough|Census Area|Municipality|City and Borough|^City of .*), [A-Z]{2}$")

def main():
    src = sys.argv[1]; dry = "--dry-run" in sys.argv
    final = json.load(open(src))
    routing = json.load(open(ROUTING)); routed = {r["jurisdiction"]: r for r in routing}
    portals = json.load(open(PORTALS)); live = {p["jurisdiction"] for p in portals if p.get("url")}
    cands = json.load(open(CANDS)) if os.path.exists(CANDS) else []
    cands = cands if isinstance(cands, list) else cands.get("candidates", [])
    cand_keys = {(c["jurisdiction"], c["url"]) for c in cands}

    def resolve_issuer(e):
        """The issuer as a directory jurisdiction string that has a live portal, or None."""
        ij = (e.get("issuerJurisdiction") or "").strip(); st = (e.get("jurisdiction") or "")[-2:]
        cands_ = [ij]
        m = re.match(r"^(?:Town|City|Village|Borough|Township) of (.+?)(?:, [A-Z]{2})?$", ij)
        if m: cands_.append(f"{m.group(1)}, {st}")
        if ij and not re.search(r", [A-Z]{2}$", ij): cands_.append(f"{ij}, {st}")
        for c in cands_:
            if c in live and c[-2:] == st: return c
        return None

    counts = collections.Counter(); skipped = []; added = []; new_cands = []
    for e in final:
        v = e.get("verdict"); j = e.get("jurisdiction"); status = e.get("status")
        if status not in ("agree", "fixed"):
            counts[f"skip:{status}"] += 1; continue
        if v in ("county", "town"):
            if j in live: counts["skip:place has its own live portal"] += 1; continue
            if j in routed: counts["skip:already routed"] += 1; continue
            issuer = resolve_issuer(e)
            if not issuer:
                counts[f"skip:{v} issuer has no live portal or unmatched"] += 1
                skipped.append({"id": e.get("id"), "jurisdiction": j, "verdict": v, "issuerJurisdiction": e.get("issuerJurisdiction"), "why": "issuer not a live-portal jurisdiction"}); continue
            q = (e.get("quote") or "").strip(); su = (e.get("sourceUrl") or "").strip()
            if not su.startswith("http") or BAD_SOURCE.search(su) or len(re.sub(r"[^a-z0-9]", "", q, flags=re.I)) < 12:
                counts["skip:source/quote fails the routing test rules"] += 1
                skipped.append({"id": e.get("id"), "jurisdiction": j, "verdict": v, "why": "source or quote fails routing rules"}); continue
            r = {"jurisdiction": j, "issuedBy": issuer, "sourceUrl": su, "quote": q}
            routed[j] = r; added.append(r); counts[f"added:{v} route"] += 1
        elif v == "own":
            au = (e.get("applyUrl") or "").strip(); su = (e.get("sourceUrl") or "").strip()
            if not au.startswith("http"): counts["skip:own without applyUrl"] += 1; continue
            if j in live: counts["skip:own already has live portal"] += 1; continue
            if (j, au) in cand_keys: counts["skip:own candidate already listed"] += 1; continue
            c = {"jurisdiction": j, "url": au, "platform": e.get("platform") or "Local permit page", "sourceUrl": su or au}
            cands.append(c); cand_keys.add((j, au)); new_cands.append(c); counts["added:own portal candidate"] += 1
        else:
            counts[f"hold:{v} (no directory display yet)"] += 1
    out = sorted(routed.values(), key=lambda r: r["jurisdiction"])
    report = {"source": src, "counts": dict(counts), "routesBefore": len(routing), "routesAfter": len(out),
              "candidatesBefore": len(cands) - len(new_cands), "candidatesAfter": len(cands), "skipped": skipped}
    for k, n in sorted(counts.items()): print(f"{n:6d}  {k}")
    print(f"routes {len(routing)} -> {len(out)}; candidates +{len(new_cands)}")
    if dry: print("(dry run — nothing written)"); return
    json.dump(out, open(ROUTING, "w"), indent=1, ensure_ascii=False); open(ROUTING, "a").write("\n")
    json.dump(cands, open(CANDS, "w"), indent=1, ensure_ascii=False); open(CANDS, "a").write("\n")
    os.makedirs(os.path.dirname(REPORT), exist_ok=True); json.dump(report, open(REPORT, "w"), indent=1)
    print("written:", ROUTING, CANDS, REPORT)

if __name__ == "__main__": main()
