/* ==========================================================================
   Haruhay - Holding Station (frontend prototype)
   Delivery holding and walk-in inquiries.
   Sample data only: nothing is saved when the page is refreshed.
   ========================================================================== */


/* ==========================================================================
   1. HELPERS
   ========================================================================== */

// Shortcut for document.querySelector
function $(selector) {
  return document.querySelector(selector);
}

// Escape text before putting it into HTML (prevents broken markup / injection)
function escapeHtml(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/[&<>"']/g, (character) => map[character]);
}

// Current date and time, e.g. "Oct 28, 2026 · 10:20 AM"
function now() {
  return new Date()
    .toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/, (\d+:)/, " · $1");
}

// Short date for the "Collected" label, e.g. "Oct 28"
function shortDate() {
  return now().split(",")[0];
}

// Turns 41 into "HS-0041"
function makeCode(id) {
  return "HS-" + String(id).padStart(4, "0");
}


/* ==========================================================================
   2. ICONS (simple inline SVG paths)
   ========================================================================== */

const ICON_PATHS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
};

// Returns an <svg> string for the given icon name
function icon(name, size = 20) {
  return (
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    ICON_PATHS[name] +
    "</svg>"
  );
}


/* ==========================================================================
   3. SAMPLE DATA
   ========================================================================== */

// Residents (the "Held for" list). Each has a room and a resident ID.
const RESIDENTS = {
  "Andrea S.": { room: "204", id: "RES-0204" },
  "Marco R.": { room: "101", id: "RES-0101" },
  "Lea T.": { room: "312", id: "RES-0312" },
};

// Storage slots (shelves) at the holding station
const SLOTS = ["A-1", "A-2", "A-3", "A-4", "B-1", "B-2"];

// Item categories
const CATEGORIES = ["Parcel", "Letter / document", "Food delivery", "Other"];

// Creates one holding record (HoldingItem). Status defaults to "Ready".
function createItem(id, category, description, sender, tracking, resident, slot, received, pin, status) {
  return {
    id: id,
    code: makeCode(id),
    category: category,
    description: description,
    sender: sender,
    depositor: "Courier / sender",
    tracking: tracking,
    resident: resident,
    room: RESIDENTS[resident].room,
    slot: slot,
    received: received,
    pin: pin, // 6-digit pickup code shown to the resident
    status: status || "Ready", // "Ready" or "Claimed"
    history: ["Received · " + received + " · Slot " + slot],
  };
}


/* ==========================================================================
   4. APP STATE
   ========================================================================== */

const state = {
  role: "resident", // "resident" or "guard" (front desk)
  tab: "records", // front desk tab: "records", "record" or "inquiry"
  search: "", // search text for the holding records table
  statusFilter: "all", // "all", "Ready" or "Claimed"
  nextId: 45, // id given to the next new holding record
  lastMatches: null, // item ids found by the latest walk-in inquiry
  lastVisitor: null, // visitor details from the latest inquiry
  inquiries: [], // walk-in inquiry log
  items: [
    createItem(39, "Parcel", "Lazada package", "Lazada", "LZ-90321", "Andrea S.", "A-1", "Oct 2, 2026 · 3:15 PM", "480213", "Claimed"),
    createItem(41, "Parcel", "Shopee parcel", "Shopee", "SPX-77412", "Andrea S.", "A-3", "Oct 8, 2026 · 10:20 AM", "519304"),
    createItem(42, "Letter / document", "Letter / document", "City Hall", "", "Andrea S.", "B-2", "Oct 7, 2026 · 2:35 PM", "702158"),
    createItem(43, "Parcel", "J&T parcel", "J&T Express", "JT-55120", "Marco R.", "A-2", "Oct 9, 2026 · 9:05 AM", "338870"),
    createItem(44, "Letter / document", "Bank statement", "BPI", "", "Lea T.", "B-1", "Oct 10, 2026 · 1:40 PM", "665902"),
  ],
};

