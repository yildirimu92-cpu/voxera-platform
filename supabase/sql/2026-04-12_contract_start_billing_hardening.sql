-- Migration: Contract start billing hardening (draft setup + recurring + PDF preview metadata)
-- Date: 2026-04-12

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_version integer;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('setup_fee', 'subscription', 'recurring', 'manual', 'credit_note'));

ALTER TABLE public.invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_item_type_check;
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_item_type_check
  CHECK (item_type IN ('setup_fee', 'subscription_base', 'overage', 'discount', 'manual', 'credit_note'));
