// Storefront logic. All store settings live in store.json — you shouldn't need to edit this file.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let store;
let cart = loadCart(); // { productId: qty }

// ---------- Site text edited from /admin ----------
// Elements marked data-text="key" in index.html show the admin's wording when one is saved.
// *words* become italic and line breaks are kept. The last wording seen is cached so it
// shows straight away on the next visit instead of flashing the original text first.
const ORIGINAL_TEXT = {};
document.querySelectorAll("[data-text]").forEach((el) => (ORIGINAL_TEXT[el.dataset.text] = el.innerHTML));
const formatText = (s) => esc(s).replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\n/g, "<br />");
function applySiteText(text) {
  document.querySelectorAll("[data-text]").forEach((el) => {
    const v = text && typeof text[el.dataset.text] === "string" ? text[el.dataset.text].trim() : "";
    el.innerHTML = v ? formatText(v) : ORIGINAL_TEXT[el.dataset.text];
  });
}
try { applySiteText(JSON.parse(localStorage.getItem("siteText"))); } catch {}

function loadCart() {
  try { return JSON.parse(localStorage.getItem("cart")) || {}; } catch { return {}; }
}
function saveCart() {
  try { localStorage.setItem("cart", JSON.stringify(cart)); } catch {}
}
const money = (n) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: store.currency.toUpperCase() }).format(n);
const product = (id) => store.products.find((p) => p.id === id);
const cartLines = () =>
  Object.entries(cart).map(([id, qty]) => ({ p: product(id), qty })).filter((l) => l.p && l.qty > 0);
const cartTotal = () => Math.round(cartLines().reduce((s, l) => s + l.p.price * l.qty, 0) * 100) / 100;
// Card payments use one Stripe Payment Link per piece, so the option only shows once a link exists.
const enabledMethods = () =>
  Object.entries(store.payments).filter(([k, m]) => m.enabled && (k !== "stripe" || (store.products || []).some((p) => p.stripeLink)));

async function init() {
  // Content lives in store.json (edited from /admin/).
  store = await fetch("store.json", { cache: "no-store" }).then((r) => r.json());
  if (store.text) {
    applySiteText(store.text);
    try { localStorage.setItem("siteText", JSON.stringify(store.text)); } catch {}
  }
  const pieces = store.pieces || [];
  store.products = pieces.filter((p) => p.inShop && p.price > 0).map((p) => ({ ...p, name: p.title }));
  store.portfolio = pieces.filter((p) => p.inPortfolio);
  document.title = store.name;
  const contact = $("#contact-link");
  contact.textContent = store.contactEmail;
  contact.href = "mailto:" + store.contactEmail;
  $("#year").textContent = new Date().getFullYear();
  $("#contact-btn").href = "mailto:" + store.contactEmail;
  document.querySelectorAll(".contact-mail").forEach((a) => (a.href = "mailto:" + store.contactEmail));
  renderPaymentMethods();
  renderCV();


  // Drop cart entries for products that no longer exist.
  for (const id of Object.keys(cart)) if (!product(id) || product(id).soldOut) delete cart[id];
  saveCart();

  renderFilters("#shop-filters", ["All", ...new Set(store.products.map(productCategory))], (c) => {
    shopFilter = c;
    renderProducts();
  });
  renderFilters("#portfolio-filters", ["All", ...new Set((store.portfolio || []).map((w) => w.category))], (c) => {
    portfolioFilter = c;
    renderGallery();
  });
  renderProducts();
  renderFeatured();
  renderGallery();
  renderCart();
  renderMethods();
  route();
}

