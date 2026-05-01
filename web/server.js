import http from "node:http";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(DATA_DIR, "downloads");
const PORT = Number(process.env.PORT || 8080);
const MAX_E621_PAGES = Number(process.env.MAX_E621_PAGES || 20);
const MAX_RULE34_PAGES = Number(process.env.MAX_RULE34_PAGES || 20);
const E621_PAGE_DELAY_MS = Number(process.env.E621_PAGE_DELAY_MS || 1800);
const E621_RETRY_COUNT = Number(process.env.E621_RETRY_COUNT || 5);
const E621_RETRY_BASE_MS = Number(process.env.E621_RETRY_BASE_MS || 5000);
const execFileAsync = promisify(execFile);

const jobs = new Map();

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function textResponse(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function readJson(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data.trim()) return {};
  return JSON.parse(data);
}

async function loadConfig() {
  await mkdir(DATA_DIR, { recursive: true });
  const configPath = path.join(DATA_DIR, "config.json");
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return {
    szurubooru: {
      baseUrl: process.env.SZURU_BASE_URL || fileConfig.szurubooru?.baseUrl || "",
      userName: process.env.SZURU_USER || fileConfig.szurubooru?.userName || "",
      token: process.env.SZURU_TOKEN || fileConfig.szurubooru?.token || ""
    },
    e621: {
      userName: process.env.E621_USER || fileConfig.e621?.userName || "",
      apiKey: process.env.E621_API_KEY || fileConfig.e621?.apiKey || ""
    },
    rule34: {
      userId: process.env.RULE34_USER_ID || fileConfig.rule34?.userId || "",
      apiKey: process.env.RULE34_API_KEY || fileConfig.rule34?.apiKey || ""
    }
  };
}

async function saveConfig(config) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, "config.json"), JSON.stringify(config, null, 2), "utf8");
}

function publicConfig(config) {
  return {
    szurubooru: {
      baseUrl: config.szurubooru.baseUrl,
      userName: config.szurubooru.userName,
      hasToken: Boolean(config.szurubooru.token)
    },
    e621: {
      userName: config.e621.userName,
      hasApiKey: Boolean(config.e621.apiKey)
    },
    rule34: {
      userId: config.rule34.userId,
      hasApiKey: Boolean(config.rule34.apiKey)
    }
  };
}

function e621Headers(config) {
  const user = config.e621.userName || "anonymous";
  const headers = {
    "user-agent": `SzurubooruToolsWeb/1.0 (by ${user})`
  };
  if (config.e621.userName && config.e621.apiKey) {
    headers.authorization = `Basic ${Buffer.from(`${config.e621.userName}:${config.e621.apiKey}`).toString("base64")}`;
  }
  return headers;
}

function rule34Headers() {
  return {
    "user-agent": "SzurubooruToolsWeb/1.0"
  };
}

function addRule34Auth(url, config) {
  if (config.rule34?.userId && config.rule34?.apiKey) {
    url.searchParams.set("user_id", config.rule34.userId);
    url.searchParams.set("api_key", config.rule34.apiKey);
  }
}

function szuruHeaders(config, extra = {}) {
  if (!config.szurubooru.baseUrl || !config.szurubooru.userName || !config.szurubooru.token) {
    throw new Error("Szurubooru-Konfiguration ist unvollstaendig.");
  }
  return {
    authorization: `Token ${Buffer.from(`${config.szurubooru.userName}:${config.szurubooru.token}`).toString("base64")}`,
    accept: "application/json",
    ...extra
  };
}

function apiBase(config) {
  return `${config.szurubooru.baseUrl.replace(/\/+$/, "")}/api`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} fuer ${url}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, options = {}, retryOptions = {}) {
  const retries = retryOptions.retries ?? 3;
  const baseDelayMs = retryOptions.baseDelayMs ?? 2000;
  const retryStatuses = new Set(retryOptions.statuses || [429, 500, 502, 503, 504]);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok) return response.json();

    const body = await response.text().catch(() => "");
    lastError = new Error(`HTTP ${response.status} fuer ${url}: ${body.slice(0, 300)}`);
    if (!retryStatuses.has(response.status) || attempt === retries) break;

    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * (attempt + 1);
    await sleep(delayMs);
  }

  throw lastError;
}

