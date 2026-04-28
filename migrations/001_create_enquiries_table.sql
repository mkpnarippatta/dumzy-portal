-- Supabase migration: Create enquiries table for persisting all vertical bookings/leads
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/ixnkjmpsqexkqelugsir/sql/new

CREATE TABLE IF NOT EXISTS enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  data JSONB NOT NULL DEFAULT '{}',
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_enquiries_phone ON enquiries(phone_number);
CREATE INDEX IF NOT EXISTS idx_enquiries_vertical ON enquiries(vertical);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries(created_at DESC);

-- Row-level security: allow all operations with anon key for MVP
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for anon" ON enquiries
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
