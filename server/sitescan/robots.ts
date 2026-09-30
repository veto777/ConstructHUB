export function robotsRules(text: string, agent = "ConstructHUBSiteScan") {
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
    delay: number;
  }[] = [];
  let g: (typeof groups)[number] | undefined,
    directives = false;
  const sitemaps: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/#.*/, "").trim(),
      pos = clean.indexOf(":");
    if (pos < 0) continue;
    const key = clean.slice(0, pos).trim().toLowerCase(),
      value = clean.slice(pos + 1).trim();
    if (key === "sitemap") sitemaps.push(value);
    if (key === "user-agent") {
      if (!g || directives) {
        g = { agents: [], rules: [], delay: 0 };
        groups.push(g);
        directives = false;
      }
      g.agents.push(value.toLowerCase());
    } else if (g && ["allow", "disallow", "crawl-delay"].includes(key)) {
      directives = true;
      if (key === "crawl-delay")
        g.delay = Math.max(g.delay, Number(value) || 0);
      else if (value) g.rules.push({ allow: key === "allow", path: value });
    }
  }
  const matching = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)),
  );
  const selected = matching.length
    ? matching
    : groups.filter((g) => g.agents.includes("*"));
  return {
    sitemaps,
    delay: Math.max(0, ...selected.map((g) => g.delay)),
    allowed: (url: string) => {
      const u = new URL(url),
        path = u.pathname + u.search;
      const matches = selected
        .flatMap((g) => g.rules)
        .filter((r) =>
          new RegExp(
            "^" +
              r.path
                .split("*")
                .map((s) => s.replace(/[.+?^{}()|[\]\\]/g, "\\$&"))
                .join(".*")
                .replace(/\$$/, "$"),
          ).test(path),
        )
        .sort(
          (a, b) =>
            b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
        );
      return matches[0]?.allow ?? true;
    },
  };
}
