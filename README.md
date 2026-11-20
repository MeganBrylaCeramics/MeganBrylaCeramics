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
`clay-map.html` shows New York clay places coloured by how workable the clay is on the chosen date (past 3 months to 2 weeks ahead), using live soil temperature, soil moisture, snow and rain from Open-Meteo. Tapping any spot shows USDA soil survey data (clay, silt and sand %, drainage). The ratings are a rough guide, not a field check. Add or edit places in `/admin/` under *Clay map places*.

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
