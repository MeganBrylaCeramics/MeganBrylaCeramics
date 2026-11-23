# Megan Bryla Ceramics

Portfolio, shop and clay map hosted free on **GitHub Pages** (no server, no monthly cost).

Live at: https://meganbrylaceramics.github.io/MeganBrylaCeramics/

## Updating the site: the admin page
Go to **/admin/** (or tap the small **©** at the bottom of any page) and sign in with a GitHub token (see below).

- **Add a piece:** *Pieces → Add piece*. Drag in a photo, add a title, and tick **For sale in the Shop** (with a price) and/or **Show in Portfolio**.
- **Mark sold:** open the piece, tick **Sold out**.
- **Change wording:** *Website wording* lists every heading and paragraph. Leave a box empty to keep the original.
- **Shop details, payment options, awards, exhibitions:** same page, further down.
- **Clay map places:** *Clay map places*.

Click **Publish**. The live site updates in about a minute.

### Signing in
1. On GitHub: Settings, Developer settings, Personal access tokens, **Fine-grained tokens**, Generate new token.
2. Limit it to the `MeganBrylaCeramics` repository with **Contents: Read and write**.
3. Open `/admin/`, choose **Sign in with token**, and paste it. Keep it in a password manager.

## Turning the shop back on
The Shop, Payments and Cart are hidden for now. When you're ready, open `/admin/`, tick **Shop is open**, and publish. Everything below still applies.

## Clay soil map
`clay-map.html` is a New York clay map built on real data. Every source below was tested against the live service.

| Layer | Source | Notes |
|---|---|---|
| **Soil clay map** | USDA NRCS Soil Data Access (SSURGO) | Real soil survey areas colored by clay %, loaded for the view at zoom 13+ |
| **Streams & lakes** | USGS National Hydrography Dataset | Every mapped stream, river, lake and pond at zoom 12+. Streams and shores that run through clay soil (27%+ clay) are drawn in orange. Click one for the soils along it. |
| **USGS clay pits** | USGS Mineral Resources Data System | 124 New York clay pits and records, bundled in `content/usgs-clay-sites.json` |
| **Digging conditions** | Open-Meteo, plus my own climate model | One request per visit, cached for 3 hours. Live weather covers a month back and 2 weeks ahead; other dates (half a year either way) use typical conditions. |
| **Clay places, groups, references** | `content/*.json`, edited in `/admin/` | Historic brick towns, NYS Museum surficial map sheets, potters' groups, guides and rules |

Tap anywhere for that spot's conditions, soil survey, county clay potential and a 1-year timeline. You can also search a town, save spots on your device and share a link to a spot and date.

The condition ratings and county clay potential are rough guides, not field checks. Never dig without the landowner's permission.

## Wetland map
`wetland-map.html` is a full-screen New York wetland map:

| Layer | Source |
|---|---|
| **Every mapped wetland**, colored by type (zoom 11+) | U.S. Fish & Wildlife Service, National Wetlands Inventory |
| **NYS DEC previously mapped wetlands** (statewide) and **informational wetland mapping** | NYS Department of Environmental Conservation |
| **Hydric soils** (zoom 13+) | USDA NRCS Soil Data Access |
| **Streams & rivers** | USGS |

- An **"In this view"** card counts the wetlands on screen by type.
- The panel lists the **DEC-mapped wetlands** in view, largest first.
- **Tap anywhere** to see the wetland type with its inventory code spelled out (for example `PFO1/EM1E`), DEC status and class, and the soil's hydric rating. Hydric soil with no mapped wetland is flagged as a possible former wetland, which is where restoration usually happens.

Maps are a guide, not a legal boundary. Since 2025, NYS DEC protects freshwater wetlands over 12.4 acres whether or not they're mapped (7.4 acres from 2028).

## Taking payments (all free to run)
| Method | What happens |
|---|---|
| **Card, Apple Pay, Google Pay** | One **Stripe Payment Link** per piece. Create it in Stripe (Payment Links, New), turn on *Collect shipping address* and *Limit the number of payments to 1*, set the after-payment page to `.../success.html`, and paste the link into that piece in the admin. Pieces without a link can't be paid by card, and the card option only appears once at least one piece has a link. A cart with several pieces shows a pay button per piece. |
| **Venmo / Zelle / in person** | The buyer places the order and sees payment instructions. |

Use a **Venmo business profile** for sales. Stripe charges about 2.9% + 30¢ per sale and nothing monthly.

### Getting order and email-list notifications
GitHub Pages has no server, so out of the box a Venmo/Zelle/in-person order **opens a pre-written email** the buyer sends to Megan, and the email-list box does the same. For automatic notifications, create a free form at formspree.io and paste its link into **Order form link** and **Email-list form link** in the admin.

## Files
```
index.html, styles.css, app.js   the site
store.json                       pieces, payments, awards, wording (edited by /admin)
images/                          photos (new uploads go in images/work/)
clay-map.html/.js/.css           New York clay map
content/clay-sites.json          clay map places
admin/                           the editor (Sveltia CMS)
```

Preview on a computer: `python3 -m http.server 8000`, then open http://localhost:8000.
