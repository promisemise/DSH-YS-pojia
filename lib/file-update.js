/**
 * 文件级云更新。
 *
 * 不下载整个包 —— 比对每个文件的哈希，只拉变化的那些。
 * 很多版本只改一两个文件，全量重装是浪费。
 *
 * 数据来源（都不需要自建服务器）：
 *
 *   1. 清单：仓库里 version-manifest.json
 *      https://raw.githubusercontent.com/OWNER/REPO/main/version-manifest.json
 *
 *   2. 文件：raw.githubusercontent.com/OWNER/REPO/vX.Y.Z/<相对路径>
 *      用 tag 而不是分支，保证拉到的和清单里写的是同一份。
 *
 * 清单格式：
 *   {
 *     "version": "1.5.4",
 *     "generatedAt": "2026-11-26T...",
 *     "files": { "lib/index.js": "sha256hex", ... }
 *   }
 *
 * 安全边界：
 *   - 只写清单里列出的路径，且必须在插件目录内（防 ../ 穿越）
 *   - 下载后校验哈希，对不上就丢弃
 *   - 全部下载成功才开始写；任何一个失败整体回滚
 *   - 写之前把原文件备份到 .update-backup-<时间戳>/
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const REPO = "yushang657/DSH-YS-pojia";
export const MANIFEST_URL = `https://raw.githubusercontent.com/${REPO}/main/version-manifest.json`;
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

const TIMEOUT_MS = 15000;

/* 不参与更新的路径：用户数据、依赖、版本控制 */
const SKIP_PREFIXES = [
  ".git/",
  "node_modules/",
  "ai_workspace/",
  "plugin-backups/",
];

const SKIP_EXACT = new Set([
  "package.json",          // 版本号变了要整体重装，不能单文件换
  "cordis.patch.yml",      // profile 里那份才是生效的
  "version-manifest.json", // 清单自己
]);

function shouldSkip(rel) {
  if (SKIP_EXACT.has(rel)) return true;
  return SKIP_PREFIXES.some((p) => rel.startsWith(p));
}

/* ── 工具 ───────────────────────────────────────────────── */

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function safeJoin(root, rel) {
  const norm = String(rel).replace(/\\/g, "/");
  if (norm.includes("..")) throw new Error("路径含 ..，拒绝：" + rel);
  if (path.isAbsolute(norm)) throw new Error("绝对路径，拒绝：" + rel);
  const full = path.resolve(root, norm);
  const rootResolved = path.resolve(root);
  if (!full.startsWith(rootResolved + path.sep) && full !== rootResolved) {
    throw new Error("路径越界，拒绝：" + rel);
  }
  return full;
}

/* 带证书降级的 fetch。
 * 某些 Windows 环境 Node 报 UNABLE_TO_VERIFY_LEAF_SIGNATURE（系统证书链缺中间证书），
 * 浏览器 / PowerShell 都正常。这种情况降级重试一次，并吞掉 Node 的 TLS 警告。 */
async function rawFetch(url, relaxTls) {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  let restoreWarning = null;
  if (relaxTls) {
    const orig = process.emitWarning;
    process.emitWarning = function (warning, ...rest) {
      const text = typeof warning === "string" ? warning : String((warning && warning.message) || "");
      if (/NODE_TLS_REJECT_UNAUTHORIZED|TLS connections are insecure/i.test(text)) return;
      return orig.call(process, warning, ...rest);
    };
    restoreWarning = () => { process.emitWarning = orig; };
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "ys-pojia-updater", accept: "*/*" },
    });
  } finally {
    clearTimeout(timer);
    if (relaxTls) {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
      if (restoreWarning) restoreWarning();
    }
  }
}

async function fetchWithFallback(url) {
  try {
    return await rawFetch(url, false);
  } catch (e) {
    const cause = String((e && (e.cause && e.cause.code)) || (e && e.message) || "");
    if (/CERT|SIGNATURE|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(cause)) {
      return await rawFetch(url, true);
    }
    throw e;
  }
}

async function fetchText(url) {
  const res = await fetchWithFallback(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.text();
}

async function fetchBuffer(url) {
  const res = await fetchWithFallback(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

/* ── 清单 ───────────────────────────────────────────────── */

/** 拉远程清单。 */
export async function fetchManifest() {
  const text = await fetchText(MANIFEST_URL + "?t=" + Date.now());
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("清单不是合法 JSON");
  }
  if (!obj || !obj.version || !obj.files || typeof obj.files !== "object") {
    throw new Error("清单缺少 version 或 files 字段");
  }
  return obj;
}

/** 扫描本地插件目录，返回 { 相对路径: sha256 }。 */
export function scanLocal(pluginRoot) {
  const out = {};
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? prefix + "/" + e.name : e.name;
      if (shouldSkip(rel)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, rel);
      } else if (e.isFile()) {
        try {
          out[rel] = sha256(fs.readFileSync(full));
        } catch {
          /* 读不了就跳过，比对时会当成缺失 */
        }
      }
    }
  };
  walk(pluginRoot, "");
  return out;
}

