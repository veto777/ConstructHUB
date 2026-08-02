const { getHoverAccessToken } = await import("../server/crm/hover.js");
const ORG = "bba6d22f-d871-4c94-a9c7-1904dada3787";
const token = await getHoverAccessToken(ORG);
for (const u of [
  "https://hover.to/api/v2/jobs?page=1&page_size=5",
  "https://hover.to/api/v3/jobs?page=1&page_size=5",
  "https://hover.to/api/v2/jobs?page=1&page_size=5&archived=true",
]) {
  const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  const t = await r.text();
  console.log(u.slice(19, 60), "→", r.status, t.slice(0, 350).replace(/\s+/g, " "));
}
process.exit(0);
