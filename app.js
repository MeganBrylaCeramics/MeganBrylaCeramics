(async function () {
  const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => r.json());
  const [SHOP, { products: RAW }] = await Promise.all([get("content/shop.json"), get("content/products.json")]);
  const PRODUCTS = (RAW || []).map((p, i) => ({ ...p, id: "p" + i }));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const $ = (s, r = document) => r.querySelector(s);
  const money = (n) => "$" + Number(n).toFixed(n % 1 ? 2 : 0);

  // Fill shop info
  document.querySelectorAll("[data-shop]").forEach((el) => {
    el.textContent = SHOP[el.dataset.shop] || "";
  });
  document.title = SHOP.name + " | Handmade Ceramics";
  $("#year").textContent = new Date().getFullYear();
  $("#email-link").href = "mailto:" + SHOP.email;
  $("#email-link").textContent = SHOP.email;
  if (SHOP.instagram) {
    $("#ig-link").href = "https://instagram.com/" + SHOP.instagram;
    $("#ig-link").textContent = "@" + SHOP.instagram;
  } else {
    $("#ig-wrap").remove();
  }

  const venmoUrl = (amount, note) => {
    const p = new URLSearchParams({ txn: "pay" });
    if (amount) p.set("amount", amount);
    if (note) p.set("note", note);
    return "https://venmo.com/" + encodeURIComponent(SHOP.venmo) + "?" + p.toString();
  };
  $("#venmo-general").href = venmoUrl(null, "Local pickup: ");

  const placeholder = (color) =>
    `<svg viewBox="0 0 200 200" class="ph" aria-hidden="true">
       <rect width="200" height="200" fill="${color}" opacity=".18"/>
       <path d="M70 55h60c0 18-8 22-8 36 0 22 22 30 22 58 0 18-16 26-44 26s-44-8-44-26c0-28 22-36 22-58 0-14-8-18-8-36z" fill="${color}"/>
       <ellipse cx="100" cy="55" rx="30" ry="6" fill="#000" opacity=".15"/>
     </svg>`;

  // Render grid
  const grid = $("#grid");
  function render(filter) {
    const list = PRODUCTS.filter((p) =>
      filter === "all" ? true : filter === "local" ? p.localOnly && !p.sold : !p.sold
    );
    grid.innerHTML = list.length
      ? list.map(card).join("")
      : `<p class="muted">Nothing here right now. Check back soon!</p>`;
  }
  function card(p) {
    const img = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
      : placeholder(p.color || "#b9a58c");
    const badge = p.sold
      ? `<span class="badge sold">Sold</span>`
      : p.localOnly ? `<span class="badge">Local pickup only</span>` : "";
    const actions = p.sold
      ? `<button class="btn btn-ghost" disabled>Sold</button>`
      : `${p.localOnly || !p.stripeLink ? "" : `<a class="btn btn-primary" href="${esc(p.stripeLink)}" target="_blank" rel="noopener">Buy &amp; ship</a>`}
         <button class="btn btn-ghost" data-pickup="${p.id}">Local pickup</button>`;
    return `<article class="card ${p.sold ? "is-sold" : ""}">
      <div class="media">${img}${badge}</div>
      <div class="body">
        <div class="row"><h3>${esc(p.name)}</h3><span class="price">${money(p.price)}</span></div>
        <p class="desc">${esc(p.description)}</p>
        <div class="actions">${actions}</div>
      </div>
    </article>`;
  }

  document.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      render(c.dataset.filter);
    })
  );

  // Pickup dialog
  const dlg = $("#pickup-dialog");
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pickup]");
    if (!btn) return;
    const p = PRODUCTS.find((x) => x.id === btn.dataset.pickup);
    const note = `Pickup: ${p.name}`;
    $("#pd-name").textContent = p.name;
    $("#pd-price").textContent = money(p.price);
    $("#pd-note").textContent = `"${note}"`;
    $("#pd-venmo").href = venmoUrl(p.price, note);
    $("#pd-stripe").href = p.stripeLink || "#";
    $("#pd-stripe").closest(".pd-option").hidden = !p.stripeLink;
    $("#pd-email").href = `mailto:${SHOP.email}?subject=${encodeURIComponent("Is the " + p.name + " still available?")}`;
    dlg.showModal();
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  render("available");
})();