// ---------- Email sign-up ----------
$("#nl-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("#nl-msg");
  const btn = form.querySelector("button");
  const email = form.elements.namedItem("email").value.trim();
  const show = (text, ok) => { msg.textContent = text; msg.className = "nl-msg " + (ok ? "ok" : "bad"); msg.hidden = false; };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show("Please enter a valid email address.", false);
  btn.disabled = true;
  try {
    if (store.newsletterFormUrl) {
      const res = await fetch(store.newsletterFormUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, website: form.elements.namedItem("website").value }),
      });
      if (!res.ok) throw new Error("Couldn't sign you up. Please try again.");
      form.reset();
      show("You're on the list! Watch your inbox for the next batch.", true);
    } else {
      // No sign-up service connected: open a pre-written email to Megan.
      window.location.href = `mailto:${store.contactEmail}?subject=${encodeURIComponent("Add me to your email list")}&body=${encodeURIComponent("Please add " + email + " to your email list.")}`;
      form.reset();
      show("Your email app should open. Send the message to join the list.", true);
    }
  } catch (ex) {
    show(ex.message, false);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Payments page ----------
function renderPaymentMethods() {
  const p = store.payments;
  const how = {
    stripe: () => `Pay right at checkout with any credit or debit card, Apple Pay or Google Pay. Checkout is handled securely by Stripe, and your receipt is emailed to you.`,
    venmo: () => `Place your order and choose Venmo. You'll get a button that opens Venmo with the amount and your order number already filled in. Send to <strong>@${esc(p.venmo.username)}</strong>.`,
    zelle: () => `Place your order and choose Zelle, then send the payment from your bank's app to <strong>${esc(p.zelle.emailOrPhone)}</strong> (${esc(p.zelle.recipientName)}). Put your order number in the memo.`,
    local: () => esc(p.local.details),
  };
  $("#pay-methods").innerHTML = enabledMethods().map(([key, m]) => `
    <div class="info-card pay-card">
      <p class="eyebrow">${key === "stripe" ? "Instant" : key === "local" ? "In person" : "After ordering"}</p>
      <h3>${esc(m.label)}</h3>
      <p>${how[key] ? how[key]() : ""}</p>
    </div>`).join("");
}

// ---------- Tabs (hash routing: #/shop, #/portfolio, #/about, #/payments) ----------
// The portfolio lives on the home page, so #/portfolio shows home and jumps to the work.
const VIEWS = ["home", "shop", "about", "payments"];
function route() {
  let name = location.hash.replace(/^#\/?/, "") || "home";
  if (name === "visit") name = "payments"; // old link
  const toWork = name === "portfolio";
  if (toWork) name = "home";
  const view = VIEWS.includes(name) ? name : "home";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === view);
    if (a.dataset.nav === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const titles = { home: "", shop: "Shop", about: "About", payments: "Payments" };
  document.title = titles[view] ? `${titles[view]} — ${store.name}` : store.name;
  if (toWork) $("#work").scrollIntoView({ behavior: "instant", block: "start" });
  else window.scrollTo({ top: 0, behavior: "instant" });
  closeCart();
}
window.addEventListener("hashchange", () => store && route());

// ---------- Filters ----------
let shopFilter = "All";
let portfolioFilter = "All";
const CATEGORY_BY_SHAPE = { mug: "Drinkware", tumbler: "Drinkware", bowl: "Tableware", plate: "Tableware", vase: "Vessels", jar: "Vessels" };
const productCategory = (p) => p.category || CATEGORY_BY_SHAPE[p.shape] || "Other";

function renderFilters(sel, cats, onPick) {
  const el = $(sel);
  if (cats.length <= 2) { el.hidden = true; return; } // no point filtering a single category
  el.innerHTML = cats.map((c, i) =>
    `<button type="button" role="tab" class="chip${i === 0 ? " active" : ""}" aria-selected="${i === 0}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    el.querySelectorAll(".chip").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
    onPick(b.dataset.cat);
  });
}

// ---------- Portfolio ----------
const pieceMeta = (w) => [w.category, w.year].filter(Boolean).join(" · ");
// Pieces store their exhibition as "Title (Year)", matching an entry in store.json "exhibitions".
const exhibitionKey = (x) => `${x.title} (${x.year})`;
let galleryItems = [];
let lbIndex = 0;
let portfolioView = "type"; // "type" (filter chips) or "exhibition" (grouped by show)

function pieceCard(w, i) {
  return `
    <button type="button" class="piece" data-piece="${i}">
      <div class="piece-art">${w.image ? `<img src="${esc(w.image)}" alt="${esc(w.title)}" loading="lazy" />` : potSVG(w, "g")}</div>
      <div class="piece-cap"><span class="piece-title">${esc(w.title)}</span><span class="muted">${esc(pieceMeta(w))}</span></div>
    </button>`;
}

function renderGallery() {
  const all = store.portfolio || [];
  $("#portfolio-filters").hidden = portfolioView !== "type" || $("#portfolio-filters").childElementCount === 0;

  if (portfolioView === "type") {
    galleryItems = all.filter((w) => portfolioFilter === "All" || w.category === portfolioFilter);
    $("#gallery").innerHTML = galleryItems.length
      ? `<div class="gallery">${galleryItems.map(pieceCard).join("")}</div>`
      : `<p class="muted">Nothing here yet.</p>`;
    return;
  }

  // Grouped by exhibition, in the order of the exhibitions list; untagged work goes last.
  const groups = (store.exhibitions || [])
    .map((x) => ({ heading: x.title, sub: [x.venue, x.year].filter(Boolean).join(" · "), items: all.filter((w) => w.exhibition === exhibitionKey(x)) }))
    .filter((g) => g.items.length);
  const tagged = new Set(groups.flatMap((g) => g.items));
  const rest = all.filter((w) => !tagged.has(w));
  if (rest.length) groups.push({ heading: groups.length ? "Other work" : "All work", sub: groups.length ? "Not tied to a specific show" : "", items: rest });

  galleryItems = groups.flatMap((g) => g.items);
  let i = 0;
  $("#gallery").innerHTML = groups.map((g) => `
    <div class="show-group">
      <div class="show-head"><h3>${esc(g.heading)}</h3>${g.sub ? `<span class="muted">${esc(g.sub)}</span>` : ""}</div>
      <div class="gallery">${g.items.map((w) => pieceCard(w, i++)).join("")}</div>
    </div>`).join("");
}

$("#portfolio-view").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view-mode]");
  if (!b) return;
  portfolioView = b.dataset.viewMode;
  $("#portfolio-view").querySelectorAll("button").forEach((x) => {
    x.classList.toggle("active", x === b);
    x.setAttribute("aria-pressed", x === b);
  });
  renderGallery();
});

// ---------- About: awards, exhibitions, publications ----------
function renderCV() {
  const list = (sel, items, row) => {
    const el = $(sel);
    const block = el.closest(".cv-block");
    if (!items || !items.length) { block.hidden = true; return; }
    el.innerHTML = items.map(row).join("");
  };
  list("#cv-awards", store.awards, (a) => `
    <li><span class="cv-when">${esc(a.year)}</span>
      <span class="cv-what"><strong>${esc(a.title)}</strong>${a.detail ? `<br /><span class="muted">${esc(a.detail)}</span>` : ""}</span></li>`);
  list("#cv-exhibitions", store.exhibitions, (x) => `
    <li><span class="cv-when">${esc(x.year)}</span>
      <span class="cv-what"><strong>${esc(x.title)}</strong>${x.venue ? `<br /><span class="muted">${esc(x.venue)}</span>` : ""}</span></li>`);
  list("#cv-publications", store.publications, (x) => `
    <li><span class="cv-when">${esc(x.year)}</span>
      <span class="cv-what"><strong><em>${esc(x.title)}</em></strong>${x.venue ? `<br /><span class="muted">${esc(x.venue)}</span>` : ""}</span></li>`);
}
$("#gallery").addEventListener("click", (e) => {
  const b = e.target.closest("[data-piece]");
  if (b) openLightbox(Number(b.dataset.piece));
});
function openLightbox(i) {
  lbIndex = (i + galleryItems.length) % galleryItems.length;
  const w = galleryItems[lbIndex];
  $("#lb-art").innerHTML = w.image ? `<img src="${esc(w.image)}" alt="${esc(w.title)}" />` : potSVG(w, "lb");
  $("#lb-meta").textContent = pieceMeta(w);
  $("#lb-title").textContent = w.title;
  $("#lb-desc").textContent = w.description || "";
  const shown = w.exhibition ? `Exhibited: ${w.exhibition}` : "";
  $("#lb-materials").textContent = [w.materials, shown].filter(Boolean).join("  ·  ");
  const multi = galleryItems.length > 1;
  $("#lb-prev").hidden = $("#lb-next").hidden = !multi;
  if (!$("#lightbox").open) $("#lightbox").showModal();
}
$("#lb-close").onclick = () => $("#lightbox").close();
$("#lb-prev").onclick = () => openLightbox(lbIndex - 1);
$("#lb-next").onclick = () => openLightbox(lbIndex + 1);
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") e.target.close(); });
$("#lightbox").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") openLightbox(lbIndex - 1);
  if (e.key === "ArrowRight") openLightbox(lbIndex + 1);
});

// ---------- Shop ----------
function renderFeatured() {
  const picks = store.products.filter((p) => !p.soldOut).slice(0, 3);
  // Separate suffix so SVG ids don't clash with the same product on the Shop tab.
  $("#featured").innerHTML = picks.map((p) => productCard(p, "f")).join("");
}
function renderProducts() {
  const list = store.products.filter((p) => shopFilter === "All" || productCategory(p) === shopFilter);
  $("#products").innerHTML = list.map((p) => productCard(p, "s")).join("");
}
function productCard(p, suffix) {
    const img = p.image
      ? `<img class="thumb" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" />`
      : `<div class="thumb placeholder">${potSVG(p, suffix)}</div>`;
    return `
      <article class="card${p.soldOut ? " sold" : ""}">
        ${img}
        <div class="body">
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          <div class="row">
            <span class="price">${money(p.price)}</span>
            <button class="btn primary small-btn" data-add="${esc(p.id)}" ${p.soldOut ? "disabled" : ""}>
              ${p.soldOut ? "Sold out" : "Add to cart"}
            </button>
          </div>
        </div>
      </article>`;
}

function renderCart() {
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  $("#cart-count").textContent = count;
  $("#cart-total").textContent = money(cartTotal());
  $("#checkout-btn").disabled = count === 0;
  $("#cart-items").innerHTML = lines.length
    ? lines.map(({ p, qty }) => `
        <div class="line">
          <div class="mini" aria-hidden="true">${p.image ? `<img src="${esc(p.image)}" alt="" />` : potSVG(p, "m")}</div>
          <div><div class="name">${esc(p.name)}</div><div class="sub">${money(p.price)} each</div></div>
          <strong>${money(p.price * qty)}</strong>
          <div class="line-actions">
            <div class="qty">
              <button data-dec="${esc(p.id)}" aria-label="Decrease">−</button>
              <span>${qty}</span>
              <button data-inc="${esc(p.id)}" aria-label="Increase">+</button>
            </div>
            <button class="link-btn" data-remove="${esc(p.id)}">Remove</button>
          </div>
        </div>`).join("")
    : `<p class="muted">Your cart is empty.</p>`;
}

function renderMethods() {
  $("#method-list").innerHTML = enabledMethods().map(([key, m], i) => `
    <label class="method">
      <input type="radio" name="method" value="${key}" ${i === 0 ? "checked" : ""} />
      <span>${esc(m.label)}<small>${esc(methodHint(key, m))}</small></span>
    </label>`).join("");
  syncContactFields();
}

function methodHint(key, m) {
  if (key === "stripe") return m.description || "Pay securely by card.";
  if (key === "venmo") return `Send to @${m.username}`;
  if (key === "zelle") return `Send to ${m.emailOrPhone}`;
  if (key === "local") return "Cash or card when we meet.";
  return "";
}

// Stripe collects contact info itself; other methods need it so you know who ordered.
function syncContactFields() {
  const method = selectedMethod();
  const needsContact = method !== "stripe";
  $("#contact-fields").hidden = !needsContact;
  const f = $("#checkout-form").elements; // note: form.name is the form's own name, so use .elements
  f.namedItem("name").required = needsContact;
  f.namedItem("email").required = needsContact;
  $("#place-order").textContent = method === "stripe" ? "Pay with card" : "Place order";
}
const selectedMethod = () => $("#checkout-form").querySelector('input[name="method"]:checked')?.value;

// ---------- Cart drawer ----------
function openCart() {
  $("#cart").classList.add("open");
  $("#cart").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
}
function closeCart() {
  $("#cart").classList.remove("open");
  $("#cart").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-add],[data-inc],[data-dec],[data-remove]");
  if (!t) return;
  const { add, inc, dec, remove } = t.dataset;
  if (add) { cart[add] = (cart[add] || 0) + 1; openCart(); }
  if (inc) cart[inc] = Math.min(99, (cart[inc] || 0) + 1);
  if (dec) { cart[dec] -= 1; if (cart[dec] <= 0) delete cart[dec]; }
  if (remove) delete cart[remove];
  saveCart();
  renderCart();
});
$("#open-cart").onclick = openCart;
$("#close-cart").onclick = closeCart;
$("#scrim").onclick = closeCart;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });

