/**
 * Verifiziert die dashboardweite Angleichung der Zustandsanzeigen (09.08.):
 * Toasts, die Live-Anruf-Karte und die Speicher-Rückmeldungen ausserhalb des
 * Assistent-Tabs.
 *
 * Diese drei Familien sind beim "alle Screens abgedeckt"-Design-Pass
 * durchgerutscht, weil sie nur situativ erscheinen und deshalb bei keiner
 * Screen-Liste auftauchen — dieselbe Fehlerklasse wie bei den Overlay-Menüs.
 * Genau das macht sie regressionsanfällig: ein späterer Pass wird sie wieder
 * nicht sehen. Dieses Skript ist der Wächter dagegen.
 *
 * Geprüft werden bewusst die konkreten historischen Fehler, nicht allgemeine
 * Schönheit:
 *   - der zweite, tote Toast-Renderer darf nicht zurückkehren (er hatte einen
 *     echten ReferenceError im Realtime-Pfad ausgelöst),
 *   - die Tonalität der Toasts muss auf ZWEI Trägern liegen; sie war vorher
 *     auf einen 18px-Kreis reduziert und damit praktisch eingeebnet,
 *   - der Assistentenname der Live-Karte muss aus customerMeta kommen
 *     (PR #838 hatte 12 hartkodierte "Lara"-Vorkommen beseitigt),
 *   - die Speicher-Rückmeldungen dürfen nicht wieder auf Inline-Farben
 *     zurückfallen, die die Token-Farben stumm überschreiben.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const INDEX = 'customer-dashboard/index.html';
const source = fs.readFileSync(INDEX, 'utf8');

function block(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}');
  const m = re.exec(source);
  assert.ok(m, `CSS-Regel ${selector} nicht gefunden`);
  return m[1];
}

// Genau der Funktionsrumpf, nicht ein grosszuegiges Zeichenfenster: ein zu
// weites slice() liest in die naechste Funktion hinein und meldet deren
// Fehler unter dem falschen Namen. Beim Bauen dieses Skripts genau einmal
// passiert (vxSaveProfil zeigte den Fehler von vxSavePassword).
function fnBody(signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} nicht gefunden`);
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') { depth += 1; seenBody = true; }
    else if (char === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminierte Funktion: ${signature}`);
}

// ── 0. Jedes Inline-Script muss parsebar bleiben ────────────────────────────
{
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(source))) {
    n++;
    new vm.Script(m[1], { filename: `${INDEX} inline#${n}` });
  }
  assert.ok(n > 0, 'keine Inline-Scripts gefunden — Parser-Annahme stimmt nicht mehr');
}

// ── 1. Es gibt genau EINEN lebenden Toast-Renderer ──────────────────────────
{
  assert.ok(/function toast\(msg, type\)/.test(source), 'der kanonische toast()-Renderer fehlt');
  assert.ok(/function showToast\(msg, type\)/.test(source), 'der showToast()-Adapter fehlt');

  // Das zweite System (vx-toast / vxToast) war nie implementiert. Drei
  // Aufrufe blieben trotzdem stehen; einer davon brach den Realtime-Callback
  // für neue Benachrichtigungen ab. Kein Aufruf, keine Klasse, kein
  // Container darf zurückkehren.
  // Erwähnungen in Kommentaren sind erlaubt — sie erklären, warum das System
  // weg ist, und genau diese Erklärung soll erhalten bleiben. Geprüft wird
  // deshalb der Quelltext ohne Kommentare: HTML-, Block- und Zeilenkommentare
  // fallen raus, der Rest muss frei von den Geistern sein.
  const code = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  for (const ghost of ['vxToast(', 'vxBellAdd(', 'vx-toast-container', 'class="vx-toast', '.vx-toast{']) {
    const offending = code.split('\n').filter((line) => line.includes(ghost));
    assert.equal(offending.length, 0,
      `Das tote zweite Toast-System ist zurück (${ghost}): ` + offending.slice(0, 2).join(' | '));
  }
}

// ── 2. Toast: helle Karte aus Karten-Tokens, keine Vollton-Fläche ───────────
{
  const toast = block('.toast');
  assert.ok(toast.includes('background:var(--vx-ui-card-bg)'),
    '.toast ist keine helle Karte mehr — dunkler Vollton war der Ausgangsbefund');
  assert.ok(toast.includes('color:var(--vx-color-text)'),
    '.toast schreibt nicht mehr in Night — weisse Schrift deutet auf Rückfall zur dunklen Fläche');
  assert.ok(toast.includes('border-radius:var(--vx-ui-card-radius)'),
    '.toast nutzt nicht mehr den kanonischen Karten-Radius');
  assert.ok(toast.includes('box-shadow:var(--vx-shadow-lg)'),
    '.toast nutzt nicht mehr das Schatten-Token');
  assert.ok(!/rgba\(15,\s*23,\s*42/.test(toast) && !/backdrop-filter/.test(toast),
    '.toast trägt wieder die alte Glas-Optik (rgba/backdrop-filter)');
}

// ── 3. Toast: Tonalität auf ZWEI Trägern, aus einer Rollen-Quelle ───────────
{
  const toast = block('.toast');
  assert.ok(toast.includes('--vx-toast-role:'), '.toast definiert keine Rollen-Variable mehr');
  assert.ok(toast.includes('border-left:3px solid var(--vx-toast-role)'),
    'die linke Kante trägt die Tonalität nicht mehr — damit hinge sie wieder allein am Icon');

  const icon = block('.toast-icon');
  assert.ok(icon.includes('background:var(--vx-toast-role-bg)') && icon.includes('color:var(--vx-toast-role)'),
    '.toast-icon liest die Tonalität nicht mehr aus derselben Rollen-Variable');

  // Alle vier Tonalitäten müssen erhalten bleiben und auf Rollen-Tokens
  // zeigen. "Nicht einebnen" war die ausdrückliche Vorgabe des Auftrags.
  const roles = {
    't-success': '--vx-color-success',
    't-info': '--vx-color-info',
    't-warning': '--vx-color-warning',
    't-error': '--vx-color-danger',
    // Fünfte Klasse, aber keine fünfte Bedeutung: "keine Tonalität angegeben"
    // ist Night, also Marke.
    't-neutral': '--vx-color-night'
  };
  for (const [cls, token] of Object.entries(roles)) {
    const rule = block(`.toast.${cls}`);
    assert.ok(rule.includes(`var(${token})`),
      `.toast.${cls} zeigt nicht mehr auf ${token} — Tonalität eingeebnet oder hartkodiert`);
  }

  // Die SVG-Icons dürfen keine eigenen Farbwerte mehr mitbringen: sonst gäbe
  // es wieder zwei Quellen für dieselbe Entscheidung.
  const icons = source.slice(source.indexOf('var icons = {'), source.indexOf('var icons = {') + 2200);
  assert.ok(!/stroke="#/.test(icons),
    'die Toast-Icons tragen wieder feste Hexwerte statt currentColor');
  assert.equal((icons.match(/stroke="currentColor"/g) || []).length, 5,
    'es sind nicht mehr genau fünf Toast-Icons auf currentColor (vier Tonalitäten + neutral)');

  // Der Container muss die Tonalitätsklasse bekommen, sonst greifen weder
  // Kante noch Kachel.
  assert.ok(source.includes("el.className = 'toast t-' + t;"),
    'toast() setzt die Tonalitätsklasse nicht mehr am Container');
}

// ── 3b. Die Tonalität wird nie mehr aus dem Meldungstext geraten ────────────
{
  const fn = fnBody('function toast(msg, type)');

  // Die alte Ableitung entschied über zwei Drittel aller Farbrollen und lag
  // systematisch daneben: "kein/keine" kommt in keinem ihrer Muster vor, also
  // wurden "Keine Telefonnummer vorhanden" und "Kein Code verfügbar" grün.
  assert.ok(!/inferredType/.test(fn) && !/\.test\(rawMsg\)/.test(fn),
    'toast() rät die Tonalität wieder aus dem Meldungstext — genau die Heuristik, die "Keine Nummer vorhanden" grün gefärbt hat');
  assert.ok(/TOAST_TONES\[type\] \? type : 'neutral'/.test(fn),
    'toast() faellt bei fehlender Tonalität nicht mehr auf neutral zurück');
  assert.ok(/icons\[t\] \|\| icons\.neutral/.test(fn),
    'der Icon-Rückfall behauptet wieder eine Tonalität (frueher icons.success) statt neutral zu bleiben');
}

// ── 3c. Wächter: jeder Aufruf nennt seine Tonalität ─────────────────────────
{
  // Der eigentliche Schutz gegen den Rückfall. Ohne ihn schreibt der nächste
  // Aufruf wieder toast('Keine Nummer vorhanden') — nur dass die Meldung
  // jetzt nicht mehr grün, sondern still tonlos wäre. Beides ist eine
  // vergessene Entscheidung, und die soll auffallen.
  //
  // Die Obergrenze ist bewusst eine Zahl und keine Null-Toleranz-Regel: sie
  // darf sinken, nie steigen. Steht sie auf 0, ist der Zustand erreicht und
  // die Regel wird zur Null-Toleranz-Regel, ohne dass jemand sie umschreiben
  // muss.
  const ERLAUBT_OHNE_TONALITAET = 0;

  const files = [
    ['customer-dashboard/index.html', source],
    ...['customer-runtime-commercial-controller.js', 'customer-runtime-case-intake.js', 'customer-runtime-help-route.js']
      .map((f) => [`customer-dashboard/shared/${f}`, fs.readFileSync(`customer-dashboard/shared/${f}`, 'utf8')])
  ];

  function splitArgs(inner) {
    const out = [];
    let depth = 0, cur = '', quote = null;
    for (const ch of inner) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
      if ('([{'.includes(ch)) depth += 1;
      if (')]}'.includes(ch)) depth -= 1;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  const offenders = [];
  for (const [name, text] of files) {
    // Kommentare ausblenden, ohne Offsets zu verschieben — sonst zählt eine
    // Erwähnung wie "laeuft NICHT ueber toast()" als Aufrufstelle. HTML-
    // Kommentare gehören dazu: der erste Lauf dieses Wächters meldete
    // prompt seinen eigenen Erklärtext neben dem Toast-Markup.
    const masked = text
      .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .split('\n').map((l) => l.replace(/\/\/.*$/, (m) => ' '.repeat(m.length))).join('\n');

    // Der Empfänger muss mitgelesen werden: die Shared-Module rufen defensiv
    // über root.toast() / w.toast() auf. Eine reine /(?<![\w.$])toast\(/-Suche
    // übersieht sie vollständig — die Gegenprobe hat genau das aufgedeckt,
    // nachdem der Wächter für index.html längst grün war.
    for (const m of masked.matchAll(/(?<![\w$])((?:root|w|window|globalThis)\.)?(showToast|toast)\s*\(/g)) {
      // Ohne bekannten Empfänger darf kein Punkt davorstehen — sonst zählt
      // jede fremde .toast()-Methode mit.
      if (!m[1] && m.index > 0 && text[m.index - 1] === '.') continue;
      let depth = 0, end = -1;
      for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) continue;
      const call = text.slice(m.index, end + 1);
      // Der showToast()-Adapter reicht den Typ durch und ist selbst keine
      // Aufrufstelle.
      if (call.startsWith("toast(String(msg")) continue;
      if (splitArgs(text.slice(m.index + m[0].length, end)).length >= 2) continue;
      offenders.push(`${name}:${text.slice(0, m.index).split('\n').length} ${call.slice(0, 80)}`);
    }
  }

  assert.ok(
    offenders.length <= ERLAUBT_OHNE_TONALITAET,
    `${offenders.length} Toast-Aufruf(e) ohne explizite Tonalität (erlaubt: ${ERLAUBT_OHNE_TONALITAET}).\n`
    + 'Die Farbrolle entscheidet sonst niemand — sie fällt still auf neutral.\n'
    + 'Einordnung: success = Aktion abgeschlossen · error = Aktion fehlgeschlagen ·\n'
    + 'warning = Eingabe/Entscheidung fehlt oder Voraussetzung nicht erfüllt ·\n'
    + 'info = nichts fehlgeschlagen, nichts erreicht (reine Zustandsauskunft).\n'
    + offenders.map((o) => '  ' + o).join('\n')
  );

  // Und in die Gegenrichtung: die Obergrenze darf nicht heimlich angehoben
  // werden, um einen neuen untypisierten Aufruf durchzulassen.
  assert.ok(ERLAUBT_OHNE_TONALITAET === 0,
    'die Obergrenze für untypisierte Toast-Aufrufe wurde wieder angehoben — sie darf nur sinken');
}

// ── 3d. Kein Emoji mehr als dritter Tonalitäts-Träger ───────────────────────
{
  // Das Emoji war der Behelf einer Zeit, in der die vier Tonalitäten praktisch
  // gleich aussahen. Neben einem Icon derselben Bedeutung ist es Doppelung —
  // und in mehreren Fällen widersprach es sogar der gesetzten Rolle.
  const offenders = [...source.matchAll(/(?<![\w.$])(showToast|toast)\s*\(\s*['"](⚠️|⚠|✓|✗)/g)]
    .map((m) => source.slice(0, m.index).split('\n').length);
  assert.equal(offenders.length, 0,
    `Toast-Meldung beginnt wieder mit einem Zustands-Emoji (Zeile ${offenders.join(', ')}) — die Tonalität trägt bereits die Icon-Kachel`);
}

// ── 4. #incoming-banner: dieselbe Familie, dieselbe Rot-Rolle ───────────────
{
  const banner = block('.incoming-banner');
  assert.ok(banner.includes('background:var(--vx-ui-card-bg)'),
    '#incoming-banner ist wieder eine dunkle Fläche');
  assert.ok(banner.includes('border-left:3px solid var(--vx-color-danger)'),
    '#incoming-banner trägt die Rot-Rolle nicht mehr');

  // Die Deklaration darf nicht nur "auch" da sein: eine zusaetzliche dunkle
  // Fläche im selben Block wäre je nach Reihenfolge wieder die wirksame.
  assert.ok(!/rgba\(17,\s*24,\s*39/.test(banner) && !/backdrop-filter/.test(banner),
    '#incoming-banner trägt wieder die alte Glas-Optik (rgba/backdrop-filter)');
  assert.equal((banner.match(/background:/g) || []).length, 1,
    '#incoming-banner deklariert mehr als einen Hintergrund — welcher gewinnt, hinge dann an der Reihenfolge');

  const dot = block('.incoming-banner-dot');
  assert.ok(dot.includes('background:var(--vx-color-danger)'),
    'der Puls-Punkt ist wieder grün — Grün gehört nach der Vier-Familien-Regel zu Abschluss-Aktionen, '
    + 'ein eingehender Anruf ist kein Abschluss (die Live-Karte nutzt bereits Rot)');
  assert.ok(!/#22c55e/i.test(dot), 'der Puls-Punkt trägt wieder einen hartkodierten Grünwert');

  // Weisse Schrift ist der zuverlässigste Hinweis darauf, dass jemand die
  // Fläche wieder dunkel gedacht hat.
  for (const sel of ['.incoming-banner-text', '.incoming-banner-sub']) {
    const rule = block(sel);
    assert.ok(!/#fff|rgba\(255,\s*255,\s*255/i.test(rule),
      `${sel} schreibt wieder in Weiss — Rückfall auf die dunkle Fläche`);
    assert.ok(/color:var\(--vx-ui-/.test(rule), `${sel} liest seine Farbe nicht mehr aus einem Rollen-Token`);
  }
}

// ── 5. Live-Anruf-Karte: Absenderzeichen, Assistenten-Sprache, LIVE-Name ────
{
  const fn = fnBody('function updateLiveHero(');

  // Der Name kommt aus customerMeta, nie aus einem Literal. PR #838 hatte
  // genau diese Klasse Fehler (12 hartkodierte "Lara") beseitigt.
  assert.ok(/customerMeta\.assistantName/.test(fn),
    'updateLiveHero() liest den Assistentennamen nicht mehr aus customerMeta');
  assert.ok(fn.includes("assistantName + ' ist gerade im Gespräch'"),
    'die Live-Karte spricht nicht mehr in der Assistenten-Sprache');
  assert.ok(!/'Ein Anruf läuft gerade'/.test(fn),
    'der alte, rein technische Text ist zurück');

  // Genau ein 'Lara' im Funktionskörper: der Fallback. Jedes weitere wäre
  // ein Rückfall in hartkodierte Namen.
  assert.equal((fn.match(/'Lara'/g) || []).length, 1,
    "updateLiveHero() enthält mehr als den einen erlaubten 'Lara'-Fallback");

  // Der Fingerprint muss den Namen kennen, sonst bleibt bei einer Umbenennung
  // mitten im Gespräch der alte Name stehen, während der restliche Screen
  // über vxSyncAssistantNameCopy() bereits nachgezogen hat.
  assert.ok(/var fingerprint = 'live:' \+ liveRecs\.length \+ ':' \+ assistantName;/.test(fn),
    'der Fingerprint kennt den Assistentennamen nicht — eine Umbenennung während eines Gesprächs bliebe stehen');

  // Das Absenderzeichen war im Stylesheet vollständig definiert und wurde vom
  // Renderer nie ausgegeben — die Live-Karte war die einzige Zustandsfläche
  // auf Heute ohne Absenderzeichen.
  assert.ok(fn.includes('<div class="vx-live-avatar"'),
    'die Live-Karte gibt ihr Absenderzeichen nicht aus (die CSS-Klasse allein genügt nicht — genau das war der Befund)');

  const avatar = block('.vx-live-avatar');
  assert.ok(avatar.includes('background:var(--vx-color-night)'),
    '.vx-live-avatar ist nicht mehr Night — Gold trägt im System ausschliesslich Lead-Qualität');

  // Das rote Live-Abzeichen wurde geprüft, nicht angenommen: Rot =
  // Dringlichkeit, es bleibt.
  const badge = block('.vx-live-badge');
  assert.ok(badge.includes('var(--vx-color-danger-bg)') && badge.includes('var(--vx-color-danger)'),
    '.vx-live-badge nutzt nicht mehr die Rot-Rollen-Tokens');
}

// ── 6. Speicher-Rückmeldungen: der Knopf trägt den Zustand ──────────────────
{
  for (const fnName of ['vxSaveProfil', 'vxSavePassword']) {
    const fn = fnBody(`async function ${fnName}(`);
    assert.ok(/vxInlineSaveStatus\(/.test(fn),
      `${fnName}() nutzt nicht das etablierte Speicher-Muster vxInlineSaveStatus()`);
    assert.ok(!/style\.color\s*=/.test(fn),
      `${fnName}() setzt wieder Inline-Farben — die überschreiben stumm die Token-Farben von .vx-settings-feedback`);
    assert.ok(!/#059669|#DC2626/.test(fn),
      `${fnName}() trägt wieder hartkodierte Statusfarben`);
  }

  // Beide Knöpfe brauchen eine ID, sonst findet der Handler sie nicht und der
  // Zustand fiele stumm auf "kein Knopf" zurück (vxInlineSaveStatus toleriert
  // null — der Fehler wäre unsichtbar).
  for (const id of ['profil-save-btn', 'profil-password-save-btn']) {
    assert.ok(source.includes(`id="${id}"`), `Speicher-Knopf #${id} fehlt im Markup`);
  }

  // Der Notiz-Speicherpfad im Anfragen-Detail hatte dasselbe Muster
  // nachgebaut statt es zu benutzen, inklusive direkter Hintergrundfarben.
  const note = fnBody('window.vxDv2SaveNote = function');
  assert.ok(/vxInlineSaveStatus\(/.test(note),
    'vxDv2SaveNote() baut das Speicher-Muster wieder selbst nach');
  assert.ok(!/btn\.style\.background/.test(note),
    'vxDv2SaveNote() schreibt wieder direkt in btn.style.background und übersteuert damit das Knopf-System');
  assert.ok(/result\.error/.test(note),
    'vxDv2SaveNote() prüft den Supabase-Fehler nicht mehr — der Knopf quittierte sonst "Gespeichert ✓" ohne Schreibvorgang');

  // Der tote Zweitpfad darf nicht zurückkehren.
  assert.ok(!/async function changePassword\(/.test(source),
    'der abgelöste zweite Passwort-Pfad changePassword() ist zurück');
  for (const deadId of ["getElementById('pw-new')", "getElementById('pw-error')", "getElementById('pw-success')"]) {
    assert.ok(!source.includes(deadId),
      `Zugriff auf nicht existierendes Element: ${deadId}`);
  }
}

// ── 7. Die Benachrichtigungsseite bleibt unangetastet ───────────────────────
{
  // Sie wird parallel komplett neu gebaut; der andere Auftrag baut das
  // Speicher-Muster dort gleich mit ein. Doppelt anfassen wäre Doppelarbeit
  // und ein Merge-Konflikt.
  const fn = fnBody('async function vxSaveBenachrichtigungen(');
  assert.ok(/feedback\.dataset\.state = 'success'/.test(fn),
    'vxSaveBenachrichtigungen() wurde mit umgestellt — die Seite war ausdrücklich ausgeklammert (paralleler Umbau)');
}

console.log('verify-zustandsanzeigen: alle Prüfungen bestanden');
