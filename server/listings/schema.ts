/** Shared by boot and the explicit migration. Additive only; no live DB access on import. */
export const LISTINGS_DDL = `
CREATE TABLE IF NOT EXISTS listing_profiles (
 id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id),
 location_id integer NOT NULL UNIQUE REFERENCES business_locations(id) ON DELETE CASCADE,
 name text, street_address text, address_line2 text, city text, state text, postal_code text, country text,
 service_area_only boolean, service_areas jsonb, phone text, website text, hours jsonb, holiday_hours jsonb,
 primary_category text, secondary_categories text[], short_description text, long_description text,
 services jsonb, logo_key text, cover_photo_key text, photo_keys text[], year_founded integer,
 licence_numbers text[], insurance_numbers text[], payment_methods text[], social_links jsonb,
 quote_link text, review_link text, source text NOT NULL CHECK(source IN ('gbp','manual')),
 owner_edited_fields text[] NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_profiles_user ON listing_profiles(user_id);
CREATE TABLE IF NOT EXISTS listing_directories (
 id serial PRIMARY KEY, name text NOT NULL UNIQUE, domain text UNIQUE,
 kind text NOT NULL CHECK(kind IN ('api','aggregator','partner','submission')),
 tier integer NOT NULL CHECK(tier BETWEEN 1 AND 4),
 category text NOT NULL CHECK(category IN ('general','maps_nav','social','contractor','trade_assoc','manufacturer','state_local','ai')),
 trades text[], states text[], requires_street_address boolean, requires_phone_verification boolean,
 requires_postcard boolean, paid boolean, active boolean NOT NULL DEFAULT true, source text NOT NULL, notes text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS listings (
 id serial PRIMARY KEY, profile_id integer NOT NULL REFERENCES listing_profiles(id) ON DELETE CASCADE,
 directory_id integer NOT NULL REFERENCES listing_directories(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','submitted','needs_owner_action','live','mismatch','duplicate','suppressed','failed')),
 listing_url text, last_checked_at timestamptz, nap_result jsonb, evidence jsonb,
 billable boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(profile_id,directory_id),
 CHECK (NOT billable OR (status='live' AND last_checked_at IS NOT NULL AND listing_url IS NOT NULL
   AND (nap_result->>'matches') IS NOT DISTINCT FROM 'true'
   AND (evidence->>'confirmation') IS NOT DISTINCT FROM 'confirmed'))
);
CREATE INDEX IF NOT EXISTS listings_profile ON listings(profile_id);
CREATE TABLE IF NOT EXISTS listing_events (
 id bigserial PRIMARY KEY, profile_id integer NOT NULL REFERENCES listing_profiles(id) ON DELETE CASCADE,
 listing_id integer REFERENCES listings(id) ON DELETE CASCADE, actor_user_id integer REFERENCES users(id),
 type text NOT NULL, detail jsonb, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_events_profile ON listing_events(profile_id,id);
`;
export async function ensureListingSchema(db: { query: (sql: string) => Promise<unknown> }) {
  await db.query(LISTINGS_DDL);
}
