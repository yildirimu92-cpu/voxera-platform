# Swiss QR launch checklist

1. Run `supabase/sql/2026-08-01_swiss_qr_invoice_pdf.sql`.
2. Ensure one active default CHF payment account exists.
3. Create a fresh test contract and invoices after PR #701.
4. Call `admin-invoice-qr-pdf` with the invoice ID.
5. Open the PDF and scan the Swiss QR code with a banking app in preview mode.
6. Confirm IBAN, creditor, debtor, amount, currency and message.
7. Do not send customer invoices until the scan test succeeds.