// The first sample item was already collected, so give it a claim record
state.items[0].claimed = "Oct 3";
state.items[0].history.push("Claimed · Oct 3 · released to Andrea S.");

// Finds a holding record by id
function findItem(id) {
  return state.items.find((item) => item.id == id);
}

// Slots that are currently occupied by items waiting for pickup
function occupiedSlots() {
  return state.items.filter((item) => item.status === "Ready").map((item) => item.slot);
}


/* ==========================================================================
   5. UI HELPERS (toast, modal, theme, role)
   ========================================================================== */

// Small message at the bottom of the screen
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => (toast.style.display = "none"), 2600);
}

// Opens the pop-up window with the given HTML
function openModal(html) {
  $("#mb").innerHTML = html;
  $("#modal").classList.add("on");
}

function closeModal() {
  $("#modal").classList.remove("on");
}

// Switches between light mode and dark mode (button in the top bar)
function theme() {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;

  root.dataset.theme = isDark ? "light" : "dark";
  $("#th").textContent = isDark ? "Dark" : "Light";
}

// Switches between the Resident view and the Front desk view
function switchRole(role) {
  state.role = role;
  render();
}

// Switches the front desk tab
function switchTab(tab) {
  state.tab = tab;
  render();
}


/* ==========================================================================
   6. MAIN RENDER (sidebar, top bar, and the current page)
   ========================================================================== */

function render() {
  const isGuard = state.role === "guard";

  // Role toggle (Resident / Front desk)
  const roles = [["resident", "Resident"], ["guard", "Front desk"]];
  $("#seg").innerHTML = roles
    .map(([value, label]) => {
      const active = state.role === value ? "on" : "";
      return '<button class="' + active + '" onclick="switchRole(\'' + value + '\')">' + label + "</button>";
    })
    .join("");

  // Sidebar label and top bar user
  $("#portal").textContent = isGuard ? "FRONT DESK" : "RESIDENT PORTAL";
  $("#av").textContent = isGuard ? "SG" : "AS";
  $("#who").textContent = isGuard ? "Security Guard" : "Andrea S.";

  // Sidebar menu (only "Holding station" is active in this prototype)
  const menu = [
    ["home", "Dashboard"], ["book", "Logbook"], ["tool", "Maintenance"], ["box", "Holding station"],
    ["card", "Payments"], ["heart", "Community"], ["user", "My profile"],
  ];
  $("#nav").innerHTML = menu
    .map(([iconName, label]) => {
      const active = label === "Holding station" ? "on" : "";
      return '<button class="' + active + '">' + icon(iconName, 18) + label + "</button>";
    })
    .join("");

  // Page content
  $("#view").innerHTML = isGuard ? guardView() : residentView();
  if (isGuard) {
    drawRecordRows();
  }
}


/* ==========================================================================
   7. RESIDENT VIEW (design made by the team leader)
   ========================================================================== */

function residentView() {
  const myItems = state.items.filter((item) => item.resident === "Andrea S.");
  const ready = myItems.filter((item) => item.status === "Ready");
  const collected = myItems.filter((item) => item.status === "Claimed");

  // Banner text depends on how many packages are waiting
  let bannerTitle = "Nothing waiting right now";
  if (ready.length > 0) {
    bannerTitle = ready.length + (ready.length > 1 ? " packages are" : " package is") + " ready for you";
  }

  const readyCards =
    ready.map(readyCard).join("") || '<div class="card sub">No items to collect.</div>';
  const collectedCards =
    collected.map(collectedCard).join("") || '<div class="card sub">Nothing collected yet.</div>';

  return `
    <div class="eyebrow">YOUR DELIVERIES</div>
    <h1>Holding station</h1>
    <p class="sub">Every item is kept safely until you are ready to collect.</p>

    <div class="hero">
      ${icon("box", 32)}
      <div>
        <h2>${bannerTitle}</h2>
        <p>Please show your resident ID or pickup code at the front desk.</p>
        <span class="pill">PICKUP • FRONT DESK</span>
      </div>
    </div>

    <div class="row"><h3>Ready for pickup</h3><a>View all →</a></div>
    <div class="grid2">${readyCards}</div>

    <div class="row"><h3>Recently collected</h3><a>History →</a></div>
    ${collectedCards}`;
}

