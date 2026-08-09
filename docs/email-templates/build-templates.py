# -*- coding: utf-8 -*-
"""Erzeugt die Voxera E-Mail-Vorlagen und ihre Vorschaudateien.

Ein Geruest, sieben Bausteine, zwoelf Vorlagen. Jeder Wert wird einmal
notiert - als Make-Ausdruck und als Beispielwert - damit Vorlage und
Vorschau nicht auseinanderlaufen koennen.
"""
import os, re

OUT = os.path.dirname(os.path.abspath(__file__))
F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"
LOGO = 'https://ulcofbgrovgcvowdjrge.supabase.co/storage/v1/object/public/Public/voxera-logo.png'

# Akzentfarben auf Night, gemessen: Gold 9.78:1, Gruen 8.55:1, Rot 8.66:1, Neutral 8.02:1
GOLD, GREEN, RED, NEUTRAL = '#E8C547', '#34D399', '#FCA5A5', '#A9B6CC'

TONE = {
    'info':    ('#EEF4FF', '#BFDBFE', '#1558BF', '#1A6FE8'),
    'success': ('#ECFDF5', '#A7F3D0', '#047857', '#059669'),
    'warning': ('#FFFBEB', '#FDE68A', '#B45309', '#D97706'),
    'danger':  ('#FEF2F2', '#FECACA', '#C0362C', '#DC2626'),
}

MODE = 'make'   # 'make' | 'preview'


def V(expr, sample):
    """Ein Wert in zwei Fassungen: Make-Ausdruck und Beispielwert."""
    return expr if MODE == 'make' else sample


# ---------------------------------------------------------------- Bausteine

def label(text):
    return (f'<p style="margin:0 0 4px;font-family:{F};font-size:11px;font-weight:700;'
            f'letter-spacing:0.10em;text-transform:uppercase;color:#5B6472;">{text}</p>')


def value(html, size=16, weight=600, color='#0D1F3C', lh='1.4'):
    return (f'<p style="margin:0;font-family:{F};font-size:{size}px;font-weight:{weight};'
            f'line-height:{lh};color:{color};">{html}</p>')


def detail_card(rows):
    """rows: Liste von Zeilen; jede Zeile ist eine Liste mit einem oder zwei (Label, Wert)-Paaren."""
    inner = []
    for row in rows:
        cells = []
        if len(row) == 2:
            for i, (lab, val) in enumerate(row):
                pad = '0 12px 16px 0' if i == 0 else '0 0 16px 0'
                cells.append(f'<td class="vx-col" width="50%" style="width:50%;vertical-align:top;'
                             f'padding:{pad};">{label(lab)}{val}</td>')
        else:
            lab, val = row[0]
            cells.append(f'<td style="vertical-align:top;padding:0 0 16px 0;">{label(lab)}{val}</td>')
        inner.append('<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
                     'width="100%"><tr>' + ''.join(cells) + '</tr></table>')
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            'bgcolor="#F1F4F9" style="background-color:#F1F4F9;border:1px solid #E4E6EA;'
            'border-radius:12px;margin-bottom:20px;"><tr><td style="padding:20px 22px 6px;">'
            + ''.join(inner) + '</td></tr></table>')


def hint(tone, html, bg=None, border=None, text=None, bar=None):
    """Hinweisbox. Farben koennen einzeln durch Make-Ausdruecke ersetzt werden."""
    b, bd, tx, ba = TONE[tone]
    b, bd, tx, ba = bg or b, border or bd, text or tx, bar or ba
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            f'bgcolor="{b}" style="background-color:{b};border:1px solid {bd};border-radius:10px;'
            f'margin-bottom:20px;"><tr>'
            f'<td bgcolor="{ba}" width="4" style="width:4px;background-color:{ba};font-size:0;'
            f'line-height:0;border-radius:10px 0 0 10px;">&nbsp;</td>'
            f'<td style="padding:14px 18px;font-family:{F};font-size:15px;font-weight:400;'
            f'line-height:1.6;color:{tx};">{html}</td></tr></table>')


# Wie lang die sichtbare Fassung eines Links hoechstens sein darf.
#
# Gemessen bei 390 px und 13 px Schriftgroesse: mit dem Vorspann
# "Knopf geht nicht? " bleibt eine 35 Zeichen lange Adresse einspaltig auf
# einer Zeile. Der laengere Vorspann "Knopf funktioniert nicht? " brach bei
# derselben Adresse auf zwei Zeilen um — deshalb der kuerzere. Zwei Zeilen
# Rueckfall-Link neben einem Knopf lesen sich wie ein technisches Artefakt.
URL_LIMIT = 34


def short_url(inner, sample, limit=URL_LIMIT):
    """Sichtbare Fassung eines Links: Schema weg, ab `limit` Zeichen gekuerzt.

    Die volle Adresse bleibt im href — gekuerzt wird nur, was der Empfaenger
    liest. `inner` ist der Make-Ausdruck ohne geschweifte Klammern.
    """
    bare = f'replace({inner}; "https://"; "")'
    make = ('{{if(length(' + bare + f') > {limit}; substring(' + bare
            + f'; 0; {limit}) + "…"; ' + bare + ')}}')
    plain = sample.replace('https://', '')
    return V(make, plain if len(plain) <= limit else plain[:limit] + '…')


def link(inner, sample):
    """Gibt (href, sichtbare Fassung) zurueck. `inner` ist der Make-Ausdruck
    ohne geschweifte Klammern, `sample` die Adresse fuer die Vorschau."""
    return V('{{' + inner + '}}', sample), short_url(inner, sample)


