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
`clay-map.html` is a New York clay soil map that changes with the date (past 3 months to 2 weeks ahead):
- **Counties colored by conditions** (good, too wet, dry, frozen). It uses live soil temperature, soil moisture, snow and rain (Open-Meteo) when it can reach them, and otherwise **my own climate model** (typical conditions for that date and location), so the map is never empty.
- **Color the counties three ways:** digging conditions, clay potential (a rough estimate from general glacial geology), or best bets (both combined), plus a ranked *Best bets on this date* list.
- **Stream & lake soil explorer:** zoom in and every mapped stream, river, canal, lake and pond in view is loaded (OpenStreetMap). Click one, or pick it from the list, and the USDA soil survey is sampled at points along it, with average clay %, soil names and a regional note.
- **Potters & wild clay groups:** map pins and a references section (guilds, workshops, guides, state land rules). Edit them in `/admin/` under *Potters and wild clay groups*.
- **Terrain map with streams** (OpenTopoMap, USGS topo) and an optional USGS streams and lakes overlay.
- **Tap anywhere in New York** for conditions at that exact spot plus USDA soil survey data (clay, silt and sand %, drainage), a 3-month timeline, and the next good digging day.
- **Search a town**, or use your location.
- **Save spots** on your own device, **copy a link** to a spot and date, and get **directions**.
- Optional layers: USDA soil map areas, USGS clay mineral sites and USGS geology.

The map lists 36 places in four types, filterable and clustered: clay regions, **historic brick-making towns**, **geology maps and clay lowlands** (NY State Museum surficial map sheets and the Champlain, St. Lawrence and Great Lakes plains) and places **reported in stream plans**. None are verified digging spots. Add your own in `/admin/` under *Clay map places*.

The ratings are a rough guide from modeled weather, not a field check. Add or edit the clay places in `/admin/` under *Clay map places*.

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
