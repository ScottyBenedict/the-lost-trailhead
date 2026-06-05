-- PostgREST requires an anon role to handle unauthenticated requests
CREATE ROLE anon NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon;

-- ── Schema ────────────────────────────────────────────────────────────────────

CREATE TABLE hike_gpx (
    hike_id TEXT PRIMARY KEY,
    gpx_url TEXT NOT NULL,
    uploaded_by UUID,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE hike_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hike_id TEXT NOT NULL,
    hike_date DATE NOT NULL,
    notes TEXT
);

CREATE TABLE hike_reports (
    hike_id TEXT NOT NULL,
    user_id UUID NOT NULL,
    report_text TEXT,
    hot_take TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (hike_id, user_id)
);

CREATE TABLE hike_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hike_id TEXT NOT NULL,
    user_id UUID NOT NULL,
    storage_path TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    file_hash TEXT
);

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- ── Seed data (PRE-migration state — intentionally wrong keys) ────────────────
-- Snow Lake — Winter is stored under the old slug key to reproduce the bug.
-- After confirming the bug is visible, run the migration below to fix it.

INSERT INTO hike_gpx (hike_id, gpx_url) VALUES
    ('snow-lake',        'https://ikjgtsvauctfmxpqwmyd.supabase.co/storage/v1/object/public/gpx-files/snow-lake.gpx'),
    ('snow-lake-winter', 'https://ikjgtsvauctfmxpqwmyd.supabase.co/storage/v1/object/public/gpx-files/snow-lake-winter.gpx');

INSERT INTO hike_dates (hike_id, hike_date) VALUES
    ('snow-lake',        '2023-07-07'),
    ('snow-lake-winter', '2022-11-12');

-- ── Migration (run this to test the fix) ─────────────────────────────────────
-- docker compose exec db psql -U postgres -c "
--   UPDATE hike_gpx  SET hike_id = 'Snow Lake - Winter' WHERE hike_id = 'snow-lake-winter';
--   UPDATE hike_dates SET hike_id = 'Snow Lake - Winter' WHERE hike_id = 'snow-lake-winter';
-- "