// Card for an item that is ready for pickup
function readyCard(item) {
  const iconName = item.category === "Parcel" ? "box" : "file";
  return `
    <div class="card">
      <h4>${escapeHtml(item.description)}</h4>
      <div class="meta">${icon(iconName, 26)}Received ${escapeHtml(item.received)}</div>
      <div class="foot">
        <span class="tag">Shelf ${item.slot}</span>
        <button class="btn" onclick="showPickupDetails(${item.id})">View pickup details</button>
      </div>
    </div>`;
}

// Card for an item that was already collected
function collectedCard(item) {
  return `
    <div class="card">
      <div class="rc">
        <h4 style="margin:0">${escapeHtml(item.description)}</h4>
        <span class="tag ok">Collected ${escapeHtml(item.claimed)}</span>
      </div>
      <small style="color:var(--mut)">${item.code} · Room ${item.room} · Front desk</small>
    </div>`;
}

// Pop-up with the pickup code (resident shows this at the front desk)
function showPickupDetails(id) {
  const item = findItem(id);
  const from = item.sender ? " · From " + escapeHtml(item.sender) : "";

  openModal(`
    <h3>${escapeHtml(item.description)}</h3>
    <p class="sub">${item.code} · Shelf ${item.slot}</p>
    <p style="margin:0;color:var(--mut)">Show this pickup code, or your resident ID, at the front desk.</p>
    <div class="code">${item.pin}</div>
    <div class="meta" style="margin:0">Received ${escapeHtml(item.received)}${from}</div>
    <div class="acts"><button class="btn p" onclick="closeModal()">Done</button></div>`);
}


/* ==========================================================================
   8. FRONT DESK VIEW (security guard)
   ========================================================================== */

function guardView() {
  const heldCount = state.items.filter((item) => item.status === "Ready").length;
  const collectedCount = state.items.length - heldCount;
  const inquiryCount = state.inquiries.length;

  const tabs = [
    ["records", "Holding records"],
    ["record", "Record held item"],
    ["inquiry", "Walk-in inquiries"],
  ];
  const tabButtons = tabs
    .map(([value, label]) => {
      const active = state.tab === value ? "on" : "";
      return '<button class="' + active + '" onclick="switchTab(\'' + value + '\')">' + label + "</button>";
    })
    .join("");

  // Pick the content of the selected tab
  let content;
  if (state.tab === "records") {
    content = recordsTab();
  } else if (state.tab === "record") {
    content = recordItemTab();
  } else {
    content = inquiryTab();
  }

  return `
    <div class="eyebrow">FRONT DESK</div>
    <h1>Holding station</h1>
    <p class="sub">Record, track and release held items, and handle walk-in inquiries.</p>

    <div class="hero">
      ${icon("box", 32)}
      <div>
        <h2>${heldCount} item${heldCount === 1 ? "" : "s"} held at the station</h2>
        <p>${collectedCount} collected · ${inquiryCount} walk-in inquir${inquiryCount === 1 ? "y" : "ies"} logged this session</p>
        <span class="pill">VERIFY ID BEFORE RELEASE</span>
      </div>
    </div>

    <div class="tabs">${tabButtons}</div>
    ${content}`;
}


/* --------------------------------------------------------------------------
   8a. Holding records tab (view / search / release / update / delete)
   -------------------------------------------------------------------------- */

