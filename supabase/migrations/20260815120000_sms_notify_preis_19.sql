-- sms_notify von CHF 9 auf CHF 19 im Monat.
--
-- AUSGANGSLAGE
--
-- Der Preis war als Ein-Empfaenger-Produkt kalkuliert. Der erste Pilotkunde --
-- ein Abschleppdienst -- braucht vier bis fuenf Empfaenger, und die Kosten
-- skalieren mit der Empfaengerzahl, der Preis nicht:
--
--   5 Empfaenger x 1 SMS je Anruf = 5 Segmente
--   bei CHF 0.07-0.10 je Segment  = CHF 0.35-0.50 je Anruf
--   Break-even bei CHF 9          = rund 18-26 Anrufe im Monat
--
-- Darueber zahlt Voxera drauf. Ausfuehrlich in
-- docs/TICKET_SMS_KOSTEN_PAKETMERKMAL_2026-08-11.md.
--
-- Entschieden am 2026-08-15: CHF 19. Begruendung des Auftraggebers: Die
-- Zusatzminutenrechnung zeigt, dass fuenf Empfaenger je Anruf real Geld kosten;
-- CHF 9 deckt das nicht, sobald ein Kunde Volumen hat.
--
--
-- WAS DIESE MIGRATION NICHT LEISTET
--
-- Sie loest den Konstruktionsfehler nicht, sie entschaerft ihn. Der Preis
-- reagiert weiterhin NICHT auf die Empfaengerzahl -- ein Kunde mit einem
-- Empfaenger zahlt gleich viel wie einer mit zehn. Bei CHF 19 verschiebt sich
-- der Break-even auf rund 38-54 Anrufe im Monat, er verschwindet nicht.
--
-- Das empfaengerabhaengige Modell bleibt offen und steht im Ticket. Diese
-- Migration kauft Zeit fuer den Piloten, mehr nicht.
--
-- Unberuehrt bleibt sms_endkunde (CHF 19, ein Empfaenger je Anruf): dort ist
-- der Break-even mit rund 190-270 Anrufen im Monat auskoemmlich.

begin;

-- Kein Bestandsschutz noetig, aber pruefen statt annehmen: Eine Preisaenderung
-- an einem gebuchten Addon braucht eine kaufmaennische Entscheidung, keine
-- Migration -- customer_addons haelt den Preis je Buchung in price_chf fest,
-- und der wuerde hier NICHT mitwandern.
do $$
declare
  gebucht integer;
  alt     numeric;
begin
  select count(*) into gebucht from public.customer_addons where addon_code = 'sms_notify';
  if gebucht > 0 then
    raise exception
      'Abbruch: % Buchung(en) auf sms_notify vorhanden. Deren price_chf bleibt beim alten Wert '
      'und wandert nicht mit. Bitte kaufmaennisch klaeren, bevor der Katalogpreis wechselt.', gebucht;
  end if;

  select price_monthly_chf into alt from public.voxera_addons where addon_code = 'sms_notify';
  if alt is null then
    raise exception 'Abbruch: sms_notify existiert nicht im Katalog.';
  end if;
  raise notice 'sms_notify: bisheriger Preis CHF %', alt;
end $$;

update public.voxera_addons
   set price_monthly_chf = 19.00
 where addon_code = 'sms_notify';

do $$
declare
  neu numeric;
begin
  select price_monthly_chf into neu from public.voxera_addons where addon_code = 'sms_notify';
  if neu is distinct from 19.00 then
    raise exception 'Nachweis fehlgeschlagen: sms_notify steht auf %, erwartet 19.00', neu;
  end if;
  raise notice 'sms_notify steht auf CHF 19.00.';
end $$;

commit;

-- Ruecknahme:
--   update public.voxera_addons set price_monthly_chf = 9.00 where addon_code = 'sms_notify';
