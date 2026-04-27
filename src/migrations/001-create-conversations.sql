-- Migration: Create conversations table for storing WhatsApp messages
-- Epic 5: Data Persistence & Consistency
-- Story 5.1: Supabase Conversation Storage

-- Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender_phone_number VARCHAR(20),
  message_id VARCHAR(100),
  classification_id VARCHAR(100),
  vertical_tag VARCHAR(50),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  customer_id UUID
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_phone_timestamp ON conversations(phone_number, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_vertical ON conversations(vertical_tag);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);

-- Enable Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view conversations for their vertical"
  ON conversations FOR SELECT
  USING (true); -- Simplified for MVP; extend with vertical-based rules

CREATE POLICY "Service role can insert conversations"
  ON conversations FOR INSERT
  WITH CHECK (true); -- Service-level access