function recordsTab() {
  const filters = [["all", "All status"], ["Ready", "Ready for pickup"], ["Claimed", "Collected"]];
  const filterOptions = filters
    .map(([value, label]) => {
      const selected = state.statusFilter === value ? "selected" : "";
      return '<option value="' + value + '" ' + selected + ">" + label + "</option>";
    })
    .join("");

  return `
    <div class="tools">
      <input placeholder="Search code, item, resident, tracking no."
             value="${escapeHtml(state.search)}"
             oninput="state.search = this.value; drawRecordRows()">
      <select onchange="state.statusFilter = this.value; drawRecordRows()">${filterOptions}</select>
    </div>
    <div class="card tw" style="padding:4px">
      <table>
        <thead>
          <tr><th>Item</th><th>Held for</th><th>Slot</th><th>Received</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>`;
}

// Fills the table body with the records that match the search and filter
function drawRecordRows() {
  const tbody = $("#rows");
  if (!tbody) {
    return;
  }

  const text = state.search.toLowerCase();
  const visible = state.items.filter((item) => {
    const matchesStatus = state.statusFilter === "all" || item.status === state.statusFilter;
    const searchable = [item.code, item.description, item.resident, item.tracking, item.room].join(" ").toLowerCase();
    return matchesStatus && (!text || searchable.includes(text));
  });

  if (visible.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--mut)">No records found</td></tr>';
    return;
  }
  tbody.innerHTML = visible.map(recordRow).join("");
}

// One table row (one holding record)
function recordRow(item) {
  const isReady = item.status === "Ready";
  const trackingText = item.tracking ? " · " + escapeHtml(item.tracking) : "";
  const statusClass = isReady ? "warn" : "ok";
  const statusText = isReady ? "Ready" : "Collected";
  const releaseButton = isReady
    ? '<button class="btn s p" onclick="openReleaseForm(' + item.id + ')">Release</button>'
    : "";

  return `
    <tr>
      <td><b>${escapeHtml(item.description)}</b><small>${item.code}${trackingText}</small></td>
      <td>${escapeHtml(item.resident)}<small>Room ${item.room}</small></td>
      <td>${item.slot}</td>
      <td>${escapeHtml(item.received)}</td>
      <td><span class="tag ${statusClass}">${statusText}</span></td>
      <td>
        <div class="acts">
          ${releaseButton}
          <button class="btn s" onclick="showDetails(${item.id})">Details</button>
          <button class="btn s" onclick="openEditForm(${item.id})">Edit</button>
          <button class="btn s d" onclick="confirmDelete(${item.id})">Delete</button>
        </div>
      </td>
    </tr>`;
}

// Pop-up with the full details and status history of a record
function showDetails(id) {
  const item = findItem(id);
  const historyList = item.history.map((line) => "<li>" + escapeHtml(line) + "</li>").join("");

  openModal(`
    <h3>${escapeHtml(item.description)}</h3>
    <p class="sub">${item.code} · ${escapeHtml(item.category)} · Slot ${item.slot}</p>
    <div class="meta" style="display:block;margin:0">
      Held for ${escapeHtml(item.resident)} (Room ${item.room})<br>
      Dropped off by ${escapeHtml(item.sender || "—")} (${escapeHtml(item.depositor)})<br>
      Tracking no.: ${escapeHtml(item.tracking || "—")}
    </div>
    <b style="font-size:12px;display:block;margin-top:12px">Status history</b>
    <ul class="log">${historyList}</ul>
    <div class="acts"><button class="btn p" onclick="closeModal()">Close</button></div>`);
}

// Pop-up form to update the description or the storage slot
function openEditForm(id) {
  const item = findItem(id);
  const takenByOthers = occupiedSlots().filter((slot) => slot !== item.slot);

  const slotOptions = SLOTS.map((slot) => {
    const selected = slot === item.slot ? "selected" : "";
    const disabled = takenByOthers.includes(slot) ? "disabled" : "";
    return "<option " + selected + " " + disabled + ">" + slot + "</option>";
  }).join("");

  openModal(`
    <h3>Edit holding record</h3>
    <p class="sub">${item.code}</p>
    <form class="f" onsubmit="return saveEdit(event, ${id})">
      <label class="w">Item description
        <input name="description" value="${escapeHtml(item.description)}">
      </label>
      <label class="w">Storage slot
        <select name="slot">${slotOptions}</select>
      </label>
      <div class="acts w">
        <button type="button" class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn p">Save</button>
      </div>
    </form>`);
}

