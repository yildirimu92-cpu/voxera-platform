# Swiss QR invoice generation

The protected function `admin-invoice-qr-pdf` generates a versioned Swiss QR invoice PDF from immutable invoice snapshots.

Required invoice data:

- `payment_account_snapshot`
- `customer_snapshot`
- `payment_reference_type`
- `payment_reference`
- `total_amount`
- `currency`

The current launch flow supports normal Swiss IBANs with reference type `NON`. QRR remains available when a valid QR-IBAN is configured.

The endpoint stores the generated PDF in `invoice-pdfs`, persists the QR payload and records an audit event.
