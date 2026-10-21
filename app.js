"use strict";

/* ---------- IndexedDB layer ---------- */

const DB_NAME = "weinkeller-db";
const STORE = "wines";
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(wine) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(wine);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- State ---------- */

let wines = [];
let activeTypeFilter = "alle";
let sortMode = "name";
let currentPhotoData = null;

const TYPE_LABELS = {
  rot: "Rot",
  weiss: "Weiss",
  rose: "Rosé",
  schaum: "Champagner",
  dessert: "Süsswein"
};
const TYPE_TAG_CLASS = {
  rot: "type-rot",
  weiss: "type-weiss",
  rose: "type-rose",
  schaum: "type-schaum",
  dessert: "type-dessert"
};

/* ---------- DOM refs ---------- */

const el = (id) => document.getElementById(id);
const wineGrid = el("wineGrid");
const emptyState = el("emptyState");
const statsLine = el("statsLine");
const sortSelect = el("sortSelect");
const typeChips = el("typeChips");

const detailOverlay = el("detailOverlay");
const detailContent = el("detailContent");
const detailClose = el("detailClose");

const formOverlay = el("formOverlay");
const formSheet = el("formSheet");
const wineForm = el("wineForm");
const formTitle = el("formTitle");
const formClose = el("formClose");
const formCancel = el("formCancel");
const typePicker = el("typePicker");
const photoPreviewImg = el("photoPreviewImg");
const photoPreviewEmpty = el("photoPreviewEmpty");
const fPhotoInput = el("fPhotoInput");
const btnRemovePhoto = el("btnRemovePhoto");

const toastEl = el("toast");

const PLACEHOLDER_GLASS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 2h8v6a4 4 0 0 1-8 0V2Z"/><path d="M12 12v8M8 20h8"/></svg>`;

/* ---------- Init ---------- */

async function init() {
  wines = await dbGetAll();
  render();
  bindEvents();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function bindEvents() {
  el("btnAdd").addEventListener("click", () => openForm(null));
  el("emptyAddBtn").addEventListener("click", () => openForm(null));

  sortSelect.addEventListener("change", () => {
    sortMode = sortSelect.value;
    render();
  });

  typeChips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    [...typeChips.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    activeTypeFilter = btn.dataset.type;
    render();
  });

  detailClose.addEventListener("click", closeDetail);
  detailOverlay.addEventListener("click", (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  formClose.addEventListener("click", closeForm);
  formCancel.addEventListener("click", closeForm);
  formOverlay.addEventListener("click", (e) => {
    if (e.target === formOverlay) closeForm();
  });

  typePicker.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    [...typePicker.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
  });

  fPhotoInput.addEventListener("change", handlePhotoChange);
  btnRemovePhoto.addEventListener("click", () => {
    currentPhotoData = null;
    updatePhotoPreview();
  });

  wineForm.addEventListener("submit", handleFormSubmit);
}

/* ---------- Rendering ---------- */

function getFilteredSortedWines() {
  let list = wines.slice();

  if (activeTypeFilter === "vorraetig") {
    list = list.filter((w) => w.quantity > 0);
  } else if (activeTypeFilter !== "alle") {
    list = list.filter((w) => w.type === activeTypeFilter);
  }

  switch (sortMode) {
    case "vintage-desc":
      list.sort((a, b) => (b.vintage || 0) - (a.vintage || 0));
      break;
    case "vintage-asc":
      list.sort((a, b) => (a.vintage || 9999) - (b.vintage || 9999));
      break;
    case "region":
      list.sort((a, b) => (a.region || "").localeCompare(b.region || "", "de"));
      break;
    case "grape":
      list.sort((a, b) => (a.grape || "").localeCompare(b.grape || "", "de"));
      break;
    case "quantity-desc":
      list.sort((a, b) => b.quantity - a.quantity);
      break;
    default:
      list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));
  }

  return list;
}

