from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / 'customer-dashboard' / 'index.html'

index = INDEX_PATH.read_text(encoding='utf-8')

old_documents = '''            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Rechnungen</h2><p class="vx-settings-card-meta">Ihre Abrechnungsdokumente an einem Ort.</p></div></div>
              <div id="abo-invoices-list" class="vx-settings-card-body"><div class="vx-abo-empty">Rechnungen werden hier angezeigt, sobald sie verfügbar sind.</div></div>
            </section>'''
new_documents = '''            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Vertrag</h2><p class="vx-settings-card-meta">Ihr vollständig unterzeichneter Voxera-Vertrag.</p></div></div>
              <div id="abo-contract-documents" class="vx-abo-addon-grid"><div class="vx-abo-empty">Vertrag wird geladen…</div></div>
            </section>

            <section class="vx-settings-card">
              <div class="vx-settings-card-head"><div><h2 class="vx-settings-card-title">Rechnungen</h2><p class="vx-settings-card-meta">Ihre ausgestellten Abrechnungsdokumente an einem Ort.</p></div></div>
              <div id="abo-invoices-list" class="vx-abo-addon-grid"><div class="vx-abo-empty">Rechnungen werden geladen…</div></div>
            </section>'''
if index.count(old_documents) != 1:
    raise SystemExit(f'expected one legacy document section, found {index.count(old_documents)}')
index = index.replace(old_documents, new_documents, 1)

old_state = '''let customerContractMeta = null;
let customerContractState = {'''
new_state = '''let customerContractMeta = null;
let customerDocumentsState = { loading: false, loaded: false, invoices: [], contract: null, error: null };
let customerContractState = {'''
if index.count(old_state) != 1:
    raise SystemExit(f'expected one customer contract state marker, found {index.count(old_state)}')
index = index.replace(old_state, new_state, 1)