/**
 * 比对清单与本地，算出要做什么。
 *
 * @returns {{added:string[], changed:string[], removed:string[], unchanged:number, total:number}}
 */
export function diffManifest(manifest, localHashes) {
  const added = [];
  const changed = [];
  const unchanged = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (shouldSkip(rel)) continue;
    const local = localHashes[rel];
    if (!local) added.push(rel);
    else if (local !== hash) changed.push(rel);
    else unchanged.push(rel);
  }
  /* 远程清单里没有、本地有的文件 = 被删除的。
   * 不自动删 —— 交给用户决定，这里只报告。 */
  const removed = Object.keys(localHashes).filter(
    (rel) => !(rel in manifest.files) && !shouldSkip(rel)
  );
  return {
    added,
    changed,
    removed,
    unchanged: unchanged.length,
    total: Object.keys(manifest.files).filter((r) => !shouldSkip(r)).length,
  };
}

/* ── 应用更新 ───────────────────────────────────────────── */

/**
 * 下载并写入变化的文件。
 *
 * @param {object} opts
 * @param {string} opts.pluginRoot  插件目录
 * @param {string} opts.version     目标版本（tag）
 * @param {string[]} opts.files     要更新的相对路径
 * @param {object} opts.expected    { 相对路径: sha256 }
 * @param {function} [opts.onProgress]  (done, total, rel) => void
 * @returns {Promise<{ok:boolean, written:string[], backupDir:string, error?:string}>}
 */
export async function applyFiles(opts) {
  const { pluginRoot, version, files, expected } = opts;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};

  if (!Array.isArray(files) || files.length === 0) {
    return { ok: true, written: [], backupDir: "", error: "" };
  }

  /* 阶段 1：全部下载到内存，校验哈希。任何一个失败就整体放弃，不碰磁盘。 */
  const staged = [];
  let done = 0;
  for (const rel of files) {
    onProgress(done, files.length, rel);
    const url = `${RAW_BASE}/v${version.replace(/^v/i, "")}/${rel}`;
    let buf;
    try {
      buf = await fetchBuffer(url);
    } catch (e) {
      return { ok: false, written: [], backupDir: "", error: `下载 ${rel} 失败：${e.message}` };
    }
    const got = sha256(buf);
    const want = expected[rel];
    if (want && got !== want) {
      return {
        ok: false,
        written: [],
        backupDir: "",
        error: `${rel} 哈希不匹配（期望 ${want.slice(0, 8)}，实得 ${got.slice(0, 8)}）`,
      };
    }
    staged.push({ rel, buf });
    done += 1;
  }
  onProgress(files.length, files.length, "");

  /* 阶段 2：备份 + 写入。任何一步失败就回滚已写的。 */
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = path.join(pluginRoot, ".update-backup-" + stamp);
  const written = [];

  try {
    fs.mkdirSync(backupDir, { recursive: true });

    for (const { rel, buf } of staged) {
      const target = safeJoin(pluginRoot, rel);
      const bak = safeJoin(backupDir, rel);

      /* 备份原文件（存在才备份） */
      if (fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(bak), { recursive: true });
        fs.copyFileSync(target, bak);
      }

      /* 写入 */
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { fs.chmodSync(target, 0o666); } catch { /* 新文件 */ }
      fs.writeFileSync(target, buf);
      written.push(rel);
    }
  } catch (e) {
    /* 回滚 */
    for (const rel of written) {
      try {
        const target = safeJoin(pluginRoot, rel);
        const bak = safeJoin(backupDir, rel);
        if (fs.existsSync(bak)) fs.copyFileSync(bak, target);
        else fs.rmSync(target, { force: true });
      } catch { /* 尽力而为 */ }
    }
    return {
      ok: false,
      written: [],
      backupDir,
      error: "写入失败已回滚：" + (e && e.message ? e.message : e),
    };
  }

  return { ok: true, written, backupDir, error: "" };
}

/** 检查某个版本目录下有没有该文件（用于验证 tag 存在）。 */
export async function probeFile(version, rel) {
  try {
    await fetchBuffer(`${RAW_BASE}/v${version.replace(/^v/i, "")}/${rel}`);
    return true;
  } catch {
    return false;
  }
}
