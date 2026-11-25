/**
 * 云端版本检测。
 *
 * 不需要自建服务器 —— 版本号从 GitHub Releases API 读。
 *
 *   GET https://api.github.com/repos/yushang657/DSH-YS-pojia/releases/latest
 *
 * 设计要点：
 *
 *   1. **默认不联网**。第一次调用必须由用户显式触发（点按钮 / 敲命令），
 *      之后才按 checkIntervalHours 自动查。用户没同意过就一次请求都不发。
 *
 *   2. **缓存 24 小时**。结果落盘到 $DSH_HOME/ys-pojia/update-check.json，
 *      24 小时内重复调用直接读缓存，不再打 API。GitHub 未认证 API 限 60 次/小时，
 *      这个频率远低于上限。
 *
 *   3. **失败静默**。网络不通、被墙、API 限流、返回格式变了 —— 全部吞掉，
 *      返回 { ok: false, reason }，绝不抛异常、绝不阻塞面板渲染。
 *
 *   4. **超时 6 秒**。GitHub 在国内经常连不上，不能让面板卡住。
 *
 *   5. **只读版本号**。不下载、不执行、不写插件目录。检测到新版只提示，
 *      升级仍由用户手动跑 install 完成。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const REPO = "yushang657/DSH-YS-pojia";
export const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

const CACHE_FILE = "update-check.json";
const TIMEOUT_MS = 6000;
const DEFAULT_INTERVAL_HOURS = 24;

/* ── 路径 ───────────────────────────────────────────────── */

function dataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "ys-pojia");
}

function cachePath() {
  return path.join(dataDir(), CACHE_FILE);
}

/* ── 版本比较 ───────────────────────────────────────────── */