// ---------- Checkout ----------
const dialog = $("#checkout");
$("#checkout-btn").onclick = () => {
  closeCart();
  $("#step-details").hidden = false;
  $("#step-done").hidden = true;
  $("#checkout-error").hidden = true;
  $("#checkout-total").textContent = money(cartTotal());
  dialog.showModal();
};
$("#close-checkout").onclick = () => dialog.close();
$("#method-list").addEventListener("change", syncContactFields);

$("#checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const val = (n) => f.namedItem(n).value.trim();
  const method = selectedMethod();
  const btn = $("#place-order");
  const err = $("#checkout-error");
  err.hidden = true;
  btn.disabled = true;

  try {
    if (method === "stripe") {
      const lines = cartLines();
      const missing = lines.filter((l) => !l.p.stripeLink);
      if (missing.length) {
        throw new Error(`Card payment isn't available for: ${missing.map((l) => l.p.name).join(", ")}. Please choose another way to pay.`);
      }
      if (lines.length === 1 && lines[0].qty === 1) {
        window.location.href = lines[0].p.stripeLink; // Cart is cleared on success.html
        return;
      }
      showCardLinks(lines);
      return;
    }

    const orderId = "A" + Date.now().toString(36).toUpperCase().slice(-6);
    const total = cartTotal();
    const items = cartLines().map(({ p, qty }) => `${qty} × ${p.name} (${money(p.price * qty)})`).join("\n");

    const mailto = await submitOrder({
      order_id: orderId,
      method: store.payments[method].label,
      name: val("name"),
      email: val("email"),
      phone: val("phone"),
      notes: val("notes"),
      items,
      total: money(total),
    });

    showInstructions(method, orderId, total, mailto);
    cart = {};
    saveCart();
    renderCart();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// Sends the order to the order form service if one is set in store.json ("orderFormUrl").
// Otherwise returns a pre-filled email the buyer can send to Megan.
async function submitOrder(fields) {
  if (store.orderFormUrl) {
    const res = await fetch(store.orderFormUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`Couldn't place your order. Please try again or email ${store.contactEmail}.`);
    return null;
  }
  const body = [
    `Order ${fields.order_id}`,
    `Payment: ${fields.method}`,
    "",
    fields.items,
    `Total: ${fields.total}`,
    "",
    `Name: ${fields.name}`,
    `Email: ${fields.email}`,
    ...(fields.phone ? [`Phone: ${fields.phone}`] : []),
    ...(fields.notes ? [`Notes: ${fields.notes}`] : []),
  ].join("\n");
  return `mailto:${store.contactEmail}?subject=${encodeURIComponent("New order " + fields.order_id)}&body=${encodeURIComponent(body)}`;
}

// Cart with several pieces: each one has its own card checkout link.
function showCardLinks(lines) {
  const rows = lines.map(({ p, qty }) =>
    `<div class="kv"><span>${qty} × ${esc(p.name)}</span><a class="btn primary" href="${esc(p.stripeLink)}" target="_blank" rel="noopener">Pay ${money(p.price * qty)}</a></div>`).join("");
  $("#step-done").innerHTML = `
    <div class="done">
      <h3>Pay for each piece by card</h3>
      <p>Card checkout handles one piece at a time. Tap each button below to pay for it.</p>
      <div class="instructions">${rows}</div>
      <p class="muted">Receipts are emailed by Stripe. Questions? ${esc(store.contactEmail)}</p>
      <button type="button" class="btn block" id="done-close">Done</button>
    </div>`;
  $("#step-details").hidden = true;
  $("#step-done").hidden = false;
  $("#done-close").onclick = () => dialog.close();
}

function showInstructions(method, orderId, total, mailto) {
  const m = store.payments[method];
  const amount = total.toFixed(2);
  let body = "";

  if (method === "venmo") {
    const url = `https://venmo.com/${encodeURIComponent(m.username)}?txn=pay&amount=${amount}&note=${encodeURIComponent("Order " + orderId)}`;
    body = `
      <p>Send your payment on Venmo to finish your order.</p>
      <div class="instructions">
        <div class="kv"><span>Send to</span><code>@${esc(m.username)}</code></div>
        <div class="kv"><span>Amount</span><code>${money(total)}</code></div>
        <div class="kv"><span>Note</span><code>Order ${orderId}</code></div>
      </div>
      <a class="btn primary block" href="${url}" target="_blank" rel="noopener">Open Venmo</a>`;
  } else if (method === "zelle") {
    body = `
      <p>Send your payment with Zelle from your bank's app to finish your order.</p>
      <div class="instructions">
        <div class="kv"><span>Send to</span><code>${esc(m.emailOrPhone)}</code>
          <button type="button" class="link-btn" data-copy="${esc(m.emailOrPhone)}">Copy</button></div>
        <div class="kv"><span>Name</span><code>${esc(m.recipientName)}</code></div>
        <div class="kv"><span>Amount</span><code>${money(total)}</code></div>
        <div class="kv"><span>Memo</span><code>Order ${orderId}</code></div>
      </div>`;
  } else if (method === "local") {
    body = `
      <p>Your order is reserved. I'll email you to arrange a time to pay in person.</p>
      <div class="instructions">
        <div class="kv"><span>Amount due</span><code>${money(total)}</code></div>
        <p style="margin:0">${esc(m.details)}</p>
      </div>`;
  }

  $("#step-done").innerHTML = `
    <div class="done">
      <h3>Order ${orderId} received — thank you!</h3>
      ${body}
      ${mailto ? `<a class="btn primary block" href="${mailto}">Email my order to Megan</a><p class="muted small">Tap to send the order by email so she knows to expect it.</p>` : ""}
      <p class="muted">We'll confirm by email once payment is received. Questions? ${esc(store.contactEmail)}</p>
      <button type="button" class="btn block" id="done-close">Done</button>
    </div>`;
  $("#step-details").hidden = true;
  $("#step-done").hidden = false;
  $("#done-close").onclick = () => dialog.close();
  $("#step-done").querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => (b.textContent = "Copied"));
  });
}

