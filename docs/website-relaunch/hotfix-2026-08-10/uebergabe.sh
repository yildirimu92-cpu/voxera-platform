#!/usr/bin/env bash
#
# Baut das Repo `voxera-website-live` aus dem, was in voxera-platform liegt.
#
# Warum es dieses Skript gibt: Das fertig vorbereitete Repo lag im Scratchpad
# eines ephemeren Containers. Nach einem Sitzungsneustart ist es weg — die
# Quellen dafuer (Archivkopie + Patch) liegen aber versioniert im Repo. Dieses
# Skript stellt daraus in einem Durchgang denselben Stand wieder her, damit in
# der neuen Sitzung nichts von Hand nachgebaut werden muss.
#
# Aufruf aus dem Wurzelverzeichnis von voxera-platform:
#     bash docs/website-relaunch/hotfix-2026-08-10/uebergabe.sh /pfad/zum/ziel
#
# Danach:
#     cd /pfad/zum/ziel
#     git remote add origin https://github.com/yildirimu92-cpu/voxera-website-live
#     git push -u origin main
#     git push -u origin hotfix/content-korrekturen-2026-08-10
#
set -euo pipefail

ZIEL="${1:-}"
if [ -z "$ZIEL" ]; then
  echo "Fehlt: Zielverzeichnis." >&2
  echo "Aufruf: bash $0 /pfad/zum/ziel" >&2
  exit 1
fi

HIER="$(cd "$(dirname "$0")" && pwd)"
ARCHIV="$HIER/../ist-stand-2026-08-10"
PATCH="$HIER/0001-vier-content-korrekturen.patch"
BRANCH="hotfix/content-korrekturen-2026-08-10"

for p in "$ARCHIV/index.html" "$PATCH" "$HIER/REPO_README.md"; do
  [ -f "$p" ] || { echo "Nicht gefunden: $p" >&2; exit 1; }
done

if [ -e "$ZIEL" ] && [ -n "$(ls -A "$ZIEL" 2>/dev/null)" ]; then
  echo "Zielverzeichnis existiert und ist nicht leer: $ZIEL" >&2
  exit 1
fi

mkdir -p "$ZIEL"

# Der Produktivstand: alle Dateien der Archivkopie ausser deren README, die
# eine Anmerkung zum Archiv ist und nicht Teil der Website.
for f in "$ARCHIV"/*; do
  [ "$(basename "$f")" = "README.md" ] && continue
  cp "$f" "$ZIEL/"
done

# Die README des Live-Repos.
cp "$HIER/REPO_README.md" "$ZIEL/README.md"

cd "$ZIEL"
chmod 644 ./*
git init -q -b main

git add -A
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -F - <<'COMMIT'
Produktivstand voxera.ch, gesichert am 10.08.2026

Erster Commit dieses Repos: die Live-Seite so, wie sie am 10.08.2026
ausgeliefert wurde, inklusive der Bild-Assets. Bis zu diesem Tag lief sie ohne
jede Versionskontrolle, direkt auf Netlify - dieser Commit ist die Basis, gegen
die alle weiteren Korrekturen laufen.

Enthalten: Startseite, AGB, Datenschutzerklaerung, Impressum, die beiden
Transaktionsseiten (offer-accept, contract-signed), netlify.toml, _redirects
sowie Favicons, apple-touch-icon und og-image.

Inhaltlich ist an den Dateien nichts geaendert. Die bekannten Fehler bleiben in
diesem Commit absichtlich stehen, damit der Ausgangszustand nachvollziehbar
bleibt; sie werden im folgenden Hotfix korrigiert.

NICHT gegengeprueft: die vollstaendige Dateiliste des Deploys. Da netlify.toml
mit publish="." das Repo-Verzeichnis ausliefert, verschwindet alles, was hier
fehlt, beim ersten Deploy von der Live-Seite. Vor dem Verknuepfen abgleichen.
COMMIT

git checkout -q -b "$BRANCH"
git am -q --committer-date-is-author-date "$PATCH"

echo
echo "Fertig. Zwei Commits auf main + $BRANCH:"
git --no-pager log --oneline "$BRANCH"
echo
echo "Naechste Schritte:"
echo "  cd $ZIEL"
echo "  git remote add origin https://github.com/yildirimu92-cpu/voxera-website-live"
echo "  git push -u origin main"
echo "  git push -u origin $BRANCH"
echo "  # danach PR eroeffnen: $BRANCH -> main"
