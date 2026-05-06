// Tiny admin SPA. No build step; runs straight from /admin/.
// All requests go to the same origin and include the session cookie.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SubState = { page: 1, pageSize: 50, total: 0, status: "", q: "" };
const CampaignState = { editingId: null };

document.addEventListener("DOMContentLoaded", main);

async function main() {
  wireLogin();
  wireTabs();
  wireSubscribersUI();
  wireCampaignsUI();
  await refreshAuth();
}

// ---------- API helpers ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: opts.body
      ? { "content-type": "application/json", ...(opts.headers || {}) }
      : opts.headers,
    ...opts,
  });
  if (res.status === 401 || res.status === 403) {
    showLogin();
    throw new Error(`auth: ${res.status}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  return res.headers.get("content-type")?.includes("application/json")
    ? res.json()
    : res.text();
}

// ---------- Auth ----------

function wireLogin() {
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    if (!email) return;
    $("#login-status").textContent = "Sending…";
    try {
      await api("/api/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email, next: location.origin + "/admin/" }),
      });
      $("#login-status").textContent = "Check your inbox for a sign-in link.";
    } catch (err) {
      $("#login-status").textContent = err.message;
    }
  });
}

async function refreshAuth() {
  try {
    const { user } = await fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    if (!user.is_admin) {
      $("#login-status").textContent = "That account isn't an admin. Sign in with the admin email.";
      showLogin();
      return;
    }
    showDashboard(user);
  } catch {
    showLogin();
  }
}

function showLogin() {
  $("#login-view").hidden = false;
  $("#dashboard-view").hidden = true;
  $("#user-status").innerHTML = "";
}

function showDashboard(user) {
  $("#login-view").hidden = true;
  $("#dashboard-view").hidden = false;
  $("#user-status").innerHTML = `<span>${escape(user.email)}</span>`;
  const logout = document.createElement("button");
  logout.textContent = "Log out";
  logout.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.reload();
  });
  $("#user-status").appendChild(logout);
  loadSubscribers();
  loadCampaigns();
}

// ---------- Tabs ----------

function wireTabs() {
  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  });
}

function selectTab(name) {
  $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $("#subscribers-tab").hidden = name !== "subscribers";
  $("#campaigns-tab").hidden = name !== "campaigns";
}

// ---------- Subscribers ----------

function wireSubscribersUI() {
  $("#sub-search").addEventListener("input", debounce(() => {
    SubState.q = $("#sub-search").value.trim();
    SubState.page = 1;
    loadSubscribers();
  }, 250));
  $("#sub-status").addEventListener("change", () => {
    SubState.status = $("#sub-status").value;
    SubState.page = 1;
    loadSubscribers();
  });
  $("#sub-refresh").addEventListener("click", loadSubscribers);
  $("#sub-prev").addEventListener("click", () => {
    if (SubState.page > 1) { SubState.page -= 1; loadSubscribers(); }
  });
  $("#sub-next").addEventListener("click", () => {
    const maxPage = Math.max(1, Math.ceil(SubState.total / SubState.pageSize));
    if (SubState.page < maxPage) { SubState.page += 1; loadSubscribers(); }
  });
  $("#sub-export").addEventListener("click", (e) => {
    e.preventDefault();
    const qs = subscriberQueryString(false);
    location.href = `/api/admin/subscribers.csv${qs}`;
  });
}

async function loadSubscribers() {
  const qs = subscriberQueryString(true);
  const data = await api(`/api/admin/subscribers${qs}`);
  SubState.total = data.total;
  $("#sub-page").textContent = `page ${data.page}`;
  $("#sub-total").textContent = `${data.total} total`;
  renderSubscribers(data.items);
}

function subscriberQueryString(includePagination) {
  const params = new URLSearchParams();
  if (SubState.status) params.set("status", SubState.status);
  if (SubState.q) params.set("q", SubState.q);
  if (includePagination) {
    params.set("page", String(SubState.page));
    params.set("page_size", String(SubState.pageSize));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function renderSubscribers(items) {
  const tbody = $("#sub-table tbody");
  tbody.innerHTML = "";
  for (const r of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${escape(r.email)}</td>
      <td>${escape(r.status)}</td>
      <td>${escape(r.created_at)}</td>
      <td>${escape(r.confirmed_at || "")}</td>
      <td><button data-id="${r.id}" class="sub-del">Delete</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("button.sub-del").forEach((b) => {
    b.addEventListener("click", () => deleteSubscriber(Number(b.dataset.id)));
  });
}

async function deleteSubscriber(id) {
  if (!confirm(`Delete subscriber #${id}? This is permanent.`)) return;
  await api(`/api/admin/subscribers/${id}`, { method: "DELETE" });
  loadSubscribers();
}

// ---------- Campaigns ----------

function wireCampaignsUI() {
  $("#campaigns-refresh").addEventListener("click", loadCampaigns);
  $("#campaign-new").addEventListener("click", () => openCampaignEditor(null));
  $("#campaign-cancel").addEventListener("click", closeCampaignEditor);
  $("#campaign-form").addEventListener("submit", saveCampaign);
  $("#campaign-test").addEventListener("click", sendTest);
  $("#campaign-send").addEventListener("click", sendToAll);
}

async function loadCampaigns() {
  const data = await api("/api/admin/campaigns");
  const tbody = $("#campaigns-table tbody");
  tbody.innerHTML = "";
  for (const c of data.items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${escape(c.subject)}</td>
      <td>${escape(c.status)}</td>
      <td>${escape(c.created_at)}</td>
      <td>${escape(c.sent_at || "")}</td>
      <td><button data-id="${c.id}" class="camp-edit">${c.status === "draft" ? "Edit" : "View"}</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("button.camp-edit").forEach((b) => {
    b.addEventListener("click", () => openCampaignEditor(Number(b.dataset.id)));
  });
}

async function openCampaignEditor(id) {
  CampaignState.editingId = id;
  const editor = $("#campaign-editor");
  editor.hidden = false;
  $("#campaign-status").textContent = "";
  if (id == null) {
    $("#campaign-editor-title").textContent = "New draft";
    $("#campaign-form").reset();
    return;
  }
  const c = await api(`/api/admin/campaigns/${id}`);
  $("#campaign-editor-title").textContent = `Edit: ${c.subject} (${c.status})`;
  $("#campaign-form").subject.value = c.subject;
  $("#campaign-form").html_body.value = c.html_body || "";
  $("#campaign-form").text_body.value = c.text_body || "";
  $("#campaign-send").disabled = c.status !== "draft";
}

function closeCampaignEditor() {
  $("#campaign-editor").hidden = true;
  CampaignState.editingId = null;
}

async function saveCampaign(e) {
  e.preventDefault();
  const body = JSON.stringify(formToObject(e.target));
  if (CampaignState.editingId == null) {
    const created = await api("/api/admin/campaigns", { method: "POST", body });
    CampaignState.editingId = created.id;
    $("#campaign-status").textContent = `Created #${created.id}`;
  } else {
    await api(`/api/admin/campaigns/${CampaignState.editingId}`, { method: "PUT", body });
    $("#campaign-status").textContent = "Saved";
  }
  loadCampaigns();
}

async function sendTest() {
  if (CampaignState.editingId == null) return;
  const res = await api(
    `/api/admin/campaigns/${CampaignState.editingId}/test`,
    { method: "POST" },
  );
  $("#campaign-status").textContent = `Test sent to ${res.sent_to}`;
}

async function sendToAll() {
  if (CampaignState.editingId == null) return;
  if (!confirm("Send this campaign to ALL confirmed subscribers? This cannot be undone.")) return;
  await api(
    `/api/admin/campaigns/${CampaignState.editingId}/send`,
    { method: "POST" },
  );
  $("#campaign-status").textContent = "Send started.";
  loadCampaigns();
}

// ---------- Misc ----------

function formToObject(form) {
  const out = {};
  new FormData(form).forEach((v, k) => { out[k] = v; });
  return out;
}

function escape(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