def button(href, text, label=None, note=True, full=False):
    """Aktions-Knopf mit dem Klartext-Link darunter.

    `label` ist die sichtbare Fassung des Links; ohne Angabe wird bei einer
    festen Adresse einfach das Schema abgeschnitten. Der Link traegt bewusst
    dieselbe gedaempfte Farbe wie der Hinweistext davor: er ist der Rueckfall
    fuer Clients, die Knoepfe verstuemmeln, und soll neben dem Knopf nicht als
    zweite Aktion gelesen werden.

    `full=True` schaltet die Kuerzung ab und stellt die Adresse vollstaendig
    auf eine eigene Zeile - fuer Aktivierung und Passwort-Ruecksetzung. Dort
    ist der Link kein blosser Rueckfall: die Mail kommt aufs Telefon, gemacht
    wird die Sache am Rechner, also muss die Adresse abtippbar und kopierbar
    bleiben. Sie traegt dann auch das Schema, damit das Kopierte eine
    vollstaendige Adresse ist. Der Umbruch auf zwei Zeilen ist hier der
    bewusst in Kauf genommene Preis; optisch zurueckgenommen bleibt sie.
    """
    if label is None:
        label = href if full else href.replace('https://', '')
    out = ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
           '<tr><td align="center" style="padding:2px 0 8px;">'
           '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
           f'<td align="center" bgcolor="#0D1F3C" style="background-color:#0D1F3C;border-radius:10px;">'
           f'<a href="{href}" style="display:inline-block;padding:15px 34px;font-family:{F};'
           f'font-size:16px;font-weight:700;line-height:1.2;color:#FFFFFF;text-decoration:none;'
           f'border-radius:10px;">{text}</a></td></tr></table></td></tr>')
    if note:
        out += ('<tr><td align="center" style="padding:0 0 20px;">'
                f'<p style="margin:0;font-family:{F};font-size:13px;font-weight:400;line-height:1.55;'
                f'color:#5B6472;">Knopf geht nicht? {"<br>" if full else ""}'
                f'<a href="{href}" style="color:#5B6472;text-decoration:underline;'
                f'word-break:break-all;">{label}</a></p></td></tr>')
    else:
        out += '<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>'
    return out + '</table>'


def steps(items):
    rows = []
    for i, (title, desc) in enumerate(items):
        last = (i == len(items) - 1)
        pad = '0' if last else '0 0 16px 0'
        rows.append(
            f'<tr><td width="34" style="width:34px;vertical-align:top;padding:0 14px {"0" if last else "16px"} 0;">'
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="28"><tr>'
            f'<td align="center" bgcolor="#0D1F3C" height="28" style="width:28px;height:28px;'
            f'background-color:#0D1F3C;border-radius:14px;font-family:{F};font-size:13px;'
            f'font-weight:700;color:#FFFFFF;line-height:28px;">{i+1}</td></tr></table></td>'
            f'<td style="vertical-align:top;padding:{pad};">'
            f'<p style="margin:0 0 3px;font-family:{F};font-size:16px;font-weight:700;'
            f'color:#0D1F3C;">{title}</p>'
            f'<p style="margin:0;font-family:{F};font-size:16px;font-weight:400;line-height:1.65;'
            f'color:#3D4A60;">{desc}</p></td></tr>')
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            'style="margin-bottom:24px;">' + ''.join(rows) + '</table>')


def amounts(rows, total_label, total_value):
    out = []
    for i, (lab, val, color) in enumerate(rows):
        top = '' if i == 0 else 'border-top:1px solid #EEF1F6;'
        out.append(f'<tr><td style="padding:14px 20px;{top}font-family:{F};font-size:16px;'
                   f'font-weight:400;color:{color or "#3D4A60"};">{lab}</td>'
                   f'<td align="right" style="padding:14px 20px;{top}white-space:nowrap;'
                   f'font-family:{F};font-size:16px;font-weight:600;'
                   f'color:{color or "#0D1F3C"};">{val}</td></tr>')
    out.append(f'<tr><td bgcolor="#0D1F3C" style="background-color:#0D1F3C;padding:16px 20px;'
               f'border-radius:0 0 0 11px;font-family:{F};font-size:16px;font-weight:700;'
               f'color:#FFFFFF;">{total_label}</td>'
               f'<td bgcolor="#0D1F3C" align="right" style="background-color:#0D1F3C;'
               f'padding:16px 20px;border-radius:0 0 11px 0;white-space:nowrap;font-family:{F};'
               f'font-size:20px;font-weight:700;color:#FFFFFF;">{total_value}</td></tr>')
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            'bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E4E6EA;'
            'border-radius:12px;margin-bottom:24px;">' + ''.join(out) + '</table>')


def figure(lab, val, sub=''):
    s = (f'<p style="margin:0;font-family:{F};font-size:14px;color:#A9B6CC;">{sub}</p>') if sub else ''
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            'bgcolor="#0D1F3C" style="background-color:#0D1F3C;border-radius:12px;'
            'margin-bottom:20px;"><tr><td style="padding:18px 22px;">'
            f'<p style="margin:0 0 8px;font-family:{F};font-size:11px;font-weight:700;'
            f'letter-spacing:0.16em;text-transform:uppercase;color:#E8C547;">{lab}</p>'
            f'<p style="margin:0 0 4px;font-family:{F};font-size:24px;font-weight:700;'
            f'letter-spacing:0.03em;color:#FFFFFF;">{val}</p>{s}</td></tr></table>')


def badge(bg, fg, text):
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td bgcolor="{bg}" style="background-color:{bg};border-radius:6px;padding:5px 13px;'
            f'font-family:{F};font-size:12px;font-weight:700;letter-spacing:0.03em;'
            f'color:{fg};">{text}</td></tr></table>')


def prose(html, mb=24):
    return (f'<p style="margin:0 0 {mb}px;font-family:{F};font-size:16px;font-weight:400;'
            f'line-height:1.7;color:#3D4A60;">{html}</p>')


def greeting(text):
    return (f'<p style="margin:0 0 8px;font-family:{F};font-size:20px;font-weight:700;'
            f'letter-spacing:-0.02em;color:#0D1F3C;">{text}</p>')


def section(text):
    return (f'<p style="margin:0 0 12px;font-family:{F};font-size:17px;font-weight:700;'
            f'letter-spacing:-0.01em;color:#0D1F3C;">{text}</p>')


def divider_note(html):
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
            '<tr><td height="1" bgcolor="#E4E6EA" style="height:1px;line-height:1px;font-size:0;'
            'background-color:#E4E6EA;">&nbsp;</td></tr></table>'
            f'<p style="margin:18px 0 0;font-family:{F};font-size:14px;font-weight:400;'
            f'line-height:1.6;color:#5B6472;">{html}</p>')


# ---------------------------------------------------------------- Geruest