functions = r'''
function vxEscapeDocumentText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function vxFormatDocumentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function vxFormatDocumentAmount(amount, currency) {
  const numeric = Number(amount || 0);
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: String(currency || 'CHF').toUpperCase(),
    minimumFractionDigits: 2
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function vxDocumentStatusLabel(status) {
  const labels = { paid: 'Bezahlt', overdue: 'Überfällig', sent: 'Offen' };
  return labels[String(status || '').toLowerCase()] || 'Ausgestellt';
}

function vxOpenCustomerDocument(key) {
  const state = customerDocumentsState || {};
  let documentUrl = '';
  if (key === 'contract') {
    documentUrl = state.contract && state.contract.document_url ? state.contract.document_url : '';
  } else if (String(key || '').startsWith('invoice:')) {
    const invoiceId = String(key).slice(8);
    const invoice = (state.invoices || []).find(function(item) { return String(item.id || '') === invoiceId; });
    documentUrl = invoice && invoice.pdf_url ? invoice.pdf_url : '';
  }
  if (!documentUrl) {
    toast('Dieses Dokument ist noch nicht als PDF verfügbar.', 'info');
    return;
  }
  const opened = window.open(documentUrl, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
}

function vxRenderCustomerDocuments() {
  const contractEl = document.getElementById('abo-contract-documents');
  const invoicesEl = document.getElementById('abo-invoices-list');
  if (!contractEl && !invoicesEl) return;

  const state = customerDocumentsState || {};
  if (state.loading) {
    if (contractEl) contractEl.innerHTML = '<div class="vx-abo-empty">Vertrag wird geladen…</div>';
    if (invoicesEl) invoicesEl.innerHTML = '<div class="vx-abo-empty">Rechnungen werden geladen…</div>';
    return;
  }
  if (state.error) {
    const errorText = '<div class="vx-abo-empty">Dokumente konnten nicht geladen werden. Bitte versuchen Sie es später erneut.</div>';
    if (contractEl) contractEl.innerHTML = errorText;
    if (invoicesEl) invoicesEl.innerHTML = errorText;
    return;
  }

  const contract = state.contract || null;
  if (contractEl) {
    if (!contract) {
      contractEl.innerHTML = '<div class="vx-abo-empty">Ein vollständig unterzeichneter Vertrag ist noch nicht verfügbar.</div>';
    } else {
      const signedDate = vxFormatDocumentDate(contract.countersigned_at || contract.accepted_at);
      const contractMeta = [contract.plan ? vxEscapeDocumentText(contract.plan) : '', signedDate ? 'Unterzeichnet am ' + signedDate : 'Vollständig unterzeichnet'].filter(Boolean).join(' · ');
      contractEl.innerHTML = '<button type="button" class="vx-commercial-entry" onclick="vxOpenCustomerDocument(\'contract\')">'
        + '<span class="vx-commercial-entry-icon"><i class="ph-bold ph-file-text" aria-hidden="true"></i></span>'
        + '<span><strong>Unterzeichneter Vertrag</strong><small>' + contractMeta + '</small></span>'
        + '<i class="ph-bold ph-arrow-square-out" aria-hidden="true"></i></button>';
    }
  }

  if (invoicesEl) {
    const invoices = Array.isArray(state.invoices) ? state.invoices : [];
    if (!invoices.length) {
      invoicesEl.innerHTML = '<div class="vx-abo-empty">Noch keine ausgestellten Rechnungen vorhanden.</div>';
    } else {
      invoicesEl.innerHTML = invoices.map(function(invoice) {
        const number = vxEscapeDocumentText(invoice.invoice_number || 'Rechnung');
        const date = vxFormatDocumentDate(invoice.issued_at);
        const amount = vxEscapeDocumentText(vxFormatDocumentAmount(invoice.total_amount, invoice.currency));
        const status = vxEscapeDocumentText(vxDocumentStatusLabel(invoice.status));
        const meta = [date, amount, status].filter(Boolean).join(' · ');
        const key = 'invoice:' + vxEscapeDocumentText(invoice.id || '');
        const available = !!invoice.pdf_url;
        return '<button type="button" class="vx-commercial-entry" onclick="vxOpenCustomerDocument(\'' + key + '\')"' + (available ? '' : ' disabled') + '>'
          + '<span class="vx-commercial-entry-icon"><i class="ph-bold ph-file-pdf" aria-hidden="true"></i></span>'
          + '<span><strong>Rechnung ' + number + '</strong><small>' + meta + (available ? '' : ' · PDF wird vorbereitet') + '</small></span>'
          + '<i class="ph-bold ' + (available ? 'ph-arrow-square-out' : 'ph-clock') + '" aria-hidden="true"></i></button>';
      }).join('');
    }
  }
  if (typeof refreshLucideIcons === 'function') refreshLucideIcons();
}

async function vxLoadCustomerDocuments(forceReload) {
  if (customerDocumentsState.loading) return customerDocumentsState;
  if (customerDocumentsState.loaded && !forceReload) {
    vxRenderCustomerDocuments();
    return customerDocumentsState;
  }

  customerDocumentsState = { loading: true, loaded: false, invoices: [], contract: null, error: null };
  vxRenderCustomerDocuments();
  try {
    const result = await callDashboardFunction('customer-documents', {});
    customerDocumentsState = {
      loading: false,
      loaded: true,
      invoices: Array.isArray(result && result.invoices) ? result.invoices : [],
      contract: result && result.contract ? result.contract : null,
      error: null
    };
  } catch (error) {
    console.error('[customer-documents] load failed', error);
    customerDocumentsState = { loading: false, loaded: false, invoices: [], contract: null, error: error || new Error('documents_load_failed') };
  }
  vxRenderCustomerDocuments();
  return customerDocumentsState;
}

'''
marker = 'async function vxSubmitReactivationRequest() {'
if index.count(marker) != 1:
    raise SystemExit(f'expected one reactivation marker, found {index.count(marker)}')
index = index.replace(marker, functions + marker, 1)

old_load = "  await loadCustomerContractMeta(context.customerId || f.id || '', f.subscription_id || null);\n  const commercialContract = selectCommercialContractRow();"
new_load = "  await loadCustomerContractMeta(context.customerId || f.id || '', f.subscription_id || null);\n  await vxLoadCustomerDocuments();\n  const commercialContract = selectCommercialContractRow();"
if index.count(old_load) != 1:
    raise SystemExit(f'expected one customer meta load marker, found {index.count(old_load)}')
index = index.replace(old_load, new_load, 1)

for token, expected in {
    'id="abo-contract-documents"': 1,
    'id="abo-invoices-list"': 1,
    'function vxLoadCustomerDocuments': 1,
    "callDashboardFunction('customer-documents'": 1,
    'Rechnungen werden hier angezeigt, sobald sie verfügbar sind.': 0,
}.items():
    actual = index.count(token)
    if actual != expected:
        raise SystemExit(f'{token!r}: expected {expected}, found {actual}')

INDEX_PATH.write_text(index, encoding='utf-8')
print('customer documents migration applied')
