---
titel: "Vorlage: So ist ein Ratgeber-Artikel aufgebaut"
beschreibung: "Blaupause für neue Artikel – zeigt die Pflichtfelder und die Verzahnung mit genau einer Branchenseite."
kategorie: "telefonie-erreichbarkeit"
branche: "handwerk-bau"
autor: "Umut Yildirim"
veroeffentlicht: 2026-08-10
aktualisiert: 2026-08-10
entwurf: true
---

Dieser Artikel ist ein Entwurf (`entwurf: true`) und erscheint deshalb nirgends auf der
Seite. Er existiert als Blaupause und damit die Content-Collection nicht leer ist.

## Die Pflichtfelder

`titel` (max. 60 Zeichen) und `beschreibung` (max. 155) werden vom Schema erzwungen — sie
landen direkt in `<title>` und der Meta-Description. Der Build bricht ab, wenn sie fehlen
oder ein Titel doppelt vorkommt.

`aktualisiert` ist Pflicht und getrennt von `veroeffentlicht`. Bei Ratgeber-Inhalten ist das
Aktualisierungsdatum ein echtes Ranking-Signal; es kommt aus dem Frontmatter, damit es nicht
von Hand gepflegt werden muss.

`branche` verweist auf **genau eine** Branchenseite. Das ist Absicht: so entsteht die interne
Verlinkung beim Schreiben und nicht als nachträgliche Aufräumaktion. Ein Artikel, der zu drei
Branchen gehört, gehört wahrscheinlich zu keiner richtig.

## Was einen Artikel trägt

Konkrete Situationen aus der Branche, nicht allgemeine Aussagen über Erreichbarkeit. Der
Unterschied ist derselbe wie bei den Branchenseiten: „Was der Assistent fragt, wenn um 18 Uhr
ein Wasserschaden gemeldet wird" trägt eine Seite, „Erreichbarkeit ist wichtig" nicht.