function saveEdit(event, id) {
  event.preventDefault();
  const form = event.target;
  const item = findItem(id);

  if (!form.description.value.trim()) {
    showToast("Description is required");
    return false;
  }

  // Keep a history entry when the slot changes
  if (form.slot.value !== item.slot) {
    item.history.push("Slot changed " + item.slot + " → " + form.slot.value + " · " + now());
  }
  item.description = form.description.value.trim();
  item.slot = form.slot.value;

  closeModal();
  render();
  showToast("Record updated");
  return false;
}

// Asks for confirmation before deleting a record
function confirmDelete(id) {
  const item = findItem(id);

  openModal(`
    <h3>Delete this record?</h3>
    <p class="sub">${item.code} · ${escapeHtml(item.description)}. This removes it from the holding records.</p>
    <div class="acts">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn p" onclick="deleteItem(${id})">Delete</button>
    </div>`);
}

function deleteItem(id) {
  state.items = state.items.filter((item) => item.id != id);
  closeModal();
  render();
  showToast("Record deleted");
}


/* --------------------------------------------------------------------------
   8b. Release (claim) an item: verify ID, then release
   -------------------------------------------------------------------------- */

// Pop-up form for releasing an item. "errorMessage" is shown when validation fails.
function openReleaseForm(id, errorMessage) {
  const item = findItem(id);
  const visitor = state.lastVisitor || {}; // pre-filled when coming from a walk-in inquiry
  const owner = RESIDENTS[item.resident];
  const errorBox = errorMessage ? '<div class="note bad">' + errorMessage + "</div>" : "";

  openModal(`
    <h3>Release ${escapeHtml(item.description)}</h3>
    <p class="sub">${item.code} · Held for ${escapeHtml(item.resident)} · Slot ${item.slot}</p>
    ${errorBox}
    <form class="f" style="grid-template-columns:1fr" onsubmit="return confirmRelease(event, ${id})">
      <label>ID number presented (scan or type)
        <input name="idNumber" value="${escapeHtml(visitor.idNumber || "")}" placeholder="e.g. ${owner.id}">
      </label>
      <label>Claimed by
        <input name="claimedBy" value="${escapeHtml(visitor.name || item.resident)}">
      </label>
      <label>Relationship to owner
        <select name="relationship">
          <option>Owner</option>
          <option>Authorized representative</option>
        </select>
      </label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:500">
        <input type="checkbox" name="signed" style="width:auto">Claimant signed / confirmed receipt
      </label>
      <div class="note warn" style="margin:0">
        Prototype hint: ${escapeHtml(item.resident)}’s resident ID is ${owner.id}.
      </div>
      <div class="acts">
        <button type="button" class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn p">Confirm release</button>
      </div>
    </form>`);
}

// Validates the release form and, if everything is correct, marks the item as claimed
function confirmRelease(event, id) {
  event.preventDefault();
  const form = event.target;
  const item = findItem(id);
  const idNumber = form.idNumber.value.trim();
  const claimedBy = form.claimedBy.value.trim();
  const relationship = form.relationship.value;

  // 1. An ID must be presented
  if (!idNumber) {
    openReleaseForm(id, "Scan or enter the ID presented.");
    return false;
  }

  // 2. The owner's ID must match the record, otherwise the claim is denied
  if (relationship === "Owner" && idNumber.toUpperCase() !== RESIDENTS[item.resident].id) {
    item.history.push("Claim denied (ID mismatch) · " + now());
    openReleaseForm(id, "ID does not match the record. Deny the claim, or choose “Authorized representative”.");
    return false;
  }

  // 3. The claimant's name and signature are required
  if (!claimedBy) {
    openReleaseForm(id, "Enter the claimant’s name.");
    return false;
  }
  if (!form.signed.checked) {
    openReleaseForm(id, "Claimant must sign or confirm receipt.");
    return false;
  }

  // All checks passed: update the item status and keep the claim history
  item.status = "Claimed";
  item.claimed = shortDate();
  item.history.push(
    "Claimed · " + now() + " · released to " + claimedBy + " (" + relationship + ", ID " + idNumber + ")"
  );

  // Remove the released item from the latest inquiry results
  if (state.lastMatches) {
    state.lastMatches = state.lastMatches.filter((matchId) => matchId !== id);
  }
  state.lastVisitor = null;

  closeModal();
  render();
  showToast("Item released to " + claimedBy);
  return false;
}


