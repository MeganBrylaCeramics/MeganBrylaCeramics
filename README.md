# Ceramics Shop

A free static storefront. Buyers pay by card through **Stripe Payment Links** or with **Venmo** for local pickup. You add photos and titles at the **/admin/** page of your site, with no code.

```
index.html, styles.css, app.js   the site
content/products.json           your pieces (edited by /admin)
content/shop.json               shop name, Venmo, email, etc. (edited by /admin)
images/                         uploaded photos land here
admin/                          the photo/title editor (Sveltia CMS)
```

## One-time setup (about 20 minutes)

### 1. Put it on GitHub
Create a free GitHub account and a new repository called `MeganBrylaCeramics.github.io`, then upload this folder to it.
In `admin/config.yml`, change `MeganBrylaCeramics/MeganBrylaCeramics.github.io` to your repository.

### 2. Host it free on GitHub Pages
1. In your repo, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, pick `main` and `/ (root)`, and click Save.
2. After a minute your shop is live at `https://meganbrylaceramics.github.io/`.
3. Optional: add a custom domain (about $12/year) in the same Pages settings.

### 2b. Log in to the editor (no extra service needed)
The editor is Sveltia CMS and it logs in with a GitHub token:
1. On GitHub go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Limit it to the `MeganBrylaCeramics.github.io` repository and give it **Contents: Read and write**.
3. Open `https://meganbrylaceramics.github.io/admin/`, choose **Sign in with token**, and paste it. Keep the token somewhere safe (a password manager).

### 3. Stripe
1. Create a Stripe account (no monthly fee, about 2.9% + 30¢ per sale).
2. In **Shipping rates**, add e.g. "Standard shipping, $12" and "Local pickup, $0".
3. For each piece, go to **Payment Links → New**, add the product, then:
   - turn on **Collect customers' addresses → Shipping** and attach both shipping rates
   - under **Advanced**, turn on **Limit the number of payments → 1**, so one-of-a-kind pieces can't sell twice
4. Paste the link into that piece's **Stripe Payment Link** field in /admin.

### 4. Venmo
Use a **Venmo business profile**. Personal accounts aren't allowed for selling. Put its username in /admin → Shop settings.

## Adding a new piece
1. Go to `/admin/` on your site and sign in with your token.
2. Open **Pieces for sale → Add piece** and drag in a photo. Enter the title, price and description, and paste the Stripe link.
3. Click **Publish**. The site updates in about a minute.

When something sells by Venmo, tick **Sold** in /admin **and** deactivate its Stripe link.
