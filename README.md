# Jacob Collier — fanweb

Statický web, žádný build. Každá stránka má CSS inline, sdílené jsou jen JS soubory níž.
Lokálně: `python3 -m http.server 4173` v téhle složce → http://localhost:4173

## Stránky

| Soubor | Co to je |
|---|---|
| `index.html` | Hlavní stránka. Hero = hratelný nástroj (Web Audio). Každá sekce hraje jiný nástroj. V heru živě pojmenovává akord, který hraješ. Sekce 05 = teaser Harmony Lab (mini kruh kvint s negativní harmonií). |
| `lab.html` + `lab.js` | **Harmony Lab**: 4 hratelné experimenty: 01 negativní harmonie (zrcadlení přes osu v kruhu kvint), 02 „G half-sharp" (čisté ladění posouvá sbor o syntonické koma 21,5 ¢ za kolo), 03 audience choir (dirigování tří sekcí publika), 04 harmonizér (mikrofon → YIN detekce výšky → diatonická harmonie; bez mikrofonu se dá táhnout prstem). |
| `tour.html` | Turné 2026. Data se sama značí podle dnešního data (odehráno / další koncert). |
| `store.html`, `contact.html`, `djesse.html` | Obchod, kontakt, archiv Djesse. |
| `jacob_collier_web.html` | Stará beta verze, neudržuje se. |

## Sdílené soubory

- `harmony.js`: hudební teorie bez audia (jména akordů, negativní harmonie, stupnice). Používá ho `index.html` i `lab.html`.
- `analytics.js`: PostHog (zapne se až po vložení `phc_` klíče) + počítadlo návštěv v Supabase `mix-webs` (RPC `jc_*`).
- `favicon.svg`, `og-image.png` (náhled pro sdílení; zdroj `_tools/og-card.html`, příkaz na přegenerování je v jeho hlavičce)

## Testy

`node tests/harmony.test.js`: bez instalace, čistý node. Hlídá pojmenování akordů, negativní harmonii, geometrii zrcadlení na kruhu kvint, stupnice, pravidla hlasů harmonizéru (všech 12 tónin × 3 módy) a matematiku posunu o koma. Hudební logika patří do `harmony.js`, aby šla testovat; `lab.js` je jen zvuk a kreslení.

## Poznámky

- Posuvky ♭ ♯ se berou z fontu `Acc` (`@font-face` s `unicode-range`), protože Caprasimo/Bagel je nemají a fallback je příliš široký.
- Mikrofon v harmonizéru funguje jen přes https nebo localhost. Audio nikam neodchází.
- Live: https://paveljezelezny.github.io/jacob-collier/ (GitHub Pages z větve `main`, repo `paveljezelezny/jacob-collier`). `_backup_*`, `_tools/`, `tests/`, `docs/` jsou v `.gitignore`, na web nejdou. `og:image`/`og:url` jsou absolutní na tuhle adresu.
- Zálohy: `_backup_original/` = původní čitelné zdroje, `_backup_2026-09-26_minified/` = minifikovaná verze, která byla v rootu do 26. 9. 2026.