FOOTER = (
    '<tr><td class="vx-pad" align="center" bgcolor="#F7F8FA" style="background-color:#F7F8FA;'
    'border-top:1px solid #E4E6EA;padding:18px 32px 20px;border-radius:0 0 13px 13px;">'
    f'<p style="margin:0;font-family:{F};font-size:12px;font-weight:400;line-height:1.8;'
    'color:#5B6472;">&copy; 2026 Voxera &middot; Swiss Trust Tech<br>'
    '<a href="https://voxera.ch" style="color:#5B6472;text-decoration:underline;">voxera.ch</a> &middot; '
    '<a href="mailto:info@voxera.ch" style="color:#5B6472;text-decoration:underline;">info@voxera.ch</a><br>'
    '<a href="https://voxera.ch/datenschutz" style="color:#5B6472;text-decoration:underline;">Datenschutz</a> &middot; '
    '<a href="https://voxera.ch/agb" style="color:#5B6472;text-decoration:underline;">AGB</a> &middot; '
    '<a href="https://voxera.ch/impressum" style="color:#5B6472;text-decoration:underline;">Impressum</a>'
    '</p></td></tr>')


def document(title, header_note, eyebrow, accent, headline, subline, preheader, blocks, note=None):
    # Bloecke durch Leerzeilen trennen, damit Diffs lesbar bleiben. Innerhalb
    # eines Blocks wird nicht umbrochen: die Rabattzeile ist ein Make-Ausdruck,
    # ein Zeilenumbruch mitten in dessen String-Literal wuerde ihn zerlegen.
    body = '\n\n'.join(blocks)
    note_block = ('<tr><td class="vx-pad" bgcolor="#FFFFFF" style="background-color:#FFFFFF;'
                  f'padding:20px 32px 24px;">{divider_note(note)}</td></tr>') if note else ''
    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{title}</title>
<!--
{header_note}

  Der <style>-Block traegt AUSSCHLIESSLICH mobile Polsterung. Faellt er weg
  (Gmail entfernt <head>-Styles in einem Teil der Ansichten), bleibt das
  Layout vollstaendig korrekt. Alles, was traegt, steht inline.
-->
<style type="text/css">
  @media only screen and (max-width:620px){{
    .vx-pad{{padding-left:20px!important;padding-right:20px!important;}}
    .vx-title{{font-size:22px!important;}}
    .vx-col{{display:block!important;width:100%!important;padding-right:0!important;padding-bottom:14px!important;}}
  }}
</style>
</head>
<body style="margin:0;padding:0;background-color:#F7F8FA;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F7F8FA;">{preheader}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#F7F8FA" style="background-color:#F7F8FA;">
<tr><td align="center" style="padding:24px 12px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E4E6EA;border-radius:14px;">

<tr><td bgcolor="#E8C547" height="3" style="background-color:#E8C547;height:3px;line-height:3px;font-size:0;border-radius:13px 13px 0 0;">&nbsp;</td></tr>

<tr><td class="vx-pad" bgcolor="#0D1F3C" style="background-color:#0D1F3C;padding:26px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:20px;">
    <tr>
      <td align="left" style="vertical-align:middle;">
        <img src="{LOGO}" alt="Voxera" width="30" height="30" style="display:inline-block;vertical-align:middle;margin-right:10px;border:0;border-radius:8px;">
        <span style="font-family:{F};font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#FFFFFF;vertical-align:middle;">VOXERA</span>
      </td>
      <td align="right" style="vertical-align:middle;">
        <span style="font-family:{F};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:{accent};">{eyebrow}</span>
      </td>
    </tr>
  </table>
  <p class="vx-title" style="margin:0 0 7px;font-family:{F};font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-0.02em;color:#FFFFFF;">{headline}</p>
  <p style="margin:0;font-family:{F};font-size:15px;font-weight:400;line-height:1.55;color:#A9B6CC;">{subline}</p>
</td></tr>

<tr><td class="vx-pad" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:28px 32px 4px;">
{body}
</td></tr>
{note_block}{FOOTER}
</table>
</td></tr>
</table>

