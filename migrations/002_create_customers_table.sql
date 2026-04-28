-- Supabase migration: Create customers table for persisting customer profiles
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/ixnkjmpsqexkqelugsir/sql/new

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL UNIQUE,
  name TEXT,
  profile_data JSONB NOT NULL DEFAULT '{}',
  total_enquiries INTEGER NOT NULL DEFAULT 0,
  last_vertical TEXT,
  last_enquiry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(created_at DESC);

-- Row-level security: allow all operations with anon key for MVP
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for anon" ON customers
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
