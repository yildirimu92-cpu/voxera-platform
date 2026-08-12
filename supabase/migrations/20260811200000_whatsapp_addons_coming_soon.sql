-- WhatsApp-Addons: verkaufbar fuer eine Funktion, die nicht gebaut werden kann.
--
-- Ausgangslage. `voxera_addons` fuehrt in Produktion vier Benachrichtigungs-
-- Addons, alle mit `coming_soon = false` und damit buchbar:
--
--     sms_notify     CHF  9/Mt.  "SMS an dich nach jedem Anruf"
--     wa_notify      CHF 12/Mt.  "WhatsApp an dich nach jedem Anruf"
--     sms_endkunde   CHF 19/Mt.  "Lara schickt dem Anrufer eine Bestaetigung"
--     wa_endkunde    CHF 25/Mt.  "Lara schickt dem Anrufer eine Bestaetigung"
--
-- Fuer keines dieser vier existiert ein Versandweg. Die Twilio-Messages-API
-- wird im gesamten Repository an keiner Stelle aufgerufen; `calls.sms_sent`
-- steht auf allen 31 Produktionszeilen auf false; `outbox_events` fuehrt 42
-- Zeilen in acht Ereignistypen, ausnahmslos E-Mail. Belegt in
-- docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md.
--
-- Diese Migration fasst nur die beiden WhatsApp-Addons an, und zwar aus einem
-- Grund, der ueber "noch nicht gebaut" hinausgeht: fuer wa_notify ist der
-- beworbene Fall nicht bloss unfertig, sondern mit der offiziellen WhatsApp
-- Business API nicht herstellbar. Der Kundennutzen dahinter ist die
-- Team-Gruppe -- der Abschleppdienst koordiniert sich ueber einen
-- Gruppenchat --, und die Business API ist auf Eins-zu-eins-Konversationen
-- gebaut und kann in Gruppen nicht schreiben. Inoffizielle Wege verstossen
-- gegen Metas Bedingungen und riskieren die Sperrung der Nummer; bei einem
-- verkauften Produkt ist das keine Option.
--
-- Ein Addon mit Preisschild, dessen Funktion nicht bloss fehlt, sondern auf
-- dem vorgesehenen Weg nicht entstehen kann, ist die schaerfste Auspraegung
-- der Klasse, die seit dem 09.08. aus dem Produkt entfernt wird (tote
-- Schalter, Karteileichen, Anzeigen ohne Deckung). Der Unterschied hier: es
-- haengt ein Betrag daran.
--
-- SMS bleibt bewusst unberuehrt. Der Versandweg fehlt heute ebenfalls, ist
-- aber baubar und in Arbeit; blockiert ist allein die Absenderfrage bei
-- Twilio (die Schweizer Nummern des Kontos tragen `sms: false`). Sobald
-- feststeht, dass der Absender nicht kurzfristig zu beschaffen ist, gehoeren
-- sms_notify und sms_endkunde nach derselben Begruendung ebenfalls auf
-- `coming_soon = true` -- das ist eine Produktentscheidung und steht als
-- solche in der Diagnose, nicht stillschweigend in dieser Migration.
--
--
-- WAS `coming_soon` BEWIRKT -- und was nicht.
--
-- Sperrwirkung hat die Spalte an genau zwei Stellen, beide Buchungswege, und
-- beide filtern hart:
--
--     customer-dashboard/netlify/functions/customer-manage-addon.js:32
--         .eq('coming_soon', false)  -> sonst 400 "Add-on nicht verfuegbar"
--     admin-panel/netlify/functions/admin-mutate.js:522
--         .eq('coming_soon', false)  -> sonst 400 "Add-on nicht verfuegbar"
--
-- Damit ist nach dieser Migration weder ueber das Kundenportal noch ueber das
-- Admin-Portal eine Aktivierung moeglich.
--
-- Keine Sperrwirkung hat die Spalte auf die Laufzeit: sie steuert kein
-- Verhalten eines bereits gebuchten Addons. Der Hinweis in
-- admin-panel/netlify/functions/_lib/elevenlabs-sync.js:282 ("Reine
-- Preisangabe. Ohne Sperrwirkung") meint genau das und widerspricht dem hier
-- nicht -- er steht im Zusammenhang der Kalender-Freischaltung und sagt, dass
-- `coming_soon` dort nichts gatet. Buchbarkeit und Laufzeitverhalten sind
-- zwei verschiedene Fragen; diese Migration beantwortet die erste.
--
--
-- AUSGANGSMESSUNG (lesend erhoben am 2026-08-11, vor dieser Migration)
--
--   Produktion (ulcofbgrovgcvowdjrge):
--     addon_code    coming_soon  gebucht_gesamt  gebucht_aktiv
--     sms_notify    false        0               0
--     wa_notify     false        0               0
--     sms_endkunde  false        0               0
--     wa_endkunde   false        0               0
--
--   Staging (hzqiyyqfchvfcmmbemvd):
--     dieselben vier Codes, alle coming_soon = false, alle 0 Buchungen.
--
--   `customer_addons` ist in beiden Umgebungen vollstaendig leer (0 Zeilen).
--
-- Daraus folgt: die Aenderung ist verlustfrei. Es gibt keinen Kunden, dem
-- etwas weggenommen wird, und keine laufende Abrechnungsposition, die
-- beruehrt wird. Sie schliesst ausschliesslich einen zukuenftigen Verkauf.
--
-- Genau deshalb ist sie jetzt billig und spaeter teuer: der erste gebuchte
-- WhatsApp-Addon waere eine Zusage, die eingeloest werden muesste.

begin;

-- Absicherung der Ausgangslage. Sollte zwischen Messung und Ausfuehrung doch
-- eine Buchung entstanden sein, bricht die Migration ab, statt eine bezahlte
-- Position stillschweigend unbuchbar zu machen -- der Fall braucht dann eine
-- Entscheidung (Storno, Rueckerstattung, Kundengespraech), keine DDL.
do $$
declare
  gebucht integer;
begin
  select count(*) into gebucht
  from public.customer_addons
  where addon_code in ('wa_notify', 'wa_endkunde');

  if gebucht > 0 then
    raise exception
      'Abbruch: % Buchung(en) auf wa_notify/wa_endkunde vorhanden. '
      'Die Ausgangsmessung dieser Migration (0 Buchungen) gilt nicht mehr. '
      'Bitte kaufmaennisch klaeren, bevor die Addons unbuchbar werden.',
      gebucht;
  end if;
end $$;

update public.voxera_addons
   set coming_soon = true
 where addon_code in ('wa_notify', 'wa_endkunde')
   and coming_soon is distinct from true;

-- Nachweis. Beide Codes muessen nach dem Update gesperrt sein, und die beiden
-- SMS-Codes muessen unveraendert buchbar geblieben sein -- sonst hat die
-- Migration mehr getan als angekuendigt.
do $$
declare
  wa_offen  integer;
  sms_zu    integer;
begin
  select count(*) into wa_offen
  from public.voxera_addons
  where addon_code in ('wa_notify', 'wa_endkunde')
    and coming_soon is distinct from true;

  if wa_offen > 0 then
    raise exception 'Nachweis fehlgeschlagen: % WhatsApp-Addon(s) weiterhin buchbar.', wa_offen;
  end if;

  select count(*) into sms_zu
  from public.voxera_addons
  where addon_code in ('sms_notify', 'sms_endkunde')
    and coming_soon is distinct from false;

  if sms_zu > 0 then
    raise exception
      'Nachweis fehlgeschlagen: % SMS-Addon(s) mitgesperrt. '
      'Diese Migration darf SMS nicht anfassen.', sms_zu;
  end if;

  raise notice 'wa_notify und wa_endkunde auf coming_soon = true. SMS unveraendert.';
end $$;

commit;

-- Ruecknahme, falls die Produktentscheidung kippt:
--
--   update public.voxera_addons
--      set coming_soon = false
--    where addon_code in ('wa_notify', 'wa_endkunde');
--
-- Vor der Ruecknahme gehoert allerdings die Frage beantwortet, die zur
-- Sperrung gefuehrt hat: auf welchem Weg erreicht eine WhatsApp-Nachricht
-- eine Team-Gruppe, ohne gegen Metas Bedingungen zu verstossen.