</body>
</html>
'''


# ---------------------------------------------------------------- Vorlagen

def t_invoice():
    # Kein separater Anrede-Block: email.body_text traegt die Anrede bereits
    # (invoice-mail-copy.js -> recipientGreeting). Bisher stand sie doppelt.
    eyebrow = V('{{if(1.mail_type = "reminder_final_email"; "Letzte Mahnung"; if(1.mail_type = "reminder_email"; "Zahlungserinnerung"; "Rechnung"))}}', 'Zahlungserinnerung')
    accent = V('{{if(1.mail_type = "reminder_final_email"; "#FCA5A5"; "#A9B6CC")}}', NEUTRAL)
    headline = V('{{if(1.mail_type = "reminder_final_email"; "Letzte Mahnung."; if(1.mail_type = "reminder_email"; "Zahlungserinnerung."; "Ihre Rechnung."))}}', 'Zahlungserinnerung.')
    num = V('{{1.invoice.invoice_number}}', '2026-0417')
    # Zeilenumbrueche serverseitig setzen. white-space:pre-line wertet die
    # Word-Engine hinter Outlook nicht aus - dort lief die Mahnung sonst zu
    # einem einzigen Absatz zusammen.
    body = V('{{replace(1.email.body_text; newline; "<br>")}}',
             'Guten Tag Marc Schneider<br><br>Bei der Durchsicht unserer offenen Posten haben wir '
             'festgestellt, dass die Rechnung 2026-0417 über CHF 290.00, fällig am 20.08.2026, noch '
             'nicht beglichen wurde.<br><br>Die Rechnung finden Sie nochmals im Anhang. Wir bitten Sie, '
             'den offenen Betrag in den nächsten Tagen zu überweisen.<br><br>Falls Sie die Zahlung '
             'bereits veranlasst haben, können Sie diese Nachricht als gegenstandslos betrachten.'
             '<br><br>Freundliche Grüsse<br>Voxera')
    tone_bg = V('{{if(1.mail_type = "reminder_final_email"; "#FEF2F2"; if(1.mail_type = "reminder_email"; "#FFFBEB"; "#EEF4FF"))}}', TONE['warning'][0])
    tone_bd = V('{{if(1.mail_type = "reminder_final_email"; "#FECACA"; if(1.mail_type = "reminder_email"; "#FDE68A"; "#BFDBFE"))}}', TONE['warning'][1])
    tone_tx = V('{{if(1.mail_type = "reminder_final_email"; "#C0362C"; if(1.mail_type = "reminder_email"; "#B45309"; "#1558BF"))}}', TONE['warning'][2])
    tone_ba = V('{{if(1.mail_type = "reminder_final_email"; "#DC2626"; if(1.mail_type = "reminder_email"; "#D97706"; "#1A6FE8"))}}', TONE['warning'][3])
    return document(
        'Ihre Voxera Rechnung',
        '  Voxera E-Mail-Vorlage · mail_type: invoice_email, reminder_email, reminder_final_email\n'
        '  Make-Szenario 09 (5239089) · Route 1 · Modul 21 · Feld "html"',
        eyebrow, accent, headline, f'Rechnung {num}',
        V('Rechnung {{1.invoice.invoice_number}} über {{1.invoice.currency}} {{1.invoice.amount}}.',
          'Rechnung 2026-0417 über CHF 290.00.'),
        [
            prose(body),
            detail_card([
                [('Rechnungsnummer', value(num)),
                 ('Betrag', value(V('{{1.invoice.currency}} {{1.invoice.amount}}', 'CHF 290.00')))],
                [('Fällig', value(V('{{formatDate(1.invoice.due_at; "DD.MM.YYYY"; "Europe/Zurich")}}', '20.08.2026')))],
            ]),
            hint('info', 'Die Rechnung liegt dieser E-Mail als PDF bei. <strong>Sämtliche '
                 'Zahlungsangaben inklusive Swiss-QR-Code finden Sie auf der Rechnung.</strong>',
                 bg=tone_bg, border=tone_bd, text=tone_tx, bar=tone_ba),
        ],
        note='Fragen zur Rechnung? Schreiben Sie an <a href="mailto:info@voxera.ch" '
             'style="color:#1A6FE8;text-decoration:underline;">info@voxera.ch</a> — wir klären das gerne.')


def t_contract_expired():
    end = V('{{formatDate(1.contract_end_date; "DD.MM.YYYY"; "Europe/Zurich")}}', '31.07.2026')
    assistant = V('{{if(1.assistant_name; 1.assistant_name; "Ihr Telefonassistent")}}', 'Lara')
    return document(
        'Ihr Voxera-Vertrag ist abgelaufen',
        '  Voxera E-Mail-Vorlage · mail_type: contract_expired_email\n'
        '  Make-Szenario 09 (5239089) · Route 2 · Modul 18 · Feld "html"',
        'Vertragsende', RED, 'Ihr Voxera-Abonnement<br>ist abgelaufen.',
        V('{{if(1.assistant_name; 1.assistant_name + " ist ab sofort nicht mehr aktiv."; "Ihr Telefonassistent ist ab sofort nicht mehr aktiv.")}}',
          'Lara ist ab sofort nicht mehr aktiv.'),
        V('Ihr Voxera-Abonnement ist per {{formatDate(1.contract_end_date; "DD.MM.YYYY"; "Europe/Zurich")}} abgelaufen.',
          'Ihr Voxera-Abonnement ist per 31.07.2026 abgelaufen.'),
        [
            greeting(V('Guten Tag, {{1.recipient_name}}', 'Guten Tag, Marc Schneider')),
            prose(f'wir möchten Sie informieren, dass Ihr Voxera-Abonnement per <strong>{end}</strong> '
                  'planmässig abgelaufen ist.'),
            detail_card([
                [('Firma', value(V('{{1.customer.customer_name}}', 'Schneider Sanitär AG'))),
                 ('Paket', value(V('{{1.customer.plan_label}}', 'Professional')))],
                [('Vertragsende', value(end))],
            ]),
            hint('danger', f'<strong>Was das für Sie bedeutet.</strong> {assistant} nimmt ab sofort keine '
                 'Anrufe mehr entgegen. Ihre Daten werden gemäss der für Ihr Konto geltenden '
                 'Aufbewahrungsfrist gespeichert.'),
            button('https://voxera.ch/kontakt', 'Abonnement verlängern'),
        ],
        note='Möchten Sie Voxera weiter nutzen? Wir erstellen Ihnen gerne eine neue Offerte — eine '
             'kurze Nachricht an <a href="mailto:info@voxera.ch" style="color:#1A6FE8;'
             'text-decoration:underline;">info@voxera.ch</a> genügt.')


def t_password_changed():
    dash, dash_label = link('if(1.dashboard_url; 1.dashboard_url; "https://dashboard.voxera.ch")', 'https://dashboard.voxera.ch')
    return document(
        'Passwort geändert – Voxera',
        '  Voxera E-Mail-Vorlage · mail_type: password_changed_email\n'
        '  Make-Szenario 09 (5239089) · Route 3 · Modul 40 · Feld "html"',
        'Sicherheit', GREEN, 'Passwort erfolgreich<br>geändert.',
        'Ihr Voxera-Konto ist gesichert.',
        'Ihr Voxera-Passwort wurde soeben geändert.',
        [
            prose('Ihr Passwort wurde erfolgreich aktualisiert. Sie können sich ab sofort mit dem '
                  'neuen Passwort anmelden.'),
            detail_card([
                [('Konto', value(V('{{1.recipient.email}}', 'marc.schneider@schneider-sanitaer.ch'))),
                 ('Geändert am', value(V('{{formatDate(now; "DD.MM.YYYY, HH:mm"; "Europe/Zurich")}} Uhr', '09.08.2026, 17:24 Uhr')))],
            ]),
            hint('danger', '<strong>Waren Sie das nicht?</strong> Dann melden Sie sich bitte sofort bei '
                 'uns: <a href="mailto:info@voxera.ch" style="color:#C0362C;text-decoration:underline;">'
                 'info@voxera.ch</a>. Wir sperren den Zugang und klären den Vorfall mit Ihnen.'),
            button(dash, 'Zum Dashboard', dash_label),
        ])


def t_password_reset():
    reset_link = (V('{{1.activation_link}}', 'https://dashboard.voxera.ch/reset/8c31-77ab'),)
    return document(
        'Passwort zurücksetzen – Voxera',
        '  Voxera E-Mail-Vorlage · mail_type: password_reset\n'
        '  Make-Szenario 09 (5239089) · Route 6 · Modul 51 · Feld "html"',
        'Sicherheit', NEUTRAL, 'Passwort<br>zurücksetzen.',
        'Sicherer Zugang zu Ihrem Voxera-Konto.',
        'Link zum Zurücksetzen Ihres Voxera-Passworts.',
        [
            prose('für Ihr Voxera-Konto wurde ein Link zum Zurücksetzen des Passworts angefordert. '
                  'Klicken Sie auf den Knopf, um ein neues Passwort zu vergeben.'),
            detail_card([
                [('Konto', value(V('{{1.recipient.email}}', 'marc.schneider@schneider-sanitaer.ch'))),
                 ('Angefordert am', value(V('{{formatDate(now; "DD.MM.YYYY, HH:mm"; "Europe/Zurich")}} Uhr', '09.08.2026, 17:24 Uhr')))],
            ]),
            # Passwort-Ruecksetzung: volle Adresse, siehe button(full=True)
            button(reset_link[0], 'Passwort zurücksetzen', full=True),
            hint('info', '<strong>Waren Sie das nicht?</strong> Dann können Sie diese E-Mail ignorieren '
                 '— Ihr Passwort bleibt unverändert. Bei Fragen erreichen Sie uns unter '
                 '<a href="mailto:info@voxera.ch" style="color:#1558BF;text-decoration:underline;">'
                 'info@voxera.ch</a>.'),
        ])


def t_assistant_updated():
    dash, dash_label = link('if(1.dashboard_url; 1.dashboard_url; "https://dashboard.voxera.ch")', 'https://dashboard.voxera.ch')
    return document(
        'Ihr KI-Assistent wurde aktualisiert',
        '  Voxera E-Mail-Vorlage · mail_type: assistant_updated_email\n'
        '  Make-Szenario 09 (5239089) · Route 4 · Modul 41 · Feld "html"',
        'Assistent', NEUTRAL, 'Ihr KI-Assistent<br>wurde aktualisiert.',
        V('{{if(1.assistant.sync_status = "synced"; "Die neuen Einstellungen sind ab sofort aktiv."; "Die Änderungen wurden gespeichert und werden aktuell synchronisiert.")}}',
          'Die neuen Einstellungen sind ab sofort aktiv.'),
        'Die Konfiguration Ihres Voxera-Assistenten wurde angepasst.',
        [
            prose('wir haben die Konfiguration Ihres persönlichen KI-Assistenten angepasst. '
                  'Nachfolgend sehen Sie den aktuellen Stand.'),
            detail_card([
                [('Ihr Unternehmen', value(V('{{if(1.assistant.business_description; 1.assistant.business_description; 1.ai_business_description)}}',
                                             'Sanitär- und Heizungsinstallationen für Privat- und Geschäftskunden in Zürich und Umgebung. Notfalldienst rund um die Uhr.'),
                                           weight=400, color='#3D4A60', lh='1.6'))],
                [('Instruktionen', value(V('{{if(1.assistant.instructions; 1.assistant.instructions; 1.ai_instructions)}}',
                                           'Anrufer freundlich begrüssen, Anliegen aufnehmen, bei Notfällen sofort auf die Notfallnummer verweisen. Keine Preisauskünfte am Telefon.'),
                                         weight=400, color='#3D4A60', lh='1.6'))],
            ]),
            hint('info', 'Diese Einstellungen können Sie jederzeit selbst im Dashboard anpassen. '
                 'Änderungen werden innerhalb weniger Minuten übernommen.'),
            button(dash, 'Im Dashboard öffnen', dash_label),
        ])


def t_welcome():
    activate = V('{{1.activation_link}}', 'https://dashboard.voxera.ch/aktivieren/4d17-2b90')
    num = V('{{1.voxera_number}}', '+41445053662')
    return document(
        'Willkommen bei Voxera',
        '  Voxera E-Mail-Vorlage · mail_type: welcome\n'
        '  Make-Szenario 09 (5239089) · Route 5 · Modul 50 · Feld "html"',
        'Willkommen', GOLD, 'Ihr KI-Assistent<br>ist bereit für Sie.',
        'Ab heute nimmt Voxera Ihre Anrufe entgegen — professionell, rund um die Uhr.',
        'Zwei Schritte, dann ist Ihr Voxera-Assistent aktiv.',
        [
            greeting(V('Guten Tag, {{1.customer_name}}', 'Guten Tag, Marc Schneider')),
            prose('herzlich willkommen bei Voxera. Ihr persönlicher KI-Telefonassistent ist '
                  'eingerichtet. Zwei Schritte, dann ist alles aktiv.'),

            section('Schritt 1 — Passwort setzen und einloggen'),
            prose('Klicken Sie auf den Knopf, vergeben Sie ein Passwort und melden Sie sich an.', mb=16),
            detail_card([
                [('Ihre E-Mail', value(V('{{1.email}}', 'marc.schneider@schneider-sanitaer.ch'))),
                 ('Dashboard', value(V('{{if(1.dashboard_url; replace(replace(1.dashboard_url; "https://"; ""); "/"; ""); "dashboard.voxera.ch")}}', 'dashboard.voxera.ch')))],
            ]),
            # Aktivierung: volle Adresse, siehe button(full=True)
            button(activate, 'Konto aktivieren', full=True),
            hint('warning', 'Der Aktivierungslink ist <strong>24 Stunden gültig</strong>. Danach '
                 'fordern Sie über die Anmeldeseite einen neuen an.'),

            section('Schritt 2 — Rufumleitung einrichten'),
            prose('Öffnen Sie die Telefon-App, tippen Sie den Code ein und bestätigen Sie mit '
                  '<strong>Wählen</strong>. Das dauert unter 30 Sekunden.', mb=16),
            figure('Ihre Voxera-Nummer', num, 'Genau so eingeben — keine Leerzeichen.'),
            figure('Weiterleitungs-Code bei Nichtannahme', f'**61*{num}#',
                   'Funktioniert bei Swisscom, Sunrise und Salt.'),
            prose('Nach dem Wählen erhalten Sie einen Bestätigungston oder eine kurze Meldung. '
                  'Rufen Sie danach einmal Ihre Geschäftsnummer an — Voxera meldet sich. '
                  'Anbieter-spezifische Anleitungen finden Sie nach dem Login im Dashboard '
                  'unter <strong>Einrichtung</strong>.'),
        ],
        note='Fragen zur Einrichtung? Schreiben Sie an <a href="mailto:info@voxera.ch" '
             'style="color:#1A6FE8;text-decoration:underline;">info@voxera.ch</a> — wir helfen gerne.')


def t_contract_signed():
    signed = link('1.contract.signed_page_url', 'https://voxera.ch/vertrag/7b12-9e04')
    months = V('{{1.contract.duration_months}}', '12')
    return document(
        'Ihr unterzeichneter Voxera-Vertrag',
        '  Voxera E-Mail-Vorlage · mail_type: contract_signed_email\n'
        '  Make-Szenario 09 (5239089) · Route 8 · Modul 54 (mit PDF)\n'
        '                                 · Route 9 · Modul 55 (ohne PDF, zusaetzlich Alias countersign_email)\n'
        '  Derselbe Inhalt wird in beide Module eingesetzt.',
        'Vertrag', GOLD, 'Herzlich willkommen<br>bei Voxera.',
        'Ihr Vertrag wurde beidseitig unterzeichnet.',
        'Ihr Voxera-Vertrag ist beidseitig unterzeichnet.',
        [
            greeting(V('Willkommen, {{1.recipient.name}}', 'Willkommen, Marc Schneider')),
            prose('vielen Dank, dass Sie sich für Voxera entschieden haben. Nachfolgend finden Sie '
                  'Ihre Vertragsdetails und die nächsten Schritte bis zum Go-live.'),
            hint('success', 'Ihr Vertrag ist beidseitig unterzeichnet und rechtsgültig abgeschlossen. '
                 'Wir melden uns in Kürze bei Ihnen.'),
            detail_card([
                [('Firma', value(V('{{1.contract.customer_name}}', 'Schneider Sanitär AG'))),
                 ('Paket', value(V('{{capitalize(1.contract.plan)}}', 'Professional')))],
                [('Vertragsbeginn', value(V('{{formatDate(1.contract.start_date; "DD.MM.YYYY"; "Europe/Zurich")}}', '01.09.2026'))),
                 ('Laufzeit', value(f'{months} Monate'))],
                [('Beidseitig unterzeichnet am', value(V('{{formatDate(1.contract.countersigned_at; "DD.MM.YYYY"; "Europe/Zurich")}}', '09.08.2026')))],
            ]),
            button(*signed[:1], 'Unterzeichneten Vertrag ansehen', signed[1]),
            section('So geht es weiter'),
            steps([
                ('Assistent und Attribute festlegen',
                 'Wir besprechen gemeinsam, wie Ihr KI-Assistent auftreten soll — Begrüssung, Anliegen, '
                 'Kategorien. Erst wenn alles passt, geht es weiter.'),
                ('Zugangsdaten erhalten',
                 'Sobald Ihr Assistent konfiguriert ist, erhalten Sie Ihre persönlichen '
                 'Dashboard-Zugangsdaten per E-Mail.'),
                ('Weiterleitung einrichten',
                 'Sie richten einmalig eine Rufumleitung auf Ihre Voxera-Nummer ein — direkt geführt '
                 'im Dashboard. Dauert unter zwei Minuten.'),
                ('Voxera ist live',
                 'Ab sofort übernimmt Voxera Ihre Anrufe — je nach Einstellung bei Nichtannahme, '
                 'besetzt oder immer. Kein Anruf geht mehr verloren.'),
            ]),
            hint('info', f'<strong>Kündigungsrichtlinien.</strong> Die Mindestlaufzeit beträgt {months} '
                 'Monate. Eine Kündigung ist mit einer Frist von einem Monat vor Vertragsende möglich. '
                 'Danach verlängert sich der Vertrag monatlich und ist jederzeit mit einem Monat Frist '
                 'kündbar. Kündigungen bitte schriftlich an '
                 '<a href="mailto:info@voxera.ch" style="color:#1558BF;text-decoration:underline;">'
                 'info@voxera.ch</a>.'),
        ],
        note='Diese E-Mail dient als Vertragsbestätigung. Es gelten die '
             '<a href="https://voxera.ch/agb" style="color:#1A6FE8;text-decoration:underline;">'
             'Allgemeinen Geschäftsbedingungen von Voxera</a>.')


def t_ai_change_request():
    admin, admin_label = link('if(1.admin_url; 1.admin_url; "https://admin.voxera.ch")', 'https://admin.voxera.ch')
    return document(
        'Neue KI-Änderungsanfrage',
        '  Voxera E-Mail-Vorlage · mail_type: ai_change_request  (INTERN, an info@voxera.ch)\n'
        '  Make-Szenario 09 (5239089) · Route 7 · Modul 52 · Feld "html"',
        'Änderungsanfrage', NEUTRAL, 'Neue<br>KI-Änderungsanfrage.',
        V('{{1.customer_name}} hat eine Anpassung angefordert.', 'Schneider Sanitär AG hat eine Anpassung angefordert.'),
        V('Änderungsanfrage von {{1.customer_name}}.', 'Änderungsanfrage von Schneider Sanitär AG.'),
        [
            detail_card([
                [('Kunde', value(V('{{1.customer_name}}', 'Schneider Sanitär AG'))),
                 ('Kunden-ID', value(V('{{1.customer_id}}', 'cus_8f31a2'), size=14))],
                [('Anfrage', value(V('{{1.message}}', 'Lara soll bei Notfällen ausserhalb der Öffnungszeiten direkt auf die Handynummer von Herrn Schneider verweisen statt nur eine Nachricht aufzunehmen.'),
                                   weight=400, color='#3D4A60', lh='1.6'))],
            ]),
            button(admin, 'Im Admin-Portal öffnen', admin_label),
        ])


def t_fallback():
    return document(
        'Voxera Mail Engine: unbekannter mail_type',
        '  Voxera E-Mail-Vorlage · Fallback-Alarm  (INTERN, an info@voxera.ch)\n'
        '  Make-Szenario 09 (5239089) · Route 10 · Modul 99 · Feld "html"',
        'Alarm', RED, 'Unbekannter<br>mail_type.',
        'Der Webhook wurde empfangen, aber keiner Versandroute zugeordnet.',
        V('Mail Engine: mail_type {{1.mail_type}} konnte nicht zugeordnet werden.',
          'Mail Engine: mail_type offer_mail konnte nicht zugeordnet werden.'),
        [
            hint('danger', '<strong>Es wurde keine Kundenmail versendet.</strong> Der auslösende '
                 'Netlify- oder Supabase-Prozess hat einen <code>mail_type</code> geschickt, den '
                 'Szenario 09 nicht kennt.'),
            detail_card([
                [('mail_type', value(V('{{1.mail_type}}', 'offer_mail'))),
                 ('Empfänger', value(V('{{1.recipient.email}}', 'marc.schneider@schneider-sanitaer.ch'), size=14))],
                [('Zeitpunkt', value(V('{{formatDate(now; "DD.MM.YYYY, HH:mm"; "Europe/Zurich")}} Uhr', '09.08.2026, 17:24 Uhr')))],
            ]),
        ],
        note='Zu prüfen: <code>config/mail-engine-contracts.json</code>, die Liste '
             '<code>MAIL_ENGINE_TYPES</code> in <code>_lib/mail-delivery.js</code> und die '
             'Router-Filter in Szenario 09.')


# --- Anruf-Vorlagen: gleiche Feldnamen in Szenario 09 und Szenario 01 ---

CATEGORY_LABEL = ('{{if(lower(1.category) = "rueckrufanfrage"; "Rückrufanfrage"; '
                  'if(lower(1.category) = "terminanfrage"; "Terminanfrage"; '
                  'if(lower(1.category) = "informationsanfrage"; "Informationsanfrage"; '
                  'if(lower(1.category) = "offertenanfrage"; "Offertenanfrage"; '
                  'if(lower(1.category) = "beschwerde"; "Beschwerde"; '
                  'if(lower(1.category) = "aenderung_kuendigung"; "Änderung / Kündigung"; '
                  'if(lower(1.category) = "notfall"; "Notfall"; '
                  'if(lower(1.category) = "sonstiges"; "Sonstiges"; 1.category))))))))}}')

# Gold-Rampe aus customer-design-tokens.css. Vergleich kleingeschrieben:
# die Datenbank schreibt hot/warm/cold klein.
LEAD_BG = '{{if(lower(1.lead_quality) = "hot"; "#E8C547"; if(lower(1.lead_quality) = "warm"; "#FBF1D8"; "#EEF2F7"))}}'
LEAD_FG = '{{if(lower(1.lead_quality) = "hot"; "#0D1F3C"; if(lower(1.lead_quality) = "warm"; "#7A5C00"; "#5B6472"))}}'
LEAD_TX = ('{{if(lower(1.lead_quality) = "hot"; "Heiss"; if(lower(1.lead_quality) = "warm"; "Warm"; '
           'if(lower(1.lead_quality) = "cold"; "Kalt"; "—")))}}')


def call_detail(phone_color):
    lead = badge(V(LEAD_BG, '#E8C547'), V(LEAD_FG, '#0D1F3C'), V(LEAD_TX, 'Heiss'))
    return detail_card([
        [('Anrufer', value(V('{{1.caller_name}}', 'Frau Bergmann'))),
         ('Telefonnummer', value(V('{{1.caller_phone}}', '+41 79 926 89 33'), size=18, weight=700, color=phone_color))],
        [('Zeitpunkt', value(V('{{formatDate(now; "DD.MM.YYYY, HH:mm"; "Europe/Zurich")}} Uhr', '09.08.2026, 17:24 Uhr'))),
         ('Gesprächsdauer', value(V('{{if(1.duration_seconds > 0; round(1.duration_seconds / 60) & " Min."; "–")}}', '3 Min.')))],
        [('Kategorie', value(V(CATEGORY_LABEL, 'Offertenanfrage'))),
         ('Lead-Qualität', lead)],
        [('Gesprächszusammenfassung', value(V('{{1.call_summary}}',
                                              'Frau Bergmann möchte eine Offerte für den Ersatz von zwei Badezimmer-Armaturen in einem Mehrfamilienhaus. Sie ist ab Montag erreichbar und bittet um Rückmeldung bis Ende Woche.'),
                                            weight=400, color='#3D4A60', lh='1.6'))],
    ])


CALL_NOTE = ('  Feldnamen sind in beiden Szenarien identisch (Modul 1 ist jeweils der Webhook),\n'
             '  derselbe Inhalt laeuft deshalb an beiden Orten.')


def t_call_notification():
    return document(
        'Neuer Anruf – Voxera',
        '  Voxera E-Mail-Vorlage · mail_type: call_notification_email\n'
        '  Make-Szenario 09 (5239089) · Route 12 · Modul 100 · Feld "html"\n'
        '  Make-Szenario 01 (5109958) · Route "Normal Call" · Modul 14 · Feld "html"\n'
        + CALL_NOTE,
        'Neuer Anruf', NEUTRAL, 'Neuer Anruf<br>eingegangen.',
        'Voxera hat einen Anruf für Sie entgegengenommen.',
        V('Neuer Anruf von {{1.caller_name}}.', 'Neuer Anruf von Frau Bergmann.'),
        [
            call_detail('#0D1F3C'),
            button('https://dashboard.voxera.ch', 'Im Dashboard öffnen'),
        ],
        note='Sie erhalten diese E-Mail, weil die Benachrichtigung bei neuen Anrufen in Ihren '
             'Einstellungen aktiv ist.')


def t_callback_request():
    phone = V('{{1.caller_phone}}', '+41 79 926 89 33')
    caller = V('{{1.caller_name}}', 'Frau Bergmann')
    return document(
        'Rückruf angefordert – Voxera',
        '  Voxera E-Mail-Vorlage · mail_type: callback_request_email\n'
        '  Make-Szenario 09 (5239089) · Route 11 · Modul 101 · Feld "html"\n'
        '  Make-Szenario 01 (5109958) · Route "Callback TRUE" · Modul 6 · Feld "html"\n'
        + CALL_NOTE + '\n\n'
        '  Betreff ohne Bedingung: "Rückruf angefordert – Voxera".\n'
        '  Die Route waehlt bereits ueber mail_type bzw. callback_requested aus; der frueher hier\n'
        '  stehende zweite Test auf callback_requested konnte nur danebengreifen.',
        'Rückruf', RED, 'Rückruf<br>gewünscht.',
        f'{caller} wartet auf Ihren Rückruf.',
        V('{{1.caller_name}} bittet um Rückruf: {{1.caller_phone}}', 'Frau Bergmann bittet um Rückruf: +41 79 926 89 33'),
        [
            call_detail('#C0362C'),
            hint('danger', f'<strong>Bitte zeitnah zurückrufen.</strong> {caller} hat ausdrücklich '
                 f'einen Rückruf gewünscht: <strong>{phone}</strong>'),
            button('https://dashboard.voxera.ch', 'Im Dashboard öffnen'),
        ],
        note='Sie erhalten diese E-Mail, weil die Rückruf-Benachrichtigung in Ihren Einstellungen '
             'aktiv ist.')


def t_offer():
    valid = V('{{formatDate(1.offer.valid_until; "DD.MM.YYYY"; "Europe/Zurich")}}', '31.08.2026')
    url, url_label = link('1.offer.acceptance_url', 'https://voxera.ch/offerte/9f2c-4a71')
    cycle = V('{{if(1.offer.billing_cycle = "yearly"; "Jährlich"; "Monatlich")}}', 'Monatlich')
    # Die Rabattzeile erscheint nur, wenn ein Rabatt vorliegt. Einziger Ausdruck
    # im Vorlagensatz, der Markup zurueckgibt; Attribute deshalb in Hochkommas.
    disc_make = ('{{if(1.offer.discount_amount > 0; "<tr><td style=\'padding:14px 20px;'
                 'border-top:1px solid #EEF1F6;font-family:' + F.replace("'", "") + ";font-size:16px;"
                 "font-weight:400;color:#047857;'>Rabatt</td><td align='right' style='padding:14px 20px;"
                 "border-top:1px solid #EEF1F6;white-space:nowrap;font-family:" + F.replace("'", "") +
                 ";font-size:16px;font-weight:600;color:#047857;'>&minus; CHF \" + "
                 'formatNumber(1.offer.discount_amount; 2; "."; "\'") + "</td></tr>"; "")}}')
    disc_preview = (f'<tr><td style="padding:14px 20px;border-top:1px solid #EEF1F6;font-family:{F};'
                    'font-size:16px;font-weight:400;color:#047857;">Rabatt</td>'
                    f'<td align="right" style="padding:14px 20px;border-top:1px solid #EEF1F6;'
                    f'white-space:nowrap;font-family:{F};font-size:16px;font-weight:600;'
                    'color:#047857;">&minus; CHF 100.00</td></tr>')
    price = amounts(
        [('Einmalige Einrichtung',
          V('{{if(1.offer.setup_fee > 0; "CHF " + formatNumber(1.offer.setup_fee; 2; "."; "\'"); "Inbegriffen")}}', 'CHF 890.00'), None),
         (cycle, 'CHF ' + V('{{formatNumber(if(1.offer.billing_cycle = "yearly"; 1.offer.yearly_price; 1.offer.monthly_price); 2; "."; "\'")}}', "290.00"), None)],
        'Gesamt',
        'CHF ' + V('{{formatNumber(1.offer.setup_fee + if(1.offer.billing_cycle = "yearly"; 1.offer.yearly_price; 1.offer.monthly_price) - if(1.offer.discount_amount > 0; 1.offer.discount_amount; 0); 2; "."; "\'")}}', "1'080.00"))
    # Rabattzeile vor der Summenzeile einhaengen
    marker = '<tr><td bgcolor="#0D1F3C" style="background-color:#0D1F3C;padding:16px 20px;border-radius:0 0 0 11px;'
    price = price.replace(marker, V(disc_make, disc_preview) + marker, 1)
    return document(
        'Ihre Voxera Offerte',
        '  Voxera E-Mail-Vorlage · mail_type: offer_email\n'
        '  Make-Szenario 09 (5239089) · Route 0 · Modul 10 · Feld "html"',
        'Offerte', GOLD, 'Ihre persönliche Offerte<br>ist bereit.',
        'Vielen Dank für Ihr Interesse an Voxera.',
        f'Ihre persönliche Voxera Offerte, gültig bis {valid}.',
        [
            greeting(V('Guten Tag, {{1.recipient.name}}', 'Guten Tag, Marc Schneider')),
            prose(V('{{if(1.offer.introduction; 1.offer.introduction; "Nachfolgend finden Sie Ihre persönliche Offerte. Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.")}}',
                    'gerne unterbreiten wir Ihnen nach unserem Telefonat die Offerte für Ihren '
                    'Voxera-Telefonassistenten. Die Konditionen gelten wie besprochen.')),
            detail_card([
                [('Firma', value(V('{{1.customer.company_name}}', 'Schneider Sanitär AG'))),
                 ('Paket', value(V('{{capitalize(1.offer.plan)}}', 'Professional')))],
                [('Abrechnung', value(cycle)),
                 ('Laufzeit', value(V('{{1.offer.duration_months}}', '12') + ' Monate'))],
                [('Gültig bis', value(valid))],
            ]),
            price,
            button(url, 'Offerte einsehen &amp; unterzeichnen', url_label),
            hint('info', f'Diese Offerte ist bis <strong>{valid}</strong> gültig. Bei Annahme '
                 'erhalten Sie umgehend eine Bestätigung.'),
        ],
        note='Fragen zur Offerte? Schreiben Sie an <a href="mailto:info@voxera.ch" '
             'style="color:#1A6FE8;text-decoration:underline;">info@voxera.ch</a> — wir antworten gerne.')


TEMPLATES = {
    'offer_email': t_offer,
    'invoice_email': t_invoice,
    'contract_expired_email': t_contract_expired,
    'password_changed_email': t_password_changed,
    'password_reset': t_password_reset,
    'assistant_updated_email': t_assistant_updated,
    'welcome': t_welcome,
    'contract_signed_email': t_contract_signed,
    'ai_change_request': t_ai_change_request,
    'fallback_alarm': t_fallback,
    'call_notification_email': t_call_notification,
    'callback_request_email': t_callback_request,
}

if __name__ == '__main__':
    os.makedirs(f'{OUT}/vorschau', exist_ok=True)
    for name, fn in TEMPLATES.items():
        MODE = 'make'
        globals()['MODE'] = 'make'
        html = fn()
        open(f'{OUT}/{name}.html', 'w', encoding='utf-8').write(html)
        globals()['MODE'] = 'preview'
        pv = fn()
        rest = re.findall(r'\{\{.*?\}\}', pv)
        assert not rest, (name, rest[:3])
        pv = pv.replace('<title>', '<title>Vorschau: ', 1)
        open(f'{OUT}/vorschau/{name}.vorschau.html', 'w', encoding='utf-8').write(pv)
        print(f'{name:26s} {len(html):6d} B  Vorschau {len(pv):6d} B')
    globals()['MODE'] = 'make'