async function szuruJson(config, method, route, body) {
  const url = `${apiBase(config)}${route.startsWith("/") ? route : `/${route}`}`;
  return fetchJson(url, {
    method,
    headers: szuruHeaders(config, body ? { "content-type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
}

function safeTagName(name) {
  const tag = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_:.+-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 190);
  return /[a-z0-9]/.test(tag) ? tag : "";
}

function postSafety(rating) {
  if (rating === "s") return "safe";
  if (rating === "q") return "sketchy";
  return "unsafe";
}

function postKind(post) {
  const ext = String(post.file?.ext || "").toLowerCase();
  if (["webm", "mp4"].includes(ext)) return "Video";
  if (post.relationships?.parent_id || post.relationships?.children?.length) return "Parent/Child";
  if (post.pools?.length) return "Pool";
  return "Post";
}

function rowFromPost(post) {
  return {
    id: post.id,
    type: postKind(post),
    rating: post.rating,
    score: post.score?.total ?? 0,
    favorites: post.fav_count ?? 0,
    pools: post.pools || [],
    parentId: post.relationships?.parent_id || null,
    childCount: post.relationships?.children?.length || 0,
    ext: post.file?.ext || "",
    url: `https://e621.net/posts/${post.id}`,
    fileUrl: post.file?.url || ""
  };
}

async function searchE621(query, config, log = null) {
  const posts = [];
  let page = 1;
  while (page <= MAX_E621_PAGES) {
    const url = new URL("https://e621.net/posts.json");
    url.searchParams.set("tags", query);
    url.searchParams.set("limit", "320");
    url.searchParams.set("page", String(page));
    log?.(`Lade e621-Suchseite ${page}...`);
    const response = await fetchJsonWithRetry(url, { headers: e621Headers(config) }, {
      retries: E621_RETRY_COUNT,
      baseDelayMs: E621_RETRY_BASE_MS,
      statuses: [429, 503]
    });
    const batch = response.posts || [];
    posts.push(...batch);
    if (batch.length < 320) break;
    page += 1;
    await sleep(E621_PAGE_DELAY_MS);
  }

  const rows = posts.map(rowFromPost);
  const poolIds = [...new Set(rows.flatMap((row) => row.pools))].sort((a, b) => a - b);
  const pools = await Promise.all(poolIds.map(async (poolId) => {
    try {
      const pool = await getE621Pool(poolId, config);
      return {
        id: poolId,
        name: pool.name || `pool_${poolId}`,
        postCount: pool.post_ids?.length || 0,
        hitCount: rows.filter((row) => row.pools.includes(poolId)).length,
        url: `https://e621.net/pools/${poolId}`,
        available: true
      };
    } catch (error) {
      return {
        id: poolId,
        name: `pool_${poolId}`,
        postCount: 0,
        hitCount: rows.filter((row) => row.pools.includes(poolId)).length,
        url: `https://e621.net/pools/${poolId}`,
        available: false,
        error: error.message
      };
    }
  }));

  return {
    query,
    count: rows.length,
    all: rows,
    pools,
    videos: rows.filter((row) => row.type === "Video"),
    relations: rows.filter((row) => row.parentId || row.childCount)
  };
}

async function getE621Post(id, config) {
  const response = await fetchJson(`https://e621.net/posts/${Number(id)}.json`, { headers: e621Headers(config) });
  return response.post;
}

async function getE621Pool(id, config) {
  return fetchJson(`https://e621.net/pools/${Number(id)}.json`, { headers: e621Headers(config) });
}

function rule34PostUrl(id) {
  return `https://rule34.xxx/index.php?page=post&s=view&id=${Number(id)}`;
}

function rule34FileExt(post) {
  const candidate = post.file_url || post.image || "";
  try {
    const ext = path.extname(new URL(candidate).pathname).replace(".", "").toLowerCase();
    return ext || "bin";
  } catch {
    return "bin";
  }
}

function rule34PostKind(post) {
  const ext = rule34FileExt(post);
  if (["webm", "mp4", "mov"].includes(ext)) return "Video";
  if (post.parent_id && String(post.parent_id) !== "0") return "Parent/Child";
  return "Post";
}

function rule34RowFromPost(post) {
  return {
    id: Number(post.id),
    type: rule34PostKind(post),
    rating: post.rating || "",
    score: Number(post.score || 0),
    favorites: 0,
    pools: [],
    parentId: Number(post.parent_id || 0) || null,
    childCount: 0,
    ext: rule34FileExt(post),
    url: rule34PostUrl(post.id),
    fileUrl: post.file_url || post.image || ""
  };
}

async function searchRule34(query, config) {
  const posts = [];
  let page = 0;
  while (page < MAX_RULE34_PAGES) {
    const url = new URL("https://api.rule34.xxx/index.php");
    url.searchParams.set("page", "dapi");
    url.searchParams.set("s", "post");
    url.searchParams.set("q", "index");
    url.searchParams.set("json", "1");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("pid", String(page));
    url.searchParams.set("tags", query);
    addRule34Auth(url, config);
    const response = await fetchJson(url, { headers: rule34Headers() });
    const batch = Array.isArray(response) ? response : response.post ? [response.post].flat() : [];
    posts.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  const rows = posts.map(rule34RowFromPost);
  return {
    query,
    count: rows.length,
    all: rows,
    pools: [],
    videos: rows.filter((row) => row.type === "Video"),
    relations: rows.filter((row) => row.parentId || row.childCount)
  };
}

async function getRule34Post(id, config) {
  const url = new URL("https://api.rule34.xxx/index.php");
  url.searchParams.set("page", "dapi");
  url.searchParams.set("s", "post");
  url.searchParams.set("q", "index");
  url.searchParams.set("json", "1");
  url.searchParams.set("id", String(Number(id)));
  addRule34Auth(url, config);
  const response = await fetchJson(url, { headers: rule34Headers() });
  const posts = Array.isArray(response) ? response : response.post ? [response.post].flat() : [];
  if (!posts.length) throw new Error(`rule34.xxx Post ${id} wurde nicht gefunden.`);
  return posts[0];
}

async function getTagCategories(config) {
  const categories = await szuruJson(config, "GET", "/tag-categories");
  const names = (categories.results || []).map((category) => category.name);
  const pick = (...wanted) => wanted.find((name) => names.includes(name)) || names[0] || "default";
  return {
    artist: pick("artist", "artists"),
    contributor: pick("meta", "default"),
    copyright: pick("copyright", "series"),
    character: pick("character", "characters"),
    species: pick("species", "default"),
    general: pick("default", "general"),
    meta: pick("meta", "default"),
    lore: pick("default", "meta"),
    invalid: pick("default", "meta"),
    series: pick("series", "copyright", "default")
  };
}

async function ensureTag(config, name, category) {
  const tag = safeTagName(name);
  if (!tag) return "";
  try {
    await szuruJson(config, "GET", `/tag/${encodeURIComponent(tag)}`);
  } catch {
    await szuruJson(config, "POST", "/tags", { names: [tag], category, suggestions: [], implications: [] });
  }
  return tag;
}

async function findPostBySource(config, source) {
  const normalized = String(source || "").trim().replace(/^https?:\/\//, "");
  const query = encodeURIComponent(`source:${normalized}`);
  const result = await szuruJson(config, "GET", `/posts/?limit=1&query=${query}`);
  return result.results?.[0] || null;
}

async function findPostByChecksum(config, checksum) {
  const result = await szuruJson(config, "GET", `/posts/?limit=1&query=${encodeURIComponent(`content-checksum:${checksum}`)}`);
  return result.results?.[0] || null;
}

async function getPoolCategory(config) {
  const categories = await szuruJson(config, "GET", "/pool-categories");
  return categories.results?.[0]?.name || "default";
}

async function findPoolByName(config, name) {
  let offset = 0;
  const limit = 100;
  while (offset < 10000) {
    const result = await szuruJson(config, "GET", `/pools?limit=${limit}&offset=${offset}`);
    for (const pool of result.results || []) {
      if ((pool.names || []).includes(name)) return pool;
    }
    if ((result.results || []).length < limit) break;
    offset += limit;
  }
  return null;
}

async function ensurePool(config, name, description, postIds) {
  const category = await getPoolCategory(config);
  const existing = await findPoolByName(config, name);
  if (existing) {
    const full = await szuruJson(config, "GET", `/pool/${existing.id}`);
    const mergedPostIds = [...new Set([...(full.posts || []).map((post) => post.id), ...postIds])];
    return szuruJson(config, "PUT", `/pool/${existing.id}`, {
      version: full.version,
      names: full.names?.length ? full.names : [name],
      category: full.category || category,
      description: description || full.description || "",
      posts: mergedPostIds
    });
  }
  return szuruJson(config, "POST", "/pool", {
    names: [name],
    category,
    description: description || "",
    posts: postIds
  });
}

async function downloadBuffer(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Download fehlgeschlagen: HTTP ${response.status} ${url}`);
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

function safeFileName(name) {
  return String(name || "file")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

async function saveUrlToFile(url, headers, targetPath) {
  const { buffer, contentType } = await downloadBuffer(url, headers);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);
  return { path: targetPath, size: buffer.length, contentType };
}

async function postSzuruContent(config, metadata, buffer, filename, contentType) {
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append("content", new Blob([buffer], { type: contentType }), filename);
  const response = await fetch(`${apiBase(config)}/posts/`, {
    method: "POST",
    headers: szuruHeaders(config),
    body: form
  });
  if (!response.ok) throw new Error(`Szurubooru-Upload fehlgeschlagen: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

function isSzuruImageMetadataError(error) {
  const message = String(error?.message || "");
  return message.includes("InvalidPostContentError") && message.includes("Unable to process image metadata");
}

function uploadExtension(filename, contentType) {
  const fromName = path.extname(filename || "").replace(".", "").toLowerCase();
  if (fromName) return fromName;
  const fromType = String(contentType || "").split("/").at(1)?.split(";").at(0)?.toLowerCase();
  return fromType || "bin";
}

function canRepairImageUpload(filename, contentType) {
  const ext = uploadExtension(filename, contentType);
  return String(contentType || "").startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
}

async function repairImageForSzuru(buffer, filename, contentType) {
  if (!canRepairImageUpload(filename, contentType)) return null;

  const inputExt = uploadExtension(filename, contentType);
  const outputExt = inputExt === "gif" ? "gif" : inputExt === "jpg" || inputExt === "jpeg" ? "jpg" : inputExt === "png" ? "png" : "png";
  const outputType = outputExt === "jpg" ? "image/jpeg" : outputExt === "gif" ? "image/gif" : "image/png";
  const workDir = await mkdtemp(path.join(tmpdir(), "szuru-upload-"));
  const inputPath = path.join(workDir, `input.${inputExt || "bin"}`);
  const outputPath = path.join(workDir, `output.${outputExt}`);

  try {
    await writeFile(inputPath, buffer);
    const args = outputExt === "gif"
      ? [inputPath, "-coalesce", "-strip", outputPath]
      : [inputPath, "-auto-orient", "-strip", outputPath];
    await execFileAsync("magick", args, { timeout: 120000, maxBuffer: 1024 * 1024 });
    return {
      buffer: await readFile(outputPath),
      filename: `${safeFileName(path.basename(filename || "upload", path.extname(filename || "")))}.repaired.${outputExt}`,
      contentType: outputType
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function uploadToSzuru(config, metadata, buffer, filename, contentType) {
  try {
    return await postSzuruContent(config, metadata, buffer, filename, contentType);
  } catch (error) {
    if (!isSzuruImageMetadataError(error)) throw error;

    try {
      const repaired = await repairImageForSzuru(buffer, filename, contentType);
      if (!repaired) throw error;
      return await postSzuruContent(config, metadata, repaired.buffer, repaired.filename, repaired.contentType);
    } catch (repairError) {
      if (repairError === error) throw error;
      throw new Error(`${error.message} | Reparaturversuch fehlgeschlagen: ${repairError.message}`);
    }
  }
}

async function importLocalBufferToSzuru(config, buffer, filename, contentType, tags, safety, source, relationIds = []) {
  const categories = await getTagCategories(config);
  const ensuredTags = [];
  for (const tag of tags) {
    const ensured = await ensureTag(config, tag, categories.general);
    if (ensured) ensuredTags.push(ensured);
  }
  const checksum = createHash("sha1").update(buffer).digest("hex");
  const checksumMatch = await findPostByChecksum(config, checksum);
  if (checksumMatch) {
    await updatePost(config, checksumMatch, {
      tags: [...new Set([...(checksumMatch.tags || []).map((tag) => tag.names?.[0] || tag), ...ensuredTags])],
      source: source || checksumMatch.source || "",
      relations: relationIds
    });
    return { id: checksumMatch.id, action: "updated" };
  }
  const created = await uploadToSzuru(config, {
    tags: [...new Set(ensuredTags)],
    safety: safety || "unsafe",
    source: source || "",
    relations: relationIds,
    notes: [],
    flags: []
  }, buffer, filename, contentType || "application/octet-stream");
  return { id: created.id, action: "created" };
}

async function updatePost(config, post, patch) {
  return szuruJson(config, "PUT", `/post/${post.id}`, { version: post.version, ...patch });
}

async function setPostRelations(config, postId, relationIds) {
  const post = await szuruJson(config, "GET", `/post/${postId}`);
  const existing = (post.relations || []).map((relation) => relation.id);
  const relations = [...new Set([...existing, ...relationIds])].filter((id) => id !== postId);
  return updatePost(config, post, { relations });
}

async function importE621Post(config, postId, extraTags = []) {
  const post = await getE621Post(postId, config);
  const source = `https://e621.net/posts/${post.id}`;
  const tagCategories = await getTagCategories(config);
  const tags = [];
  for (const category of ["artist", "contributor", "copyright", "character", "species", "general", "meta", "lore", "invalid"]) {
    for (const tag of post.tags?.[category] || []) {
      const ensured = await ensureTag(config, tag, tagCategories[category]);
      if (ensured) tags.push(ensured);
    }
  }
  for (const tag of extraTags) {
    const ensured = await ensureTag(config, tag, tagCategories.series);
    if (ensured) tags.push(ensured);
  }
  const uniqueTags = [...new Set(tags)];

  const sourceMatch = await findPostBySource(config, source);
  if (sourceMatch) {
    await updatePost(config, sourceMatch, { tags: uniqueTags, source });
    return { id: sourceMatch.id, action: "updated", source };
  }

  if (!post.file?.url) return { id: 0, action: "skipped", source, reason: "Keine Datei-URL vorhanden" };
  const { buffer, contentType } = await downloadBuffer(post.file.url, e621Headers(config));
  const checksum = createHash("sha1").update(buffer).digest("hex");
  const checksumMatch = await findPostByChecksum(config, checksum);
  if (checksumMatch) {
    await updatePost(config, checksumMatch, { tags: uniqueTags, source });
    return { id: checksumMatch.id, action: "updated", source };
  }

  const metadata = {
    tags: uniqueTags,
    safety: postSafety(post.rating),
    source,
    relations: [],
    notes: [],
    flags: []
  };
  const created = await uploadToSzuru(config, metadata, buffer, `e621-${post.id}.${post.file.ext || "bin"}`, contentType);
  return { id: created.id, action: "created", source };
}

async function importRule34Post(config, postId, extraTags = []) {
  const post = await getRule34Post(postId, config);
  const source = rule34PostUrl(post.id);
  const categories = await getTagCategories(config);
  const tags = [];
  for (const tag of String(post.tags || "").split(/\s+/).filter(Boolean)) {
    const ensured = await ensureTag(config, tag, categories.general);
    if (ensured) tags.push(ensured);
  }
  for (const tag of extraTags) {
    const ensured = await ensureTag(config, tag, categories.general);
    if (ensured) tags.push(ensured);
  }
  const uniqueTags = [...new Set(tags)];

  const sourceMatch = await findPostBySource(config, source);
  if (sourceMatch) {
    await updatePost(config, sourceMatch, { tags: uniqueTags, source });
    return { id: sourceMatch.id, action: "updated", source };
  }

  const fileUrl = post.file_url || post.image || "";
  if (!fileUrl) return { id: 0, action: "skipped", source, reason: "Keine Datei-URL vorhanden" };
  const { buffer, contentType } = await downloadBuffer(fileUrl, rule34Headers());
  const checksum = createHash("sha1").update(buffer).digest("hex");
  const checksumMatch = await findPostByChecksum(config, checksum);
  if (checksumMatch) {
    await updatePost(config, checksumMatch, { tags: uniqueTags, source });
    return { id: checksumMatch.id, action: "updated", source };
  }

  const metadata = {
    tags: uniqueTags,
    safety: "unsafe",
    source,
    relations: [],
    notes: [],
    flags: []
  };
  const created = await uploadToSzuru(config, metadata, buffer, `rule34-${post.id}.${rule34FileExt(post)}`, contentType);
  return { id: created.id, action: "created", source };
}

async function getE621FamilyPostIds(config, postId) {
  const post = await getE621Post(postId, config);
  const ids = new Set([Number(post.id)]);
  if (post.relationships?.parent_id) ids.add(Number(post.relationships.parent_id));
  for (const childId of post.relationships?.children || []) ids.add(Number(childId));
  return [...ids].filter((id) => id > 0).sort((a, b) => a - b);
}

async function getRule34FamilyPostIds(config, postId) {
  const post = await getRule34Post(postId, config);
  const ids = new Set([Number(post.id)]);
  if (post.parent_id && String(post.parent_id) !== "0") ids.add(Number(post.parent_id));
  const children = await searchRule34(`parent:${Number(post.id)}`, config);
  for (const child of children.all) ids.add(Number(child.id));
  return [...ids].filter((id) => id > 0).sort((a, b) => a - b);
}

async function importE621PostSet(config, postIds, contextName, log) {
  const imported = [];
  const failed = [];
  for (let index = 0; index < postIds.length; index += 1) {
    const postId = Number(postIds[index]);
    log(`${contextName}: importiere Post ${index + 1}/${postIds.length}: ${postId}`);
    try {
      imported.push(await importE621Post(config, postId));
    } catch (error) {
      failed.push({ id: postId, error: error.message });
      log(`Fehler bei Post ${postId}: ${error.message}`);
    }
  }
  const ids = imported.map((item) => item.id).filter((id) => id > 0);
  if (ids.length > 1) {
    for (const id of ids) await setPostRelations(config, id, ids.filter((otherId) => otherId !== id));
  }
  return { contextName, imported, failed };
}

async function importRule34PostSet(config, postIds, contextName, log) {
  const imported = [];
  const failed = [];
  for (let index = 0; index < postIds.length; index += 1) {
    const postId = Number(postIds[index]);
    log(`${contextName}: importiere Post ${index + 1}/${postIds.length}: ${postId}`);
    try {
      imported.push(await importRule34Post(config, postId));
    } catch (error) {
      failed.push({ id: postId, error: error.message });
      log(`Fehler bei Post ${postId}: ${error.message}`);
    }
  }
  const ids = imported.map((item) => item.id).filter((id) => id > 0);
  if (ids.length > 1) {
    for (const id of ids) await setPostRelations(config, id, ids.filter((otherId) => otherId !== id));
  }
  return { contextName, imported, failed };
}

async function importE621Pool(config, poolId, log) {
  const pool = await getE621Pool(poolId, config);
  const poolName = pool.name || `pool_${poolId}`;
  const seriesTag = safeTagName(`comic_${poolId}_${poolName}`);
  const postIds = pool.post_ids || [];
  const imported = [];
  const failed = [];
  log(`Pool ${poolId}: ${postIds.length} Posts gefunden.`);
  for (let index = 0; index < postIds.length; index += 1) {
    const id = postIds[index];
    log(`Importiere Post ${index + 1}/${postIds.length}: ${id}`);
    try {
      imported.push(await importE621Post(config, id, [seriesTag]));
    } catch (error) {
      failed.push({ id, error: error.message });
      log(`Fehler bei Post ${id}: ${error.message}`);
    }
  }
  const szuruPostIds = imported.map((item) => item.id).filter((id) => id > 0);
  const description = `Importiert von https://e621.net/pools/${poolId}`;
  const szuruPool = await ensurePool(config, seriesTag, description, szuruPostIds);
  return { poolId, poolName, seriesTag, szurubooruPoolId: szuruPool.id, imported, failed };
}

async function downloadE621Pool(config, poolId, log) {
  const pool = await getE621Pool(poolId, config);
  const poolName = safeFileName(`${poolId}_${pool.name || `pool_${poolId}`}`);
  const targetDir = path.join(DOWNLOAD_DIR, poolName);
  const results = [];
  const postIds = pool.post_ids || [];
  for (let index = 0; index < postIds.length; index += 1) {
    const post = await getE621Post(postIds[index], config);
    if (!post.file?.url) {
      results.push({ id: post.id, action: "skipped", reason: "Keine Datei-URL" });
      continue;
    }
    const fileName = safeFileName(`${String(index + 1).padStart(4, "0")}_${post.id}.${post.file.ext || "bin"}`);
    log(`Lade Pool-Datei ${index + 1}/${postIds.length}: ${fileName}`);
    results.push({ id: post.id, ...(await saveUrlToFile(post.file.url, e621Headers(config), path.join(targetDir, fileName))) });
  }
  return { poolId, poolName: pool.name, targetDir, files: results };
}

async function downloadE621Post(config, postId, log) {
  const post = await getE621Post(postId, config);
  if (!post.file?.url) throw new Error("Keine Datei-URL vorhanden.");
  const fileName = safeFileName(`e621_${post.id}.${post.file.ext || "bin"}`);
  const targetPath = path.join(DOWNLOAD_DIR, "posts", fileName);
  log(`Lade ${fileName}`);
  return { id: post.id, ...(await saveUrlToFile(post.file.url, e621Headers(config), targetPath)) };
}

async function downloadRule34Post(config, postId, log) {
  const post = await getRule34Post(postId, config);
  const fileUrl = post.file_url || post.image || "";
  if (!fileUrl) throw new Error("Keine Datei-URL vorhanden.");
  const fileName = safeFileName(`rule34_${post.id}.${rule34FileExt(post)}`);
  const targetPath = path.join(DOWNLOAD_DIR, "rule34", fileName);
  log(`Lade ${fileName}`);
  return { id: Number(post.id), ...(await saveUrlToFile(fileUrl, rule34Headers(), targetPath)) };
}

async function importE621Query(config, query, log) {
  if (!query) throw new Error("Query fehlt.");
  const result = await searchE621(query, config, log);
  const poolIds = result.pools.filter((pool) => pool.available).map((pool) => pool.id);
  const standalonePostIds = result.all.filter((row) => !row.pools.length).map((row) => row.id);
  const pools = [];
  const posts = [];
  const failed = [];
  log(`${result.count} Treffer, ${poolIds.length} Pools, ${standalonePostIds.length} Einzelposts.`);
  for (const poolId of poolIds) {
    try {
      pools.push(await importE621Pool(config, poolId, log));
    } catch (error) {
      failed.push({ type: "pool", id: poolId, error: error.message });
    }
  }
  for (const postId of standalonePostIds) {
    try {
      posts.push(await importE621Post(config, postId));
    } catch (error) {
      failed.push({ type: "post", id: postId, error: error.message });
    }
  }
  return { query, pools, posts, failed };
}

async function importRule34Query(config, query, log) {
  if (!query) throw new Error("Query fehlt.");
  const result = await searchRule34(query, config);
  const posts = [];
  const failed = [];
  log(`${result.count} rule34.xxx Treffer.`);
  for (let index = 0; index < result.all.length; index += 1) {
    const postId = result.all[index].id;
    log(`Importiere rule34.xxx Post ${index + 1}/${result.all.length}: ${postId}`);
    try {
      posts.push(await importRule34Post(config, postId));
    } catch (error) {
      failed.push({ type: "post", id: postId, error: error.message });
      log(`Fehler bei Post ${postId}: ${error.message}`);
    }
  }
  return { query, posts, failed };
}

function postSummary(post) {
  return {
    id: post.id,
    checksum: post.checksum || "",
    checksumMD5: post.checksumMD5 || "",
    type: post.type || "",
    mimeType: post.mimeType || "",
    fileSize: post.fileSize || 0,
    width: post.canvasWidth || 0,
    height: post.canvasHeight || 0,
    source: post.source || "",
    contentUrl: post.contentUrl || ""
  };
}

async function listAllSzuruPosts(config, log) {
  const posts = [];
  const limit = 100;
  let offset = 0;
  let total = 0;
  do {
    const page = await szuruJson(config, "GET", `/posts/?limit=${limit}&offset=${offset}`);
    total = page.total || 0;
    posts.push(...(page.results || []).map(postSummary));
    offset += (page.results || []).length;
    log?.(`Lade Szurubooru-Posts: ${posts.length}/${total}`);
  } while (offset < total);
  return posts;
}

function duplicateGroups(posts) {
  const groups = [];
  for (const [field, matchType] of [["checksum", "checksum"], ["checksumMD5", "checksumMD5"]]) {
    const map = new Map();
    for (const post of posts) {
      if (!post[field]) continue;
      if (!map.has(post[field])) map.set(post[field], []);
      map.get(post[field]).push(post);
    }
    for (const [key, items] of map) {
      if (items.length > 1) groups.push({ matchType, key, count: items.length, posts: items.sort((a, b) => a.id - b.id) });
    }
  }
  return groups.sort((a, b) => b.count - a.count);
}

function e621PoolIdFromName(name) {
  const match = String(name || "").match(/^comic_(\d+)_/);
  return match ? Number(match[1]) : 0;
}

async function listSzuruPools(config) {
  const pools = [];
  const limit = 100;
  let offset = 0;
  let total = 0;
  do {
    const page = await szuruJson(config, "GET", `/pools?limit=${limit}&offset=${offset}`);
    total = page.total || 0;
    pools.push(...(page.results || []));
    offset += (page.results || []).length;
  } while (offset < total);
  return pools;
}

async function poolSyncStatus(config, log) {
  const pools = (await listSzuruPools(config)).filter((pool) => e621PoolIdFromName(pool.names?.[0]));
  const entries = [];
  for (const pool of pools) {
    const full = await szuruJson(config, "GET", `/pool/${pool.id}`);
    const e621PoolId = e621PoolIdFromName(full.names?.[0]);
    log?.(`Pruefe Pool ${full.names?.[0]}`);
    const e621Pool = await getE621Pool(e621PoolId, config);
    const currentSourceIds = [];
    for (const poolPost of full.posts || []) {
      const post = await szuruJson(config, "GET", `/post/${poolPost.id}`);
      const match = String(post.source || "").match(/\/posts\/(\d+)/);
      if (match) currentSourceIds.push(Number(match[1]));
    }
    const expected = e621Pool.post_ids || [];
    const currentSet = new Set(currentSourceIds);
    const expectedSet = new Set(expected);
    const missing = expected.filter((id) => !currentSet.has(id));
    const extra = currentSourceIds.filter((id) => !expectedSet.has(id));
    const orderOk = missing.length === 0 && extra.length === 0 && expected.every((id, index) => currentSourceIds[index] === id);
    entries.push({
      poolId: e621PoolId,
      poolName: full.names?.[0],
      szurubooruPoolId: full.id,
      e621PostCount: expected.length,
      szurubooruPostCount: currentSourceIds.length,
      missing,
      extra,
      orderOk
    });
  }
  return entries;
}

async function syncE621Pool(config, poolId, log) {
  const imported = await importE621Pool(config, poolId, log);
  const pool = await getE621Pool(poolId, config);
  const seriesTag = safeTagName(`comic_${poolId}_${pool.name || `pool_${poolId}`}`);
  const szuruPool = await findPoolByName(config, seriesTag);
  if (!szuruPool) return imported;
  const full = await szuruJson(config, "GET", `/pool/${szuruPool.id}`);
  const orderedIds = [];
  for (const e621PostId of pool.post_ids || []) {
    const match = await findPostBySource(config, `https://e621.net/posts/${e621PostId}`);
    if (match) orderedIds.push(match.id);
  }
  await szuruJson(config, "PUT", `/pool/${full.id}`, {
    version: full.version,
    names: full.names,
    category: full.category,
    description: full.description || `Importiert von https://e621.net/pools/${poolId}`,
    posts: orderedIds
  });
  return { ...imported, reordered: orderedIds.length };
}

async function readMultipart(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const boundary = req.headers["content-type"]?.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error("Multipart boundary fehlt.");
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = body.indexOf(delimiter) + delimiter.length + 2;
  while (start > delimiter.length) {
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const part = body.subarray(start, next - 2);
    const sep = part.indexOf(Buffer.from("\r\n\r\n"));
    if (sep > 0) {
      const headers = part.subarray(0, sep).toString("utf8");
      const data = part.subarray(sep + 4);
      const name = headers.match(/name="([^"]+)"/)?.[1];
      const filename = headers.match(/filename="([^"]*)"/)?.[1];
      const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
      if (name) parts.push({ name, filename, contentType, data });
    }
    start = next + delimiter.length + 2;
  }
  return parts;
}

function redditJsonUrl(input) {
  const url = new URL(input);
  url.hostname = "www.reddit.com";
  if (!url.pathname.endsWith(".json")) url.pathname = `${url.pathname.replace(/\/$/, "")}.json`;
  url.searchParams.set("raw_json", "1");
  return url.toString();
}

function redditHeaders() {
  return { "user-agent": "SzurubooruToolsWeb/1.0" };
}

function absoluteRedditUrl(value) {
  if (!value) return "";
  const decoded = String(value).replaceAll("&amp;", "&");
  if (decoded.startsWith("//")) return `https:${decoded}`;
  return decoded;
}

function redditTags(post) {
  const tags = new Set(["reddit", "reddit_import", `reddit_post_${post.id}`, `subreddit_${safeTagName(post.subreddit)}`, `redditor_${safeTagName(post.author)}`]);
  if (post.over_18) tags.add("nsfw");
  if (post.spoiler) tags.add("spoiler");
  if (post.link_flair_text) tags.add(`reddit_flair_${safeTagName(post.link_flair_text)}`);
  return [...tags].filter(Boolean);
}

function redditMedia(post) {
  const items = [];
  if (post.is_gallery && post.media_metadata) {
    for (const [id, meta] of Object.entries(post.media_metadata)) {
      const media = meta.s?.mp4 || meta.s?.u || meta.p?.at(-1)?.u;
      if (media) items.push({ url: absoluteRedditUrl(media), filename: `${post.id}-${id}` });
    }
  }
  const fallback = post.secure_media?.reddit_video?.fallback_url || post.media?.reddit_video?.fallback_url;
  if (fallback) items.push({ url: absoluteRedditUrl(fallback), filename: `${post.id}.mp4` });
  const direct = post.url_overridden_by_dest || post.url;
  if (direct && /\.(jpe?g|png|gif|webp|mp4|webm)(\?|$)/i.test(direct)) {
    items.push({ url: absoluteRedditUrl(direct), filename: path.basename(new URL(absoluteRedditUrl(direct)).pathname) || `${post.id}.bin` });
  }
  return items;
}

async function importRedditPost(config, redditUrl, additionalTags, log) {
  const listing = await fetchJson(redditJsonUrl(redditUrl), { headers: redditHeaders() });
  const post = listing?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error("Reddit-Post konnte nicht gelesen werden.");
  const canonicalUrl = `https://www.reddit.com${post.permalink}`;
  const media = redditMedia(post);
  if (!media.length) throw new Error("Kein direkt importierbares Reddit-Medium gefunden.");
  const categories = await getTagCategories(config);
  const tags = [];
  for (const tag of [...redditTags(post), ...additionalTags]) {
    const ensured = await ensureTag(config, tag, categories.general);
    if (ensured) tags.push(ensured);
  }

  const imported = [];
  for (let index = 0; index < media.length; index += 1) {
    const item = media[index];
    const source = media.length > 1 ? `${canonicalUrl}#media-${index + 1}` : canonicalUrl;
    log(`Importiere Reddit-Medium ${index + 1}/${media.length}`);
    const sourceMatch = await findPostBySource(config, source);
    if (sourceMatch) {
      await updatePost(config, sourceMatch, { tags: [...new Set(tags)], source });
      imported.push({ id: sourceMatch.id, action: "updated", source });
      continue;
    }
    const { buffer, contentType } = await downloadBuffer(item.url, redditHeaders());
    const metadata = {
      tags: [...new Set(tags)],
      safety: post.over_18 ? "unsafe" : "safe",
      source,
      relations: [],
      notes: [],
      flags: []
    };
    const created = await uploadToSzuru(config, metadata, buffer, item.filename, contentType);
    imported.push({ id: created.id, action: "created", source });
  }
  const ids = imported.map((item) => item.id).filter((id) => id > 0);
  if (ids.length > 1) {
    for (const id of ids) {
      await setPostRelations(config, id, ids.filter((otherId) => otherId !== id));
    }
  }
  return { postId: post.id, canonicalUrl, imported };
}

function startJob(type, details, worker) {
  const id = randomUUID();
  const job = { id, type, details: details || {}, status: "running", logs: [], createdAt: new Date().toISOString(), result: null, error: null };
  jobs.set(id, job);
  const log = (message) => {
    job.logs.push({ at: new Date().toISOString(), message });
    if (job.logs.length > 500) job.logs.shift();
  };
  log(`Job gestartet: ${type}`);
  Promise.resolve()
    .then(() => worker(log))
    .then((result) => {
      job.status = "done";
      job.result = result;
      log("Fertig.");
    })
    .catch((error) => {
      job.status = "error";
      job.error = error.message;
      log(`Fehler: ${error.message}`);
    });
  return job;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!target.startsWith(PUBLIC_DIR)) return textResponse(res, 403, "Forbidden");
  try {
    const content = await readFile(target);
    const ext = path.extname(target);
    const type = ext === ".css" ? "text/css; charset=utf-8" : ext === ".js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
    textResponse(res, 200, content, type);
  } catch {
    textResponse(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/config" && req.method === "GET") {
      return jsonResponse(res, 200, publicConfig(await loadConfig()));
    }
    if (url.pathname === "/api/config" && req.method === "POST") {
      const current = await loadConfig();
      const body = await readJson(req);
      const next = {
        szurubooru: {
          baseUrl: body.szurubooru?.baseUrl ?? current.szurubooru.baseUrl,
          userName: body.szurubooru?.userName ?? current.szurubooru.userName,
          token: body.szurubooru?.token || current.szurubooru.token
        },
        e621: {
          userName: body.e621?.userName ?? current.e621.userName,
          apiKey: body.e621?.apiKey || current.e621.apiKey
        },
        rule34: {
          userId: body.rule34?.userId ?? current.rule34.userId,
          apiKey: body.rule34?.apiKey || current.rule34.apiKey
        }
      };
      await saveConfig(next);
      return jsonResponse(res, 200, publicConfig(next));
    }
    if (url.pathname === "/api/search/e621" && req.method === "GET") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return jsonResponse(res, 400, { error: "Query fehlt." });
      return jsonResponse(res, 200, await searchE621(query, await loadConfig()));
    }
    if (url.pathname === "/api/search/rule34" && req.method === "GET") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return jsonResponse(res, 400, { error: "Query fehlt." });
      return jsonResponse(res, 200, await searchRule34(query, await loadConfig()));
    }
    if (url.pathname === "/api/jobs" && req.method === "GET") {
      return jsonResponse(res, 200, [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    if (url.pathname.startsWith("/api/jobs/") && req.method === "GET") {
      const job = jobs.get(url.pathname.split("/").at(-1));
      return job ? jsonResponse(res, 200, job) : jsonResponse(res, 404, { error: "Job nicht gefunden." });
    }
    if (url.pathname === "/api/import/e621-post" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("e621-post", { postId: Number(body.postId) }, (log) => {
        log(`Importiere e621-Post ${body.postId}`);
        return importE621Post(config, Number(body.postId), body.tags || []);
      });
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/import/e621-pool" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("e621-pool", { poolId: Number(body.poolId) }, (log) => importE621Pool(config, Number(body.poolId), log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/import/e621-family" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("e621-family", { postId: Number(body.postId) }, async (log) => {
        const ids = await getE621FamilyPostIds(config, Number(body.postId));
        return importE621PostSet(config, ids, `Familie zu ${body.postId}`, log);
      });
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/import/e621-query" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const query = String(body.query || "").trim();
      const job = startJob("e621-query", { query }, (log) => importE621Query(config, query, log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/import/rule34-post" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("rule34-post", { postId: Number(body.postId) }, (log) => {
        log(`Importiere rule34.xxx Post ${body.postId}`);
        return importRule34Post(config, Number(body.postId), body.tags || []);
      });
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/import/rule34-family" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("rule34-family", { postId: Number(body.postId) }, async (log) => {
        const ids = await getRule34FamilyPostIds(config, Number(body.postId));
        return importRule34PostSet(config, ids, `rule34.xxx Familie zu ${body.postId}`, log);
      });
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/import/rule34-query" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const query = String(body.query || "").trim();
      const job = startJob("rule34-query", { query }, (log) => importRule34Query(config, query, log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/download/e621-pool" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("download-pool", { poolId: Number(body.poolId) }, (log) => downloadE621Pool(config, Number(body.poolId), log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/download/e621-post" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("download-post", { postId: Number(body.postId) }, (log) => downloadE621Post(config, Number(body.postId), log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/download/rule34-post" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const job = startJob("download-rule34-post", { postId: Number(body.postId) }, (log) => downloadRule34Post(config, Number(body.postId), log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/import/reddit" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const tags = String(body.tags || "").split(/[,;\n]+/).map((tag) => tag.trim()).filter(Boolean);
      const job = startJob("reddit", { url: body.url, tags }, (log) => importRedditPost(config, body.url, tags, log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/duplicates/scan" && req.method === "POST") {
      const config = await loadConfig();
      const job = startJob("duplicate-scan", {}, async (log) => {
        const posts = await listAllSzuruPosts(config, log);
        const groups = duplicateGroups(posts);
        return { postCount: posts.length, duplicateGroupCount: groups.length, groups };
      });
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/pools/sync-status" && req.method === "POST") {
      const config = await loadConfig();
      const job = startJob("pool-sync-status", {}, (log) => poolSyncStatus(config, log));
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/pools/sync" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig();
      const ids = Array.isArray(body.poolIds) ? body.poolIds.map(Number).filter(Boolean) : [Number(body.poolId)].filter(Boolean);
      const job = startJob("pool-sync", { poolIds: ids }, async (log) => {
        const results = [];
        for (const poolId of ids) results.push(await syncE621Pool(config, poolId, log));
        return results;
      });
      return jsonResponse(res, 202, job);
    }
    if (url.pathname === "/api/upload/bulk" && req.method === "POST") {
      const parts = await readMultipart(req);
      const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.data.toString("utf8")]));
      const files = parts.filter((part) => part.name === "files" && part.filename && part.data.length);
      const config = await loadConfig();
      const tags = String(fields.tags || "").split(/[,;\n]+/).map((tag) => tag.trim()).filter(Boolean);
      const relationIds = String(fields.relations || "").split(/[^0-9]+/).filter(Boolean).map(Number);
      const job = startJob("bulk-upload", { fileCount: files.length, tags, poolName: fields.poolName || "" }, async (log) => {
        const imported = [];
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          log(`Lade Datei ${index + 1}/${files.length}: ${file.filename}`);
          imported.push(await importLocalBufferToSzuru(config, file.data, safeFileName(file.filename), file.contentType, tags, fields.safety || "unsafe", fields.source || "", relationIds));
        }
        const ids = imported.map((item) => item.id).filter((id) => id > 0);
        if (fields.linkUploads === "true" && ids.length > 1) {
          for (const id of ids) await setPostRelations(config, id, ids.filter((otherId) => otherId !== id));
        }
        if (fields.poolName && ids.length) {
          const pool = await ensurePool(config, safeTagName(fields.poolName), fields.poolDescription || "", ids);
          return { imported, poolId: pool.id };
        }
        return { imported };
      });
      return jsonResponse(res, 202, job);
    }
    return serveStatic(req, res);
  } catch (error) {
    return jsonResponse(res, 500, { error: error.message });
  }
});

await mkdir(DOWNLOAD_DIR, { recursive: true });
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Szurubooru Tools Web laeuft auf Port ${PORT}`);
});
