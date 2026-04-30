const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.style.display = "block";
  setTimeout(() => {
    node.style.display = "none";
  }, 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function td(value) {
  const cell = document.createElement("td");
  if (value instanceof Node) cell.append(value);
  else cell.textContent = value ?? "";
  return cell;
}

function actionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function actions(...buttons) {
  const wrap = document.createElement("div");
  wrap.className = "actions";
  wrap.append(...buttons);
  return wrap;
}

function link(label, href) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  return anchor;
}

function fillTable(tableId, rows, columns) {
  const tbody = $(`#${tableId} tbody`);
  tbody.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) tr.append(td(column(row)));
    tbody.append(tr);
  }
}

async function startJob(path, body) {
  const job = await api(path, { method: "POST", body: JSON.stringify(body) });
  toast(`Job gestartet: ${job.id}`);
  showTab("jobs");
  await loadJobs();
}

async function startFormJob(path, formData) {
  const response = await fetch(path, { method: "POST", body: formData });
  const job = await response.json();
  if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);
  toast(`Job gestartet: ${job.id}`);
  showTab("jobs");
  await loadJobs();
}

function renderSearch(data) {
  $("#e621-summary").textContent = `${data.count} Posts fuer "${data.query}" gefunden.`;
  fillTable("pool-table", data.pools, [
    (row) => row.id,
    (row) => link(row.name, row.url),
    (row) => row.available ? row.postCount : row.error,
    (row) => row.hitCount,
    (row) => actions(
      actionButton("Import", () => startJob("/api/import/e621-pool", { poolId: row.id })),
      actionButton("Download", () => startJob("/api/download/e621-pool", { poolId: row.id })),
      actionButton("Sync", () => startJob("/api/pools/sync", { poolId: row.id }))
    )
  ]);
  fillTable("video-table", data.videos, [
    (row) => row.id,
    (row) => row.rating,
    (row) => row.score,
    (row) => row.favorites,
    (row) => actions(
      actionButton("Import", () => startJob("/api/import/e621-post", { postId: row.id })),
      actionButton("Download", () => startJob("/api/download/e621-post", { postId: row.id }))
    )
  ]);
  fillTable("post-table", data.all, [
    (row) => row.id,
    (row) => row.type,
    (row) => row.rating,
    (row) => row.score,
    (row) => row.favorites,
    (row) => actions(
      actionButton("Import", () => startJob("/api/import/e621-post", { postId: row.id })),
      actionButton("Familie", () => startJob("/api/import/e621-family", { postId: row.id })),
      link("e621", row.url)
    )
  ]);
}

function renderRule34Search(data) {
  $("#rule34-summary").textContent = `${data.count} Posts fuer "${data.query}" gefunden.`;
  fillTable("rule34-video-table", data.videos, [
    (row) => row.id,
    (row) => row.rating,
    (row) => row.score,
    (row) => row.ext,
    (row) => actions(
      actionButton("Import", () => startJob("/api/import/rule34-post", { postId: row.id })),
      actionButton("Download", () => startJob("/api/download/rule34-post", { postId: row.id }))
    )
  ]);
  fillTable("rule34-post-table", data.all, [
    (row) => row.id,
    (row) => row.type,
    (row) => row.rating,
    (row) => row.score,
    (row) => row.ext,
    (row) => actions(
      actionButton("Import", () => startJob("/api/import/rule34-post", { postId: row.id })),
      actionButton("Familie", () => startJob("/api/import/rule34-family", { postId: row.id })),
      actionButton("Download", () => startJob("/api/download/rule34-post", { postId: row.id })),
      link("rule34", row.url)
    )
  ]);
}

function showTab(id) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === id));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
}

async function loadConfig() {
  const config = await api("/api/config");
  const form = $("#config-form");
  form.szuruBaseUrl.value = config.szurubooru.baseUrl || "";
  form.szuruUser.value = config.szurubooru.userName || "";
  form.e621User.value = config.e621.userName || "";
  form.rule34UserId.value = config.rule34?.userId || "";
}