/* --------------------------------------------------------------------------
   8c. Record held item tab (create a new holding record)
   -------------------------------------------------------------------------- */

function recordItemTab() {
  const taken = occupiedSlots();

  const residentOptions = Object.keys(RESIDENTS)
    .map((name) => "<option>" + name + "</option>")
    .join("");
  const categoryOptions = CATEGORIES.map((category) => "<option>" + category + "</option>").join("");
  const slotOptions = SLOTS.map((slot) => {
    const isTaken = taken.includes(slot);
    return "<option " + (isTaken ? "disabled" : "") + ">" + slot + (isTaken ? " (occupied)" : "") + "</option>";
  }).join("");

  return `
    <div class="card">
      <form class="f" onsubmit="return addItem(event)">
        <label>Held for (resident)
          <select name="resident"><option value="">Select resident…</option>${residentOptions}</select>
        </label>
        <label>Category
          <select name="category">${categoryOptions}</select>
        </label>
        <label class="w">Item description
          <input name="description" placeholder="e.g. Shopee parcel, medium box">
        </label>
        <label>Dropped off by
          <select name="depositor">
            <option>Courier / sender</option>
            <option>Visitor</option>
            <option>Resident</option>
          </select>
        </label>
        <label>Sender / carrier name
          <input name="sender" placeholder="e.g. J&amp;T Express">
        </label>
        <label>Tracking number (optional)
          <input name="tracking">
        </label>
        <label>Storage slot
          <select name="slot">${slotOptions}</select>
        </label>
        <div class="acts w" style="justify-content:flex-end">
          <button class="btn p">Save holding record</button>
        </div>
      </form>
    </div>`;
}

function addItem(event) {
  event.preventDefault();
  const form = event.target;

  // Required fields
  if (!form.resident.value || !form.description.value.trim()) {
    showToast("Select a resident and describe the item");
    return false;
  }

  const id = state.nextId++;
  const slot = form.slot.value.split(" ")[0]; // removes the "(occupied)" text if present
  const received = now();

  state.items.unshift({
    id: id,
    code: makeCode(id),
    category: form.category.value,
    description: form.description.value.trim(),
    sender: form.sender.value.trim(),
    depositor: form.depositor.value,
    tracking: form.tracking.value.trim(),
    resident: form.resident.value,
    room: RESIDENTS[form.resident.value].room,
    slot: slot,
    received: received,
    pin: String(Math.floor(100000 + Math.random() * 900000)),
    status: "Ready",
    history: ["Received · " + received + " · Slot " + slot, "Resident notified for pickup"],
  });

  state.tab = "records";
  render();
  showToast("Holding record saved · resident notified");
  return false;
}


/* --------------------------------------------------------------------------
   8d. Walk-in inquiries tab (visitor asks about a held item)
   -------------------------------------------------------------------------- */

