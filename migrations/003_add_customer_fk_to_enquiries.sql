-- Add customer_id FK to enquiries table
-- Run AFTER 002_create_customers_table.sql

ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_enquiries_customer ON enquiries(customer_id);
