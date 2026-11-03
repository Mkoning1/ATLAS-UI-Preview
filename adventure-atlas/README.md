# Adventure Atlas
**Your world. Your story.** Een persoonlijke interactieve kaart voor avonturen, expedities, bucketlists en mijlpalen, met een videomodus voor YouTube en Instagram.

## Status — MVP
Deze map is als *losstaand prototype* ondergebracht in een **aparte featurebranch** van `Mkoning1/ATLAS-UI-Preview`, omdat de gekoppelde GitHub-tool geen nieuwe repository kan aanmaken. De bestaande `main`-branch is niet aangepast. Dit is **nog geen gepubliceerde website**.

**Doelrepository:** `Mkoning1/adventure-atlas` (nieuw aan te maken). Kopieer daarna de bestanden uit deze map naar de hoofdmap van die repository; dan kan GitHub Pages de site vanuit `main` en `/(root)` publiceren.

## Wat werkt al
- Interactieve Leaflet-wereldkaart met CARTO Dark Matter-achtergrond en verplichte OpenStreetMap/CARTO-attributie
- Pins, geselecteerde details, categorie- en zoekfilters, land-/avonturenstatistieken
- Expedities met routegeometrie en een opvallende scheiding tussen **schematische route** en **GPS-track**
- Nieuwe avonturen toevoegen door coördinaten in te voeren of een plek op de kaart te kiezen
- Avonturen bewerken; eigen lokale concepten verwijderen
- Lokale opslag in je browser (`localStorage`)
- Publieke JSON-export, privéback-up en JSON-import
- GPX-import voor `trkpt` en `rtept`; wordt **niet** automatisch als voltooide trip gemarkeerd
- Cinematic mode met 16:9 / 9:16, optionele tekstlaag en route-animatie, geschikt om het scherm met OBS of andere opnamesoftware vast te leggen
- Mobiele weergave

## Snel starten
De site heeft geen Node.js-project, buildproces, database of API-sleutels nodig. Een lokale webserver is wel noodzakelijk zodat `fetch("./data/adventures.json")` kan werken.

Vanaf de projectmap:
```bash
python -m http.server 8000
```
Open daarna `http://localhost:8000`.

Online: zet alle projectbestanden direct in de root van een **nieuwe publieke GitHub-repository**. Ga in die repo naar **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**. Publicatie is pas bevestigd als GitHub Pages een succesvolle deployment meldt. Bij een eerder uitgeputte of geblokkeerde Actions-quota kan publicatie vertraging oplopen of geblokkeerd zijn.

## Een nieuw avontuur vastleggen
1. Klik op **Nieuw avontuur**.
2. Voer titel, categorie, status, datum en verhaal in.
3. Selecteer eventueel **Kies locatie op kaart**.
4. Kies **Privé** voor persoonlijke concepten of **Publiek** als het verhaal later gedeeld mag worden.
5. Sla op. **Let op: dit staat nu alleen in de lokale browser, niet op GitHub.**
6. Gebruik **Publiek exporteren** en vervang in GitHub `data/adventures.json` door de gedownloade `adventures-public.json` (hernoem dat bestand). Hiermee wordt de publieke site na een succesvolle GitHub Pages-publicatie bijgewerkt.

### Veiligheid en privacy
- Gebruik geen persoonlijke woonadressen, live reislocaties, vertrouwelijke contactinformatie of privéreflecties op een publieke kaart.
- Een **Privé**-item komt niet in de publieke export. Het blijft wel zichtbaar op hetzelfde apparaat en browserprofiel.
- **Back-up** bevat ook privé-items. **Upload dit bestand nooit naar een publieke repository.**
- Iemand anders die de publieke website bezoekt, kan in diens **eigen browser** een lokaal concept maken. Daarmee wijzigt diegene **niet jouw GitHub-data**.
- Browseropslag kan worden gewist; exporteer regelmatig een back-up. Browseropslag synchroniseert niet automatisch tussen apparaten.
- Publieke JSON en media worden door GitHub Pages aan iedereen getoond. Een privé-repository maakt een gepubliceerde Pages-site niet automatisch privé.

## GPX en routes
Upload een `.gpx` met trackpoints of routepoints. De kaart toont de geometrie. Een import krijgt standaard `planned` en `private`, omdat een routebestand niet bewijst dat je de route daadwerkelijk hebt afgelegd. Open het detailvenster en kies **Bewerken** om dat later aan te passen.

De voorgeladen **Pedals of Honour**-route bevat uitsluitend de bekende vertrek- en eindpunten. De tussenliggende getekende lijn is bewust *schematisch* en mag in video niet worden voorgesteld als de werkelijk gereden route. Vervang deze later door je werkelijke GPX als je die hebt.

## Video's / socials
1. Kies de gewenste expeditie met een route.
2. Selecteer **Video mode**.
3. Wissel tussen **16:9** (YouTube) en **9:16** (Reels/Shorts).
4. Kies **Route afspelen**, of verberg de tekstlaag.
5. Leg het scherm vast met je eigen schermopnamesoftware.

De app genereert geen MP4 of GIF; de animatie wordt in de browser afgespeeld. Laat bronvermelding van kaarttegels zichtbaar, ook bij publicatie van opnames, en controleer de toepasselijke voorwaarden van CARTO/OSM bij commercieel mediagebruik.

## Techniek
- Statische HTML, CSS en vanilla JavaScript
- Leaflet 1.9.4 via CDN met Subresource Integrity
- CARTO Dark Matter tiles (netwerkverbinding vereist)
- Data: `data/adventures.json`, met `{ "version": 1, "adventures": [...] }`
- Geen cookies, analytics, API-keys, externe LLM's, buildstappen of GitHub Actions in de app zelf
- Untrusted tekst wordt escaped; afbeelding-URL's zijn beperkt tot HTTP(S)

## Backlog
- Route-editor en meerdere foto's per reis
- Authenticated contentbeheer met daadwerkelijke GitHub-updates of een eigen backend
- Video-export als MP4/WebM, afhankelijk van browservergunningen en kaartvoorwaarden
- Geautomatiseerde checks, responsive regressietests en accessibility-audit in CI na herstel van Actions
- Eigen public site / domeinnaam en koppeling met ATLAS Core als die architectuur daar klaar voor is

## Eigendom en licentie
Dit prototype is maatwerk voor de eigenaar van de GitHub-account. Een expliciete opensourcelicentie is nog niet gekozen. Kaartgegevens blijven eigendom van hun respectieve rechthebbenden; zie de attributie in de app.