function inquiryTab() {
  const residentOptions = Object.keys(RESIDENTS)
    .map((name) => "<option>" + name + "</option>")
    .join("");

  // Results of the latest search (if any)
  let resultsHtml = "";
  if (state.lastMatches) {
    if (state.lastMatches.length > 0) {
      const count = state.lastMatches.length;
      resultsHtml =
        '<div class="note ok">' + count + " matching item" + (count > 1 ? "s" : "") + " found.</div>" +
        state.lastMatches.map(matchCard).join("");
    } else {
      resultsHtml =
        '<div class="note bad">No matching item in the holding station. ' +
        "Ask the visitor to check the tracking number or the resident’s name.</div>";
    }
  }

  // Inquiry log table
  const logRows =
    state.inquiries
      .map(
        (entry) => `
        <tr>
          <td>${escapeHtml(entry.time)}</td>
          <td>${escapeHtml(entry.name)}</td>
          <td>${escapeHtml(entry.id)}</td>
          <td>${escapeHtml(entry.lookingFor)}</td>
          <td>${escapeHtml(entry.purpose)}</td>
          <td><span class="tag ${entry.result === "No match" ? "bad" : "ok"}">${escapeHtml(entry.result)}</span></td>
        </tr>`
      )
      .join("") ||
    '<tr><td colspan="6" style="text-align:center;color:var(--mut)">No inquiries yet</td></tr>';

  return `
    <div class="card">
      <form class="f" onsubmit="return searchInquiry(event)">
        <label>Visitor name<input name="name"></label>
        <label>ID type
          <select name="idType">
            <option>Student ID</option>
            <option>Driver’s license</option>
            <option>UMID</option>
            <option>National ID</option>
          </select>
        </label>
        <label>ID number<input name="idNumber"></label>
        <label>Purpose
          <select name="purpose">
            <option>Pick up item</option>
            <option>Ask about a delivery</option>
          </select>
        </label>
        <label>Looking for (resident)
          <select name="resident"><option value="">Not sure</option>${residentOptions}</select>
        </label>
        <label>Tracking number<input name="tracking" placeholder="Optional"></label>
        <div class="acts w" style="justify-content:flex-end">
          <button class="btn p">Search holding records</button>
        </div>
      </form>
    </div>

    ${resultsHtml}

    <div class="row"><h3>Inquiry log</h3></div>
    <div class="card tw" style="padding:4px">
      <table>
        <thead>
          <tr><th>Time</th><th>Visitor</th><th>ID</th><th>Looking for</th><th>Purpose</th><th>Result</th></tr>
        </thead>
        <tbody>${logRows}</tbody>
      </table>
    </div>`;
}

// Card for one matching item in the inquiry results
function matchCard(id) {
  const item = findItem(id);
  return `
    <div class="card rc" style="margin-bottom:10px">
      <div>
        <b>${escapeHtml(item.description)}</b><br>
        <small>${item.code} · ${escapeHtml(item.resident)} · Room ${item.room} · Slot ${item.slot}</small>
      </div>
      <button class="btn s p" onclick="openReleaseForm(${id})">Release</button>
    </div>`;
}

// Searches the holding records for the visitor's inquiry and logs it
function searchInquiry(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const idNumber = form.idNumber.value.trim();
  const resident = form.resident.value;
  const tracking = form.tracking.value.trim();

  // Required fields
  if (!name || !idNumber) {
    showToast("Enter the visitor’s name and ID number");
    return false;
  }
  if (!resident && !tracking) {
    showToast("Enter a resident or a tracking number");
    return false;
  }

  // A tracking number is the most exact match; otherwise match by resident
  const matches = state.items.filter((item) => {
    if (item.status !== "Ready") {
      return false;
    }
    if (tracking) {
      return item.tracking.toLowerCase() === tracking.toLowerCase();
    }
    return item.resident === resident;
  });

  state.lastMatches = matches.map((item) => item.id);
  state.lastVisitor = { name: name, idNumber: idNumber };

  // Add the inquiry to the log (newest first)
  let result = "No match";
  if (matches.length > 0) {
    result = matches.length + " match" + (matches.length > 1 ? "es" : "");
  }
  state.inquiries.unshift({
    time: now(),
    name: name,
    id: form.idType.value + " " + idNumber,
    lookingFor: resident || tracking,
    purpose: form.purpose.value,
    result: result,
  });

  render();
  return false;
}


/* ==========================================================================
   9. START THE APP
   ========================================================================== */

// If the device uses dark mode, the theme button should offer "Light"
if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  $("#th").textContent = "Light";
}

render();