function render() {
  const list = getFilteredSortedWines();
  const totalBottles = wines.reduce((sum, w) => sum + (w.quantity || 0), 0);
  statsLine.textContent = `${wines.length} Wein${wines.length === 1 ? "" : "e"} · ${totalBottles} Flasche${totalBottles === 1 ? "" : "n"}`;

  wineGrid.innerHTML = "";

  if (wines.length === 0) {
    emptyState.classList.remove("hidden");
    wineGrid.classList.add("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  wineGrid.classList.remove("hidden");

  for (const wine of list) {
    wineGrid.appendChild(renderCard(wine));
  }

  refreshDatalists();
}

function renderCard(wine) {
  const card = document.createElement("button");
  card.className = "wine-card";
  card.type = "button";
  card.addEventListener("click", () => openDetail(wine.id));

  const photoHtml = wine.photo
    ? `<img class="wine-card__photo" src="${wine.photo}" alt="${escapeHtml(wine.name)}">`
    : `<div class="wine-card__photo wine-card__photo--placeholder">${PLACEHOLDER_GLASS}</div>`;

  const typeTag = wine.type
    ? `<span class="tag ${TYPE_TAG_CLASS[wine.type] || ""}"><span class="dot"></span>${TYPE_LABELS[wine.type] || wine.type}</span>`
    : "";
  const vintageTag = wine.vintage ? `<span class="tag">${wine.vintage}</span>` : "";
  const regionTag = wine.region ? `<span class="tag">${escapeHtml(wine.region)}</span>` : "";

  const qty = wine.quantity || 0;
  const stockHtml = qty > 0
    ? `<span class="stock-badge">${qty}×</span>`
    : `<span class="stock-badge empty">leer</span>`;

  card.innerHTML = `
    ${photoHtml}
    <div class="wine-card__body">
      <div class="wine-card__top">
        <div>
          <p class="wine-card__name serif">${escapeHtml(wine.name)}</p>
          ${wine.producer ? `<p class="wine-card__producer">${escapeHtml(wine.producer)}</p>` : ""}
        </div>
        ${stockHtml}
      </div>
      <div class="wine-card__meta">${typeTag}${vintageTag}${regionTag}</div>
    </div>
  `;
  return card;
}

function refreshDatalists() {
  const producers = [...new Set(wines.map((w) => w.producer).filter(Boolean))].sort();
  const grapes = [...new Set(wines.map((w) => w.grape).filter(Boolean))].sort();
  const regions = [...new Set(wines.map((w) => w.region).filter(Boolean))].sort();
  fillDatalist("producerList", producers);
  fillDatalist("grapeList", grapes);
  fillDatalist("regionList", regions);
}

function fillDatalist(id, values) {
  const dl = el(id);
  dl.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">`).join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ---------- Detail view ---------- */

function openDetail(id) {
  const wine = wines.find((w) => w.id === id);
  if (!wine) return;

  const photoHtml = wine.photo
    ? `<img class="detail-photo" src="${wine.photo}" alt="${escapeHtml(wine.name)}">`
    : `<div class="detail-photo detail-photo--placeholder">${PLACEHOLDER_GLASS}</div>`;

  const typeTag = wine.type
    ? `<span class="tag ${TYPE_TAG_CLASS[wine.type] || ""}"><span class="dot"></span>${TYPE_LABELS[wine.type] || wine.type}</span>`
    : "";

  const fields = [
    ["Jahrgang", wine.vintage || "—"],
    ["Rebsorte", wine.grape || "—"],
    ["Region", wine.region || "—"],
    ["Alkohol", wine.alcohol ? `${wine.alcohol} %` : "—"],
    ["Lagerort", wine.location || "—"],
    ["Preis", wine.price ? `CHF ${Number(wine.price).toFixed(2)}` : "—"]
  ];

  const fieldsHtml = fields.map(([label, value]) => `
    <div class="detail-field">
      <div class="detail-field__label">${label}</div>
      <div class="detail-field__value">${escapeHtml(String(value))}</div>
    </div>
  `).join("");

  const notesHtml = wine.notes
    ? `<div class="detail-notes">${escapeHtml(wine.notes)}</div>`
    : "";

  const reorderHtml = wine.reorderLink
    ? `<a class="reorder-link" href="${escapeHtml(wine.reorderLink)}" target="_blank" rel="noopener">Nachbestellen</a>`
    : "";

  detailContent.innerHTML = `
    <div class="detail-layout">
      <div class="detail-viewer">${photoHtml}</div>
      <div class="detail-body">
        <h2 class="detail-title serif">${escapeHtml(wine.name)}</h2>
        ${wine.producer ? `<div class="detail-producer">${escapeHtml(wine.producer)}</div>` : ""}
        <div class="detail-tags">${typeTag}</div>
        <div class="detail-grid">${fieldsHtml}</div>
        ${notesHtml}
        <div class="stock-control">
          <div>
            <div class="stock-control__label">Im Lager</div>
            <div class="stock-control__count" id="stockCount">${wine.quantity}</div>
          </div>
          <div class="stepper">
            <button type="button" id="stockMinus" aria-label="Flasche entnehmen">−</button>
            <button type="button" id="stockPlus" aria-label="Flasche hinzufügen">+</button>
          </div>
        </div>
        ${reorderHtml}
        <div class="detail-actions">
          <button class="btn" id="btnEdit">Bearbeiten</button>
          <button class="btn danger" id="btnDelete">Löschen</button>
        </div>
      </div>
    </div>
  `;

  el("stockMinus").addEventListener("click", () => adjustStock(wine.id, -1));
  el("stockPlus").addEventListener("click", () => adjustStock(wine.id, 1));
  el("btnEdit").addEventListener("click", () => {
    closeDetail();
    openForm(wine);
  });
  el("btnDelete").addEventListener("click", () => confirmDelete(wine));

  detailOverlay.classList.add("open");
}

function closeDetail() {
  detailOverlay.classList.remove("open");
}

async function adjustStock(id, delta) {
  const wine = wines.find((w) => w.id === id);
  if (!wine) return;
  wine.quantity = Math.max(0, (wine.quantity || 0) + delta);
  await dbPut(wine);
  const countEl = el("stockCount");
  if (countEl) countEl.textContent = wine.quantity;
  render();
  showToast(delta > 0 ? "Flasche hinzugefügt" : "Flasche entnommen");
}

function confirmDelete(wine) {
  if (!confirm(`"${wine.name}" wirklich aus dem Weinkeller löschen?`)) return;
  deleteWine(wine.id);
}

async function deleteWine(id) {
  await dbDelete(id);
  wines = wines.filter((w) => w.id !== id);
  closeDetail();
  render();
  showToast("Wein gelöscht");
}

/* ---------- Form (add/edit) ---------- */

function openForm(wine) {
  wineForm.reset();
  currentPhotoData = wine ? wine.photo || null : null;
  updatePhotoPreview();

  el("fId").value = wine ? wine.id : "";
  formTitle.textContent = wine ? "Wein bearbeiten" : "Wein hinzufügen";

  el("fName").value = wine ? wine.name || "" : "";
  el("fProducer").value = wine ? wine.producer || "" : "";
  el("fVintage").value = wine && wine.vintage ? wine.vintage : "";
  el("fGrape").value = wine ? wine.grape || "" : "";
  el("fAlcohol").value = wine && wine.alcohol ? wine.alcohol : "";
  el("fRegion").value = wine ? wine.region || "" : "";
  el("fQuantity").value = wine ? wine.quantity : 1;
  el("fPrice").value = wine && wine.price ? wine.price : "";
  el("fLocation").value = wine ? wine.location || "" : "";
  el("fReorderLink").value = wine ? wine.reorderLink || "" : "";
  el("fNotes").value = wine ? wine.notes || "" : "";

  const type = wine ? wine.type || "rot" : "rot";
  [...typePicker.children].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });

  formOverlay.classList.add("open");
  setTimeout(() => el("fName").focus(), 200);
}

function closeForm() {
  formOverlay.classList.remove("open");
}

function updatePhotoPreview() {
  if (currentPhotoData) {
    photoPreviewImg.src = currentPhotoData;
    photoPreviewImg.classList.remove("hidden");
    photoPreviewEmpty.classList.add("hidden");
    btnRemovePhoto.classList.remove("hidden");
  } else {
    photoPreviewImg.classList.add("hidden");
    photoPreviewEmpty.classList.remove("hidden");
    btnRemovePhoto.classList.add("hidden");
  }
}

function handlePhotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  resizeImageToDataUrl(file, 1000, 0.8).then((dataUrl) => {
    currentPhotoData = dataUrl;
    updatePhotoPreview();
    fPhotoInput.value = "";
  });
}

