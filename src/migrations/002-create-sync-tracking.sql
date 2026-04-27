-- Migration: Create sync tracking and external references tables
-- Epic 5: Data Persistence & Consistency
-- Story 5.2: Cross-System Data Consistency

-- Tracks sync operations across systems
CREATE TABLE IF NOT EXISTS sync_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system VARCHAR(50) NOT NULL,
  target_system VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  external_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  request_payload JSONB DEFAULT '{}'::jsonb,
  response_payload JSONB,
  error_message TEXT,
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps Supabase IDs to external system IDs
CREATE TABLE IF NOT EXISTS external_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_entity_type VARCHAR(50) NOT NULL,
  supabase_entity_id UUID NOT NULL,
  target_system VARCHAR(50) NOT NULL,
  target_entity_id VARCHAR(255) NOT NULL,
  target_entity_type VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(supabase_entity_type, supabase_entity_id, target_system)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sync_tracking_status ON sync_tracking(status);
CREATE INDEX IF NOT EXISTS idx_sync_tracking_entity ON sync_tracking(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_tracking_target ON sync_tracking(target_system, status);
CREATE INDEX IF NOT EXISTS idx_external_refs_lookup ON external_references(target_system, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_external_refs_entity ON external_references(supabase_entity_type, supabase_entity_id);

-- Enable RLS
ALTER TABLE sync_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_references ENABLE ROW LEVEL SECURITY;

-- RLS policies (service-level access for MVP)
CREATE POLICY "Service role full access sync_tracking"
  ON sync_tracking FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access external_references"
  ON external_references FOR ALL
  USING (true)
  WITH CHECK (true);
