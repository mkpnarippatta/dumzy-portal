-- Migration: Add acquisition_channel to conversations table
-- Epic 1: WhatsApp Ingestion & AI Routing
-- Story 1.5: Marketplace Enquiry Routing

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS acquisition_channel VARCHAR(20)
    DEFAULT 'Direct'
    CHECK (acquisition_channel IN ('Direct', 'Airbnb', 'Booking.com', 'Agoda'));

-- Index for acquisition channel analytics queries
CREATE INDEX IF NOT EXISTS idx_conversations_acquisition_channel
  ON conversations(acquisition_channel);