// ---------- Pottery illustrations ----------
// Used when a product has no photo. Set "shape" (mug, tumbler, bowl, vase, plate, jar)
// and "glaze" (a hex color) on a product in store.json.
const POT_SHAPES = {
  mug: {
    handle: "M128 62 C158 60 158 104 126 104",
    body: "M68 44 Q65 104 73 120 Q100 127 127 120 Q135 104 132 44 Z",
    foot: "M70 110 Q100 117 130 110 L127 121 Q100 128 73 121 Z",
    rim: [100, 44, 32, 5.5],
  },
  tumbler: {
    body: "M74 34 Q70 104 78 121 Q100 127 122 121 Q130 104 126 34 Z",
    foot: "M75 112 Q100 118 125 112 L122 122 Q100 128 78 122 Z",
    rim: [100, 34, 26, 5],
  },
  bowl: {
    body: "M36 70 Q40 118 88 124 L112 124 Q160 118 164 70 Z",
    foot: "M78 116 Q100 120 122 116 L114 126 Q100 128 86 126 Z",
    rim: [100, 70, 64, 11],
  },
  vase: {
    body: "M91 24 L91 50 Q58 66 60 98 Q62 122 100 124 Q138 122 140 98 Q142 66 109 50 L109 24 Z",
    foot: "M66 112 Q100 122 134 112 Q128 124 100 125 Q72 124 66 112 Z",
    rim: [100, 24, 9, 2.5],
  },
  jar: {
    body: "M84 34 L84 44 Q42 56 42 88 Q44 124 100 126 Q156 124 158 88 Q158 56 116 44 L116 34 Z",
    foot: "M58 114 Q100 128 142 114 Q130 126 100 127 Q70 126 58 114 Z",
    rim: [100, 34, 16, 3.5],
  },
  plate: {
    under: "M28 100 a72 22 0 1 0 144 0 a72 22 0 1 0 -144 0 Z",
    body: "M28 94 a72 22 0 1 0 144 0 a72 22 0 1 0 -144 0 Z",
    rim: [100, 93, 48, 13],
  },
};

