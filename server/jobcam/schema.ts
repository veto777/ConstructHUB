/**
 * JobCam DDL — idempotent, run at boot by server/crm/schema-ensure.ts and by
 * scripts/apply-schema-migration.ts (which must not load the server). Mirror:
 * shared/schema.ts (jobcamMedia, jobcamTags, jobcamUploads, jobcamShareLinks,
 * jobcamOrgUsage + the reserved phase B–D tables).
 */
export const JOBCAM_DDL: readonly string[] = [
  // Site coordinates on projects — null until set (never guessed from the address).
  `ALTER TABLE crm_projects ADD COLUMN IF NOT EXISTS lat double precision`,
  `ALTER TABLE crm_projects ADD COLUMN IF NOT EXISTS lng double precision`,

  `CREATE TABLE IF NOT EXISTS jobcam_media (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     project_id varchar NOT NULL,
     customer_id varchar,
     uploader_member_id varchar,
     kind text NOT NULL,
     status text NOT NULL DEFAULT 'uploading',
     error text,
     file_name text,
     mime text NOT NULL,
     bytes bigint NOT NULL DEFAULT 0,
     rendition_bytes bigint NOT NULL DEFAULT 0,
     r2_key_original text NOT NULL,
     r2_key_display text,
     r2_key_thumb text,
     r2_key_poster text,
     r2_key_video text,
     width integer,
     height integer,
     duration_s real,
     captured_at timestamp,
     uploaded_at timestamp DEFAULT now(),
     device_lat double precision,
     device_lng double precision,
     exif_lat double precision,
     exif_lng double precision,
     gps_accuracy_m real,
     stamp jsonb,
     caption text,
     caption_source text,
     tags text[],
     starred boolean NOT NULL DEFAULT false,
     client_visible boolean NOT NULL DEFAULT false,
     sha256 text,
     exif jsonb,
     deleted_at timestamp,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  // Nothing reaches the homeowner's portal unless a team member chose to show it.
  `ALTER TABLE jobcam_media ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS jobcam_media_project_idx ON jobcam_media (project_id, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS jobcam_media_org_idx ON jobcam_media (org_id, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS jobcam_media_customer_idx ON jobcam_media (customer_id)`,
  `CREATE INDEX IF NOT EXISTS jobcam_media_tags_idx ON jobcam_media USING gin (tags)`,

  `CREATE TABLE IF NOT EXISTS jobcam_tags (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     name text NOT NULL,
     color text,
     created_by_member_id varchar,
     created_at timestamp DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS jobcam_tags_org_name_idx ON jobcam_tags (org_id, lower(name))`,

  `CREATE TABLE IF NOT EXISTS jobcam_uploads (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     media_id varchar NOT NULL,
     member_id varchar,
     storage_mode text NOT NULL,
     storage_upload_id text,
     key text NOT NULL,
     part_size integer NOT NULL,
     parts_total integer NOT NULL,
     parts_done jsonb,
     bytes bigint NOT NULL,
     status text NOT NULL DEFAULT 'open',
     expires_at timestamp,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS jobcam_uploads_media_idx ON jobcam_uploads (media_id)`,

  `CREATE TABLE IF NOT EXISTS jobcam_share_links (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     project_id varchar NOT NULL,
     kind text NOT NULL,
     token text NOT NULL,
     title text,
     media_ids text[],
     show_details boolean NOT NULL DEFAULT true,
     password_hash text,
     expires_at timestamp,
     revoked_at timestamp,
     created_by_member_id varchar,
     view_count integer NOT NULL DEFAULT 0,
     last_viewed_at timestamp,
     sent_to jsonb,
     created_at timestamp DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS jobcam_share_links_token_idx ON jobcam_share_links (token)`,
  `CREATE INDEX IF NOT EXISTS jobcam_share_links_project_idx ON jobcam_share_links (project_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS jobcam_org_usage (
     org_id varchar PRIMARY KEY,
     bytes bigint NOT NULL DEFAULT 0,
     media_count integer NOT NULL DEFAULT 0,
     photo_count integer NOT NULL DEFAULT 0,
     video_count integer NOT NULL DEFAULT 0,
     updated_at timestamp DEFAULT now()
   )`,

  // ── Reserved for phases B–D (created empty now) ───────────────────────────
  `CREATE TABLE IF NOT EXISTS jobcam_annotations (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     media_id varchar NOT NULL,
     author_member_id varchar,
     version integer NOT NULL DEFAULT 1,
     layer jsonb NOT NULL,
     video_t_ms integer,
     rendered_r2_key text,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS jobcam_annotations_media_idx ON jobcam_annotations (media_id)`,

  `CREATE TABLE IF NOT EXISTS jobcam_notes (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     project_id varchar NOT NULL,
     author_member_id varchar,
     kind text NOT NULL,
     source_media_id varchar,
     audio_r2_key text,
     transcript text,
     segments jsonb,
     stt_model text,
     stt_cost_cents integer,
     structured jsonb,
     status text NOT NULL DEFAULT 'draft',
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS jobcam_notes_project_idx ON jobcam_notes (project_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS jobcam_reports (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     project_id varchar NOT NULL,
     type text NOT NULL,
     title text NOT NULL,
     blocks jsonb,
     template_id varchar,
     source_note_id varchar,
     visibility text NOT NULL DEFAULT 'project',
     pdf_r2_key text,
     pdf_generated_at timestamp,
     created_by_member_id varchar,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS jobcam_reports_project_idx ON jobcam_reports (project_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS jobcam_report_templates (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     type text NOT NULL,
     name text NOT NULL,
     blocks jsonb,
     is_default boolean NOT NULL DEFAULT false,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS jobcam_checklists (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     project_id varchar NOT NULL,
     template_id varchar,
     title text NOT NULL,
     assignee_member_id varchar,
     due_at timestamp,
     status text NOT NULL DEFAULT 'open',
     created_by_member_id varchar,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS jobcam_checklists_project_idx ON jobcam_checklists (project_id)`,

  `CREATE TABLE IF NOT EXISTS jobcam_checklist_fields (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     checklist_id varchar NOT NULL,
     position integer NOT NULL DEFAULT 0,
     type text NOT NULL,
     label text NOT NULL,
     required_photo boolean NOT NULL DEFAULT false,
     condition jsonb,
     answer jsonb,
     media_ids text[],
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS jobcam_checklist_fields_checklist_idx ON jobcam_checklist_fields (checklist_id, position)`,
];