/** "1.5.4" → [1,5,4]。非数字段按 0 处理，预发布后缀忽略。 */
export function parseVersion(v) {
  const s = String(v || "").trim().replace(/^v/i, "");
  const core = s.split(/[-+]/)[0];
  return core.split(".").map((x) => {
    const n = Number.parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** a > b 返回 1，a < b 返回 -1，相等 0。段数不同时短的一方补 0。 */
export function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/* ── 缓存 ───────────────────────────────────────────────── */

export function readCache() {
  try {
    const raw = fs.readFileSync(cachePath(), "utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

function writeCache(obj) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = cachePath() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmp, cachePath());
  } catch {
    /* 写不进去就算了，下次再查 */
  }
}

/* ── 设置（存在同一个文件里）───────────────────────────── */

export function readSettings() {
  const c = readCache();
  const s = (c && c.settings) || {};
  return {
    /* 是否在有新版时弹窗提示。'on' 默认。
     * 注意：这个开关只控制弹窗，不影响更新页的检测和更新按钮。 */
    promptMode: s.promptMode === "off" ? "off" : "on",
    checkIntervalHours:
      Number(s.checkIntervalHours) > 0 ? Number(s.checkIntervalHours) : DEFAULT_INTERVAL_HOURS,
    /* 上次弹窗的时间与版本，只用于诊断展示 */
    lastPromptedAt: s.lastPromptedAt || "",
    lastPromptedVer: s.lastPromptedVer || "",
  };
}

export function writeSettings(patch) {
  const c = readCache() || {};
  const next = {
    ...c,
    settings: { ...readSettings(), ...patch },
  };
  writeCache(next);
  return readSettings();
}

/* ── 联网检查 ───────────────────────────────────────────── */

/**
 * 查 GitHub 最新版本。
 *
 * @param {object} opts
 * @param {boolean} [opts.force]    忽略缓存，强制联网
 * @param {string}  [opts.current]  当前版本，用于算 hasUpdate
 * @param {number}  [opts.intervalHours] 缓存有效期
 * @returns {Promise<{ok:boolean, reason?:string, latest?:string, current?:string,
 *                    hasUpdate?:boolean, url?:string, name?:string, publishedAt?:string,
 *                    checkedAt?:string, fromCache?:boolean}>}
 */
export async function checkUpdate(opts = {}) {
  const current = String(opts.current || "").trim();
  const force = Boolean(opts.force);
  const intervalHours = Number(opts.intervalHours) || DEFAULT_INTERVAL_HOURS;

  /* 缓存命中就不打网络 */
  if (!force) {
    const c = readCache();
    if (c && c.checkedAt && c.latest) {
      const ageMs = Date.now() - new Date(c.checkedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < intervalHours * 3600 * 1000) {
        return {
          ok: true,
          fromCache: true,
          latest: c.latest,
          current,
          hasUpdate: current ? compareVersion(c.latest, current) > 0 : false,
          url: c.url || RELEASES_PAGE,
          name: c.name || "",
          publishedAt: c.publishedAt || "",
          checkedAt: c.checkedAt,
        };
      }
    }
  }

  /* 联网。带证书降级：
   * 某些 Windows 环境 Node 报 UNABLE_TO_VERIFY_LEAF_SIGNATURE（系统证书链缺中间证书），
   * 但浏览器 / PowerShell 都正常。这种情况降级到不校验证书重试一次 ——
   * 只读一个公开的版本号，不传敏感数据。 */
  let json = null;
  let reason = "";

  const doFetch = async (relaxTls) => {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    /* 降级时 Node 会往 stderr 打一条 TLS warning。面板里不该出现这种东西，
     * 临时接管 emitWarning 把这条吞掉，其余警告照常。 */
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
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        return await fetch(API_LATEST, {
          signal: ctrl.signal,
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "ys-pojia-update-check",
          },
        });
      } finally {
        clearTimeout(timer);
      }
    } finally {
      if (relaxTls) {
        if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
        if (restoreWarning) restoreWarning();
      }
    }
  };

  try {
    let res;
    try {
      res = await doFetch(false);
    } catch (e) {
      const cause = String((e && (e.cause && e.cause.code)) || (e && e.message) || "");
      /* 只在证书类错误时降级重试 */
      if (/CERT|SIGNATURE|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(cause)) {
        res = await doFetch(true);
      } else {
        throw e;
      }
    }

    if (!res.ok) {
      reason = res.status === 403 || res.status === 429
        ? "GitHub API 限流，稍后再试"
        : `GitHub 返回 ${res.status}`;
    } else {
      json = await res.json();
    }
  } catch (e) {
    const cause = String((e && (e.cause && e.cause.code)) || "");
    const msg = String((e && e.message) || e);
    if (/abort/i.test(msg)) reason = "请求超时（网络不通或被墙）";
    else if (/ENOTFOUND|EAI_AGAIN/i.test(cause + msg)) reason = "DNS 解析失败，检查网络";
    else if (/ECONNREFUSED|ECONNRESET/i.test(cause + msg)) reason = "连接被拒绝，可能被墙";
    else reason = "网络请求失败：" + (cause || msg).slice(0, 80);
  }

  if (!json || !json.tag_name) {
    return { ok: false, reason: reason || "GitHub 没有返回版本信息", current };
  }

  const latest = String(json.tag_name || "").replace(/^v/i, "");
  const checkedAt = new Date().toISOString();
  const record = {
    latest,
    name: json.name || "",
    url: json.html_url || RELEASES_PAGE,
    publishedAt: json.published_at || "",
    checkedAt,
    settings: readSettings(),
  };
  writeCache(record);

  return {
    ok: true,
    fromCache: false,
    latest,
    current,
    hasUpdate: current ? compareVersion(latest, current) > 0 : false,
    url: record.url,
    name: record.name,
    publishedAt: record.publishedAt,
    checkedAt,
  };
}

/** 只读缓存，不发网络。面板渲染用这个，避免每次开面板都联网。 */
export function peekUpdate(current) {
  const c = readCache();
  if (!c || !c.latest) {
    return { ok: false, reason: "还没检查过", current, latest: "", hasUpdate: false };
  }
  const latest = String(c.latest);
  return {
    ok: true,
    fromCache: true,
    latest,
    current,
    hasUpdate: current ? compareVersion(latest, current) > 0 : false,
    url: c.url || RELEASES_PAGE,
    name: c.name || "",
    publishedAt: c.publishedAt || "",
    checkedAt: c.checkedAt || "",
  };
}

/** 记录「这次弹过窗了」。只写时间与版本，不改变 promptMode。 */
export function notePrompted(version) {
  const c = readCache() || {};
  writeCache({
    ...c,
    settings: {
      ...readSettings(),
      lastPromptedAt: new Date().toISOString(),
      lastPromptedVer: String(version || ""),
    },
  });
}

/** 清掉缓存（用户想强制重查时用）。 */
export function clearCache() {
  try { fs.rmSync(cachePath(), { force: true }); } catch { /* ignore */ }
}

export const CACHE_LOCATION = cachePath;
