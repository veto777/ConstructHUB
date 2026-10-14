import type { Pool, PoolClient } from "pg";
import {
  directoryCreateInput,
  directoryPatchInput,
  type DirectoryEdits,
} from "./directory";
import {
  importedProfile,
  mergeImport,
  profileFields,
  jsonFields,
} from "./profile";
import { checkDirectoryProfile, type NapProfile } from "./nap";
export type Scope = { userId: number; actorId: number; admin: boolean };
export class DirectoryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function domainAllows(domain: string, raw: string) {
  const hostname = new URL(raw).hostname.toLowerCase().replace(/\.$/, "");
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
// All ownership predicates use the authenticated account scope, never body/query user_id.
export class DirectoryStore {
  constructor(
    private db: Pool,
    private checker = checkDirectoryProfile,
  ) {}
  async location(
    scope: Scope,
    id: number,
    db: Pick<PoolClient, "query"> = this.db,
  ) {
    const {
      rows: [row],
    } = await db.query(
      "SELECT * FROM business_locations WHERE id=$1 AND (user_id=$2 OR $3::boolean)",
      [id, scope.userId, scope.admin],
    );
    if (!row) throw new DirectoryError(404, "Location not found");
    return row;
  }
  async profile(scope: Scope, locationId: number) {
    await this.location(scope, locationId);
    const {
      rows: [row],
    } = await this.db.query(
      "SELECT * FROM listing_profiles WHERE location_id=$1 AND (user_id=$2 OR $3::boolean)",
      [locationId, scope.userId, scope.admin],
    );
    return row ?? null;
  }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const row = await operation(client);
      await client.query("COMMIT");
      return row;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async event(
    client: PoolClient,
    scope: Scope,
    profileId: number,
    directoryProfileId: number | null,
    type: string,
    detail: unknown,
  ) {
    await client.query(
      "INSERT INTO listing_events(profile_id,listing_id,actor_user_id,type,detail) VALUES($1,$2,$3,$4,$5)",
      [
        profileId,
        directoryProfileId,
        scope.actorId,
        type,
        JSON.stringify(detail),
      ],
    );
  }
  async saveProfile(
    scope: Scope,
    locationId: number,
    edits: Record<string, any> | null,
    google?: Record<string, any>,
  ) {
    return this.tx(async (client) => {
      const location = await this.location(scope, locationId, client);
      // Serializes initial imports too, before a profile row exists.
      await client.query("SELECT pg_advisory_xact_lock(7821,$1)", [locationId]);
      const {
        rows: [current],
      } = await client.query(
        "SELECT * FROM listing_profiles WHERE location_id=$1 FOR UPDATE",
        [locationId],
      );
      const incoming = importedProfile(location, google);
      const values = edits
        ? { ...(current ?? incoming), ...edits }
        : mergeImport(current, incoming);
      const ownerFields = [
        ...new Set<string>([
          ...(current?.owner_edited_fields ?? []),
          ...Object.keys(edits ?? {}),
        ]),
      ];
      const fields = profileFields.map((field) =>
        jsonFields.has(field) && values[field] != null
          ? JSON.stringify(values[field])
          : (values[field] ?? null),
      );
      const source =
        edits || ownerFields.length ? "manual" : google ? "gbp" : "manual";
      const params = [
        location.user_id,
        locationId,
        ...fields,
        source,
        ownerFields,
      ];
      const names = [
        "user_id",
        "location_id",
        ...profileFields,
        "source",
        "owner_edited_fields",
      ];
      const {
        rows: [saved],
      } = await client.query(
        `INSERT INTO listing_profiles(${names.join(",")}) VALUES(${params.map((_, i) => `$${i + 1}`).join(",")})
    ON CONFLICT(location_id) DO UPDATE SET ${names
      .filter((field) => field !== "location_id")
      .map((field) => `${field}=EXCLUDED.${field}`)
      .join(
        ",",
      )},revision=listing_profiles.revision+1,updated_at=now() RETURNING *`,
        params,
      );
      // Canonical edits invalidate crawl verdicts, while retaining original evidence in the event log.
      await client.query(
        `UPDATE listings SET status=CASE WHEN status IN ('live','mismatch') THEN 'queued' ELSE status END,
    billable=false,nap_result=NULL,evidence=NULL,last_checked_at=NULL,updated_at=now() WHERE profile_id=$1`,
        [saved.id],
      );
      await this.event(
        client,
        scope,
        saved.id,
        null,
        edits ? "profile_edited" : "profile_imported",
        {
          source,
          fields: edits
            ? Object.keys(edits)
            : profileFields.filter((field) => !ownerFields.includes(field)),
          preservedFields: ownerFields,
          revision: saved.revision,
        },
      );
      return saved;
    });
  }
  private async catalogueSql(filters: Record<string, any>) {
    const {
      rows: [relation],
    } = await this.db.query("SELECT to_regclass('backlink_sources') AS name");
    const base = relation.name
      ? `SELECT d.*, CASE WHEN coalesce(b.metrics->>'rank', d.authority->>'rank') ~ '^[0-9]+([.][0-9]+)?$'
          THEN round(coalesce(b.metrics->>'rank', d.authority->>'rank')::numeric / 10)::int END AS dr,
          b.tier AS grade FROM listing_directories d
          LEFT JOIN backlink_sources b ON b.domain = d.domain`
      : "SELECT d.*, NULL::integer AS dr, NULL::text AS grade FROM listing_directories d";
    const values: unknown[] = [];
    const predicates: string[] = [];
    const param = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    for (const key of ["kind", "tier", "category", "grade"]) {
      if (filters[key] !== undefined) {
        const entries = Array.isArray(filters[key])
          ? filters[key]
          : [filters[key]];
        predicates.push(
          `${key === "grade" ? "coalesce(grade, 'ungraded')" : key + "::text"} = ANY(${param(entries)}::text[])`,
        );
      }
    }
    if (filters.active !== undefined)
      predicates.push(`active = ${param(filters.active)}`);
    if (filters.q) {
      const value = param(filters.q);
      predicates.push(
        `(strpos(lower(name), lower(${value})) > 0 OR strpos(lower(domain), lower(${value})) > 0)`,
      );
    }
    if (filters.state) predicates.push(`${param(filters.state)} = ANY(states)`);
    if (filters.trade)
      predicates.push(
        `EXISTS (SELECT 1 FROM unnest(trades) trade WHERE strpos(lower(trade), lower(${param(filters.trade)})) > 0)`,
      );
    if (filters.link) predicates.push(`link_status = ${param(filters.link)}`);
    if (filters.paid)
      predicates.push(
        filters.paid === "unknown"
          ? "paid IS NULL"
          : `paid = ${param(filters.paid === "true")}`,
      );
    if (filters.dr_min !== undefined)
      predicates.push(`dr >= ${param(filters.dr_min)}`);
    if (filters.dr_max !== undefined)
      predicates.push(`dr <= ${param(filters.dr_max)}`);
    return {
      sql: `WITH catalogue AS (SELECT enriched.*, CASE
        WHEN notes ~* 'Link verified' THEN 'verified'
        WHEN notes ~* 'Link unconfirmed' THEN 'unconfirmed'
        ELSE NULL END AS link_status FROM (${base}) enriched)
        SELECT * FROM catalogue ${predicates.length ? "WHERE " + predicates.join(" AND ") : ""}`,
      values,
    };
  }
  async directories(filters: Record<string, any>, paged = false) {
    const { sql, values } = await this.catalogueSql(filters);
    const columns: Record<string, string> = {
      name: "name",
      dr: "dr",
      tier: "tier",
      category: "category",
      state: "states[1]",
    };
    const order = `${columns[filters.sort] ?? "tier"} ${filters.dir === "desc" ? "DESC" : "ASC"} NULLS LAST, name ASC, id ASC`;
    if (!paged)
      return (await this.db.query(`${sql} ORDER BY ${order}`, values)).rows;
    // Count separately so a page beyond the last row still reports the correct total.
    const {
      rows: [count],
    } = await this.db.query(
      `SELECT count(*)::int AS total FROM (${sql}) filtered`,
      values,
    );
    const { rows } = await this.db.query(
      `${sql} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit ?? 25, filters.offset ?? 0],
    );
    return { rows, total: count.total };
  }
  async directoryFacets(filters: Record<string, any>) {
    // Facets share search/coverage/status filters, excluding all facet selections and paging.
    const { category, tier, kind, grade, dr_min, dr_max, ...nonFacet } =
      filters;
    const { sql, values } = await this.catalogueSql(nonFacet);
    const { rows } = await this.db.query(
      `WITH filtered AS (${sql})
      SELECT facet.key, facet.value, count(*)::int AS count FROM filtered
      CROSS JOIN LATERAL (VALUES
        ('category', category), ('tier', tier::text), ('kind', kind),
        ('grade', coalesce(grade, 'ungraded')),
        ('dr', CASE WHEN dr IS NULL THEN 'unknown' WHEN dr <= 20 THEN '0–20'
          WHEN dr <= 40 THEN '21–40' WHEN dr <= 60 THEN '41–60'
          WHEN dr <= 80 THEN '61–80' ELSE '81–100' END)
      ) facet(key, value) GROUP BY facet.key, facet.value`,
      values,
    );
    const result: Record<string, Record<string, number>> = {
      category: {},
      tier: {},
      kind: {},
      grade: {},
      dr: {},
    };
    for (const row of rows) result[row.key][row.value] = row.count;
    return result;
  }
  async adminProfiles(
    scope: Scope,
    filters: { limit: number; offset: number },
  ) {
    if (!scope.admin) throw new DirectoryError(403, "Platform admins only");
    return (
      await this.db.query(
        `SELECT p.*, u.email AS account_email,
   count(l.id)::int AS total,
   count(l.id) FILTER (WHERE l.status='live')::int AS live,
   count(l.id) FILTER (WHERE l.billable)::int AS billable
   FROM listing_profiles p JOIN users u ON u.id=p.user_id
   LEFT JOIN listings l ON l.profile_id=p.id
   GROUP BY p.id,u.email ORDER BY p.id DESC LIMIT $1 OFFSET $2`,
        [filters.limit, filters.offset],
      )
    ).rows;
  }
  async saveDirectory(
    scope: Scope,
    directoryId: number | null,
    input: DirectoryEdits,
  ) {
    if (!scope.admin) throw new DirectoryError(403, "Platform admins only");
    const edits =
      directoryId === null
        ? directoryCreateInput.parse(input)
        : directoryPatchInput.parse(input);
    try {
      return await this.tx(async (client) => {
        if (directoryId !== null) {
          const {
            rows: [current],
          } = await client.query(
            "SELECT * FROM listing_directories WHERE id=$1 FOR UPDATE",
            [directoryId],
          );
          if (!current) throw new DirectoryError(404, "Directory not found");
          // Existing evidence was checked against this domain. Do not silently retarget it.
          if (edits.domain !== undefined && edits.domain !== current.domain) {
            const { rows } = await client.query(
              "SELECT id FROM listings WHERE directory_id=$1 LIMIT 1",
              [directoryId],
            );
            if (rows.length)
              throw new DirectoryError(
                409,
                "A directory with directory profiles cannot change domains. Add a new directory instead.",
              );
          }
        }
        const fields = Object.keys(edits) as (keyof DirectoryEdits)[];
        const values: unknown[] = fields.map((field) => edits[field]);
        if (directoryId === null) {
          const {
            rows: [saved],
          } = await client.query(
            `INSERT INTO listing_directories(${fields.join(",")}) VALUES(${values.map((_, index) => `$${index + 1}`).join(",")}) RETURNING *`,
            values,
          );
          return saved;
        }
        values.push(directoryId);
        const {
          rows: [saved],
        } = await client.query(
          `UPDATE listing_directories SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(",")},updated_at=now() WHERE id=$${values.length} RETURNING *`,
          values,
        );
        return saved;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new DirectoryError(
          409,
          "A directory with that name or domain already exists",
        );
      throw error;
    }
  }
  async list(
    scope: Scope,
    filters: {
      location_id?: number;
      status?: string;
      limit: number;
      offset: number;
    },
  ) {
    return (
      await this.db.query(
        `SELECT l.*,p.location_id,p.user_id,d.name AS directory_name,d.tier,d.category FROM listings l
   JOIN listing_profiles p ON p.id=l.profile_id JOIN listing_directories d ON d.id=l.directory_id
   WHERE (p.user_id=$1 OR $2::boolean) AND ($3::integer IS NULL OR p.location_id=$3) AND ($4::text IS NULL OR l.status=$4)
   ORDER BY l.id DESC LIMIT $5 OFFSET $6`,
        [
          scope.userId,
          scope.admin,
          filters.location_id ?? null,
          filters.status ?? null,
          filters.limit,
          filters.offset,
        ],
      )
    ).rows;
  }
  async add(scope: Scope, profileId: number, directoryId: number, url: string) {
    return this.tx(async (client) => {
      const {
        rows: [profile],
      } = await client.query(
        "SELECT * FROM listing_profiles WHERE id=$1 AND (user_id=$2 OR $3::boolean) FOR UPDATE",
        [profileId, scope.userId, scope.admin],
      );
      if (!profile) throw new DirectoryError(404, "Profile not found");
      const {
        rows: [directory],
      } = await client.query(
        "SELECT * FROM listing_directories WHERE id=$1 AND active=true FOR SHARE",
        [directoryId],
      );
      if (!directory)
        throw new DirectoryError(404, "Active directory not found");
      if (!directory.domain || !domainAllows(directory.domain, url))
        throw new DirectoryError(
          400,
          "Directory profile URL must belong to the selected directory",
        );
      const {
        rows: [entry],
      } = await client.query(
        `INSERT INTO listings(profile_id,directory_id,listing_url) VALUES($1,$2,$3)
    ON CONFLICT(profile_id,directory_id) DO NOTHING RETURNING *`,
        [profile.id, directory.id, url],
      );
      if (!entry)
        throw new DirectoryError(
          409,
          "A directory profile already exists for this profile and directory",
        );
      await this.event(
        client,
        scope,
        profile.id,
        entry.id,
        "directory_profile_added",
        {
          url,
        },
      );
      return entry;
    });
  }
  async recheck(scope: Scope, id: number) {
    // Read snapshot without holding a DB transaction during network I/O.
    const {
      rows: [row],
    } = await this.db.query(
      `SELECT l.*,l.xmin::text AS row_version,to_jsonb(p) AS profile,d.domain FROM listings l JOIN listing_profiles p ON p.id=l.profile_id
   JOIN listing_directories d ON d.id=l.directory_id WHERE l.id=$1 AND (p.user_id=$2 OR $3::boolean)`,
      [id, scope.userId, scope.admin],
    );
    if (!row) throw new DirectoryError(404, "Directory profile not found");
    if (!row.listing_url || !row.domain)
      throw new DirectoryError(400, "No checkable directory profile URL");
    const result = await this.checker(
      row.listing_url,
      row.profile as NapProfile,
      row.status,
      undefined,
      (url) => domainAllows(row.domain, url),
    );
    return this.tx(async (client) => {
      const {
        rows: [profile],
      } = await client.query(
        "SELECT * FROM listing_profiles WHERE id=$1 AND (user_id=$2 OR $3::boolean) FOR UPDATE",
        [row.profile_id, scope.userId, scope.admin],
      );
      if (!profile) throw new DirectoryError(404, "Profile not found");
      const {
        rows: [fresh],
      } = await client.query(
        "SELECT *,xmin::text AS row_version FROM listings WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!fresh) throw new DirectoryError(404, "Directory profile not found");
      if (
        profile.revision !== row.profile.revision ||
        fresh.row_version !== row.row_version
      )
        throw new DirectoryError(
          409,
          "Profile or directory profile changed during crawl; recheck again",
        );
      const {
        rows: [saved],
      } = await client.query(
        `UPDATE listings SET status=$2,nap_result=$3,evidence=$4,billable=$5,last_checked_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
        [
          id,
          result.status,
          JSON.stringify(result.nap),
          JSON.stringify(result.evidence),
          result.billable,
        ],
      );
      await this.event(
        client,
        scope,
        profile.id,
        id,
        "directory_profile_checked",
        result,
      );
      return saved;
    });
  }
  async events(scope: Scope, locationId: number, limit: number, after: number) {
    await this.location(scope, locationId);
    return (
      await this.db.query(
        `SELECT e.* FROM listing_events e JOIN listing_profiles p ON p.id=e.profile_id
   WHERE p.location_id=$1 AND (p.user_id=$2 OR $3::boolean) AND e.id>$4 ORDER BY e.id ASC LIMIT $5`,
        [locationId, scope.userId, scope.admin, after, limit],
      )
    ).rows;
  }
  async summary(scope: Scope, locationId?: number) {
    const { rows } = await this.db.query(
      `SELECT d.tier,d.category,count(*)::int AS total,
   count(*) FILTER(WHERE l.status='live')::int AS live,count(*) FILTER(WHERE l.status='mismatch')::int AS mismatch,
   count(*) FILTER(WHERE l.billable)::int AS billable FROM listings l JOIN listing_profiles p ON p.id=l.profile_id
   JOIN listing_directories d ON d.id=l.directory_id WHERE (p.user_id=$1 OR $2::boolean) AND ($3::integer IS NULL OR p.location_id=$3)
   GROUP BY d.tier,d.category ORDER BY d.tier,d.category`,
      [scope.userId, scope.admin, locationId ?? null],
    );
    const empty = () => ({ total: 0, live: 0, mismatch: 0, billable: 0 });
    const total = empty(),
      by_tier: Record<string, ReturnType<typeof empty>> = {},
      by_category: typeof by_tier = {};
    for (const row of rows)
      for (const target of [
        total,
        (by_tier[row.tier] ??= empty()),
        (by_category[row.category] ??= empty()),
      ])
        for (const field of ["total", "live", "mismatch", "billable"] as const)
          target[field] += row[field];
    return { ...total, by_tier, by_category };
  }
}
