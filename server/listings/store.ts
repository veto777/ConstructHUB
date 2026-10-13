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
import { checkListing, type NapProfile } from "./nap";
export type Scope = { userId: number; actorId: number; admin: boolean };
export class ListingError extends Error {
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
export class ListingStore {
  constructor(
    private db: Pool,
    private checker = checkListing,
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
    if (!row) throw new ListingError(404, "Location not found");
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
    listingId: number | null,
    type: string,
    detail: unknown,
  ) {
    await client.query(
      "INSERT INTO listing_events(profile_id,listing_id,actor_user_id,type,detail) VALUES($1,$2,$3,$4,$5)",
      [profileId, listingId, scope.actorId, type, JSON.stringify(detail)],
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
  async directories(filters: Record<string, any>) {
    const predicates: string[] = [],
      values: any[] = [];
    for (const key of ["kind", "tier", "category", "active"])
      if (filters[key] !== undefined) {
        values.push(filters[key]);
        predicates.push(`${key}=$${values.length}`);
      }
    for (const [key, column] of [
      ["trade", "trades"],
      ["state", "states"],
    ])
      if (filters[key]) {
        values.push(filters[key]);
        predicates.push(`$${values.length}=ANY(${column})`);
      }
    return (
      await this.db.query(
        `SELECT * FROM listing_directories ${predicates.length ? "WHERE " + predicates.join(" AND ") : ""} ORDER BY tier,name`,
        values,
      )
    ).rows;
  }
  async adminProfiles(
    scope: Scope,
    filters: { limit: number; offset: number },
  ) {
    if (!scope.admin) throw new ListingError(403, "Platform admins only");
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
    if (!scope.admin) throw new ListingError(403, "Platform admins only");
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
          if (!current) throw new ListingError(404, "Directory not found");
          // Existing evidence was checked against this domain. Do not silently retarget it.
          if (edits.domain !== undefined && edits.domain !== current.domain) {
            const { rows } = await client.query(
              "SELECT id FROM listings WHERE directory_id=$1 LIMIT 1",
              [directoryId],
            );
            if (rows.length)
              throw new ListingError(
                409,
                "A directory with listings cannot change domains. Add a new directory instead.",
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
        throw new ListingError(
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
      if (!profile) throw new ListingError(404, "Profile not found");
      const {
        rows: [directory],
      } = await client.query(
        "SELECT * FROM listing_directories WHERE id=$1 AND active=true FOR SHARE",
        [directoryId],
      );
      if (!directory) throw new ListingError(404, "Active directory not found");
      if (!directory.domain || !domainAllows(directory.domain, url))
        throw new ListingError(
          400,
          "Listing URL must belong to the selected directory",
        );
      const {
        rows: [listing],
      } = await client.query(
        `INSERT INTO listings(profile_id,directory_id,listing_url) VALUES($1,$2,$3)
    ON CONFLICT(profile_id,directory_id) DO NOTHING RETURNING *`,
        [profile.id, directory.id, url],
      );
      if (!listing)
        throw new ListingError(
          409,
          "A listing already exists for this profile and directory",
        );
      await this.event(client, scope, profile.id, listing.id, "listing_added", {
        url,
      });
      return listing;
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
    if (!row) throw new ListingError(404, "Listing not found");
    if (!row.listing_url || !row.domain)
      throw new ListingError(400, "No checkable listing URL");
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
      if (!profile) throw new ListingError(404, "Profile not found");
      const {
        rows: [fresh],
      } = await client.query(
        "SELECT *,xmin::text AS row_version FROM listings WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!fresh) throw new ListingError(404, "Listing not found");
      if (
        profile.revision !== row.profile.revision ||
        fresh.row_version !== row.row_version
      )
        throw new ListingError(
          409,
          "Profile or listing changed during crawl; recheck again",
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
        "listing_checked",
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