async function loadJobs() {
  const jobs = await api("/api/jobs");
  const list = $("#job-list");
  list.replaceChildren();
  for (const job of jobs) {
    const node = document.createElement("article");
    node.className = "job";
    const log = job.logs.map((entry) => `[${new Date(entry.at).toLocaleTimeString()}] ${entry.message}`).join("\n");
    const details = job.details && Object.keys(job.details).length ? JSON.stringify(job.details, null, 2) : "";
    const result = job.result === null || job.result === undefined ? "" : JSON.stringify(job.result, null, 2);
    const body = [details && `Details:\n${details}`, log && `Logs:\n${log}`, result && `Result:\n${result}`]
      .filter(Boolean)
      .join("\n\n") || (job.status === "running" ? "Job laeuft. Warte auf Logausgabe..." : "Keine Ausgabe.");
    node.innerHTML = `
      <header>
        <strong>${job.type}</strong>
        <span class="status-${job.status}">${job.status}</span>
      </header>
      <p>${job.id}</p>
      ${job.error ? `<p class="status-error">${job.error}</p>` : ""}
      <pre></pre>
    `;
    $("pre", node).textContent = body;
    list.append(node);
  }
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    showTab(tab.dataset.tab);
    if (tab.dataset.tab === "jobs") loadJobs().catch((error) => toast(error.message));
  });
});

$("#e621-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = event.currentTarget.query.value.trim();
  if (!query) return;
  $("#e621-summary").textContent = "Suche laeuft...";
  try {
    renderSearch(await api(`/api/search/e621?q=${encodeURIComponent(query)}`));
  } catch (error) {
    toast(error.message);
    $("#e621-summary").textContent = "";
  }
});

$("#rule34-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = event.currentTarget.query.value.trim();
  if (!query) return;
  $("#rule34-summary").textContent = "Suche laeuft...";
  try {
    renderRule34Search(await api(`/api/search/rule34?q=${encodeURIComponent(query)}`));
  } catch (error) {
    toast(error.message);
    $("#rule34-summary").textContent = "";
  }
});

$("#reddit-import").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await startJob("/api/import/reddit", { url: form.url.value.trim(), tags: form.tags.value });
});

$("#import-query").addEventListener("click", async () => {
  const query = $("#e621-search").query.value.trim();
  if (!query) return toast("Query fehlt.");
  await startJob("/api/import/e621-query", { query });
});

$("#import-rule34-query").addEventListener("click", async () => {
  const query = $("#rule34-search").query.value.trim();
  if (!query) return toast("Query fehlt.");
  await startJob("/api/import/rule34-query", { query });
});

$("#bulk-upload").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!$('input[name="files"]', form).files.length) return toast("Keine Dateien ausgewaehlt.");
  const data = new FormData(form);
  data.set("linkUploads", form.linkUploads.checked ? "true" : "false");
  await startFormJob("/api/upload/bulk", data);
});

$("#family-import").addEventListener("submit", async (event) => {
  event.preventDefault();
  const postId = event.currentTarget.postId.value.trim();
  if (!postId) return toast("Post-ID fehlt.");
  await startJob("/api/import/e621-family", { postId });
});

$("#post-download").addEventListener("submit", async (event) => {
  event.preventDefault();
  const postId = event.currentTarget.postId.value.trim();
  if (!postId) return toast("Post-ID fehlt.");
  await startJob("/api/download/e621-post", { postId });
});

$("#pool-sync-status").addEventListener("click", async () => {
  await startJob("/api/pools/sync-status", {});
});

$("#pool-sync").addEventListener("submit", async (event) => {
  event.preventDefault();
  const poolIds = event.currentTarget.poolIds.value.split(/[^0-9]+/).filter(Boolean).map(Number);
  if (!poolIds.length) return toast("Pool-ID fehlt.");
  await startJob("/api/pools/sync", { poolIds });
});

$("#duplicate-scan").addEventListener("submit", async (event) => {
  event.preventDefault();
  await startJob("/api/duplicates/scan", {});
});

$("#config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await api("/api/config", {
    method: "POST",
    body: JSON.stringify({
      szurubooru: {
        baseUrl: form.szuruBaseUrl.value.trim(),
        userName: form.szuruUser.value.trim(),
        token: form.szuruToken.value
      },
      e621: {
        userName: form.e621User.value.trim(),
        apiKey: form.e621ApiKey.value
      },
      rule34: {
        userId: form.rule34UserId.value.trim(),
        apiKey: form.rule34ApiKey.value
      }
    })
  });
  form.szuruToken.value = "";
  form.e621ApiKey.value = "";
  form.rule34ApiKey.value = "";
  toast("Konfiguration gespeichert.");
});

$("#refresh-jobs").addEventListener("click", () => loadJobs().catch((error) => toast(error.message)));

setInterval(() => {
  if ($("#jobs").classList.contains("active")) loadJobs().catch(() => {});
}, 5000);

loadConfig().catch((error) => toast(error.message));