function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const name = el("fName").value.trim();
  if (!name) return;

  const activeTypeBtn = typePicker.querySelector(".active");
  const id = el("fId").value || cryptoRandomId();

  const wine = {
    id,
    name,
    producer: el("fProducer").value.trim(),
    vintage: el("fVintage").value ? parseInt(el("fVintage").value, 10) : null,
    type: activeTypeBtn ? activeTypeBtn.dataset.type : "rot",
    grape: el("fGrape").value.trim(),
    alcohol: el("fAlcohol").value ? parseFloat(el("fAlcohol").value) : null,
    region: el("fRegion").value.trim(),
    quantity: el("fQuantity").value ? parseInt(el("fQuantity").value, 10) : 0,
    price: el("fPrice").value ? parseFloat(el("fPrice").value) : null,
    location: el("fLocation").value.trim(),
    reorderLink: el("fReorderLink").value.trim(),
    notes: el("fNotes").value.trim(),
    photo: currentPhotoData,
    dateAdded: el("fId").value
      ? (wines.find((w) => w.id === id) || {}).dateAdded || new Date().toISOString()
      : new Date().toISOString()
  };

  await dbPut(wine);

  const idx = wines.findIndex((w) => w.id === id);
  if (idx >= 0) wines[idx] = wine;
  else wines.push(wine);

  closeForm();
  render();
  showToast("Gespeichert");
}

function cryptoRandomId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "w-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

/* ---------- Toast ---------- */

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

/* ---------- Go ---------- */

init();