function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function shadeHex(hex, amt) {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function potSVG(p, suffix = "") {
  const s = POT_SHAPES[p.shape] || POT_SHAPES.mug;
  const glaze = /^#[0-9a-f]{6}$/i.test(p.glaze || "") ? p.glaze : "#d8cbb6";
  const uid = "pot" + hashStr(p.id) + suffix;
  let seed = hashStr(p.id) || 1;
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ 0x9e3779b9) >>> 0) / 4294967296;
  let specks = "";
  for (let i = 0; i < 60; i++) {
    specks += `<circle cx="${(30 + rnd() * 140).toFixed(1)}" cy="${(20 + rnd() * 110).toFixed(1)}" r="${(0.5 + rnd() * 1.1).toFixed(2)}"/>`;
  }
  const [cx, cy, rx, ry] = s.rim;
  return `
    <svg class="pot" viewBox="0 0 200 140" aria-hidden="true">
      <defs>
        <clipPath id="${uid}c"><path d="${s.body}"/></clipPath>
        <linearGradient id="${uid}g" x1="0" x2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
          <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".22"/>
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="127" rx="62" ry="6" fill="#3a2a1d" opacity=".14"/>
      ${s.under ? `<path d="${s.under}" fill="var(--clay)"/>` : ""}
      ${s.handle ? `<path d="${s.handle}" fill="none" stroke="${glaze}" stroke-width="9" stroke-linecap="round"/>
                    <path d="${s.handle}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="9" stroke-linecap="round"/>` : ""}
      <path d="${s.body}" fill="${glaze}"/>
      <g clip-path="url(#${uid}c)">
        ${s.foot ? `<path d="${s.foot}" fill="var(--clay)"/>` : ""}
        <rect width="200" height="140" fill="url(#${uid}g)"/>
        <g fill="#3b2a1e" opacity=".35">${specks}</g>
      </g>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${shadeHex(glaze, -38)}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${shadeHex(glaze, 25)}" stroke-width="1.5"/>
    </svg>`;
}

init().catch((e) => {
  console.error(e);
  $("#products").innerHTML = `<p class="error">Couldn't load the store. Check store.json for typos.</p>`;
});
