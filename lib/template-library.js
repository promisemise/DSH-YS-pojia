/**
 * 模板库：可检索 + 按需取用。
 *
 * 为什么不整段注入
 * ─────────────────────────────────────────────────────────────
 * 模板正文动辄几十 KB。整段塞进提示词只会挤掉真正的工作上下文，
 * 模型也不会照着那一大段执行。所以做成「索引 + 按需取用」：
 *
 *   - 提示词里只注入一份索引清单（厂商 / 标题 / 字数 / 取用方式）
 *   - 模型需要某个模板时，用 `purge_templates` 工具按 id 精确取全文
 *   - 用户也可以在杂项页里指定默认注入哪几个
 *
 * 目录结构
 * ─────────────────────────────────────────────────────────────
 * 根目录由杂项 `prompt.vendorDir` 指定，下面两种形态都认：
 *
 *   根/厂商名/文件.md           ← 一级子目录当厂商
 *   根/文件名.md                ← 直接放在根下，厂商从文件名推断
 *
 * 文件名不做任何预设：放什么就解析什么。单文件小于 200 字符、
 * 或名字是 README / LICENSE / CHANGELOG / index 的跳过。
 *
 * 解析规则
 * ─────────────────────────────────────────────────────────────
 * 文件用 `#` / `##` / `###` 分节，每节标题当模板标题。
 * 没有可用标题的文件退化为整文件一节，用文件名当标题 —— 不编造名字。
 */

import fs from "node:fs";
import path from "node:path";

/** 目录里认这些扩展名。 */
export const TEMPLATE_EXTENSIONS = Object.freeze([".md", ".mkd", ".txt"]);

/** 单文件小于这个字节数就跳过（多半是占位或说明）。 */
export const TEMPLATE_MIN_BYTES = 200;


/** 单模板正文上限。超过就截断并标记，避免一个 97KB 的节把上下文吃光。 */
export const TEMPLATE_BODY_CAP = 12000;

/** 索引段最多列多少条，防止模板很多时索引本身变成噪音。 */
export const INDEX_ROW_CAP = 80;

/** 索引里单条标题的展示上限。存在超长的乱码标题，不截断会撑爆索引。 */
export const TITLE_DISPLAY_CAP = 60;

/**
 * 把标题压成适合展示的一行。
 *
 * 某些文件的节标题混着同形字符、零宽字符和大量标点，
 * 直接进索引会变成几百字一行的乱码。这里截断并标省略号，
 * 原文仍可通过 `getTemplate` 取到。
 *
 * @param {string} raw
 * @param {number} [cap]
 * @returns {string}
 */
export function displayTitle(raw, cap = TITLE_DISPLAY_CAP) {
  const t = cleanTitle(raw);
  const n = Number.isFinite(cap) ? Math.max(4, Math.trunc(cap)) : TITLE_DISPLAY_CAP;
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * 把一段 markdown 按 `#`/`##`/`###` 切成小节。
 *
 * 返回 `[{ title, body, level }]`。首个标题之前的内容若非空，
 * 归到一个 `title` 为空的节里 —— 不丢内容，也不编造标题。
 *
 * @param {string} text
 * @returns {{ title: string, body: string, level: number }[]}
 */
export function splitSections(text) {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  if (!src.trim()) return [];
  const lines = src.split("\n");
  /** @type {{ title: string, body: string, level: number }[]} */
  const out = [];
  let cur = { title: "", body: [], level: 0 };
  let inFence = false;
  for (const line of lines) {
    // 代码围栏里的 # 不是标题
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{1,3})\s+(\S.*)$/.exec(line);
    if (m) {
      if (cur.body.length || cur.title) {
        out.push({ title: cur.title, body: cur.body.join("\n").trim(), level: cur.level });
      }
      cur = { title: m[2].trim(), body: [], level: m[1].length };
      continue;
    }
    cur.body.push(line);
  }
  if (cur.body.length || cur.title) {
    out.push({ title: cur.title, body: cur.body.join("\n").trim(), level: cur.level });
  }
  return out.filter((s) => s.title || s.body);
}

/** 标题里可能混着零宽字符与同形字符，做一次规整再用于展示。 */
export function cleanTitle(raw) {
  return String(raw ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 模板 id：`vendor/slug`。slug 从标题派生，保持稳定可复现。 */
export function templateId(vendor, title, index) {
  const base = cleanTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // 全中文/全符号标题会派生出空 slug，退回序号，不编造名字
  const slug = base || `s${index + 1}`;
  // 同标题不同序号必须可区分：来源确实有同名节（如多次出现的 "Updated"）
  return index > 0 && base ? `${vendor}/${base}-${index + 1}` : `${vendor}/${slug}`;
}

/**
 * 解析单个来源文件为模板数组。
 *
 * @param {string} vendor
 * @param {string} fileName
 * @param {string} text
 * @returns {{ id: string, vendor: string, title: string, chars: number, body: string }[]}
 */
export function parseTemplateFile(vendor, fileName, text) {
  const sections = splitSections(text);
  const usable = sections.filter((s) => s.body.trim().length > 0);
  // 没有任何可用小节（空文件 / 只有标题）→ 返回空，不占位
  if (!usable.length) return [];
  return usable.map((s, i) => ({
    id: templateId(vendor, s.title || path.basename(fileName, ".mkd"), i),
    vendor,
    title: cleanTitle(s.title) || path.basename(fileName, ".mkd"),
    chars: s.body.length,
    body: s.body,
  }));
}

/**
 * 按文本推断厂商（目录名不可靠时用）。
 *
 * 有些模板库的目录不是厂商名：
 *   厂商A/chatgpt-free-tier.md  → 推断为 openai
 *   厂商A/kimi-standard.md      → 推断为 moonshot
 *   Stealth Models/Beam.md                → 推不出来，保留原目录名
 *
 * @param {string} text
 * @returns {string | null}
 */
function guessVendorByText(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;

  // 顺序很重要：先匹配更具体的
  const rules = [
    // ── 国产（先匹配，避免被通用规则抢走）──
    [/\b(doubao|bytedance|volcengine|skylark|seed-?oss)\b/, "bytedance"],
    [/\b(ernie|wenxin|baidu|yiyan)\b/, "baidu"],
    [/\b(spark|iflytek|xinghuo|generalv)\b/, "iflytek"],
    [/\b(minimax|abab|hailuo)\b/, "minimax"],
    [/\b(yi-lightning|yi-large|yi-medium|yi-vision|01\.?ai|lingyiwanwu)\b/, "01ai"],
    [/\b(sensechat|sensetime|sense-?nova)\b/, "sensetime"],
    [/\b(baichuan)\b/, "baichuan"],
    [/\b(internlm|internvl|xcomposer|shusheng)\b/, "internlm"],
    [/\b(skywork|kunlun|tiangong)\b/, "kunlun"],
    [/\b(telechat|china\s?telecom)\b/, "telechat"],
    [/\b(deepseek)\b/, "deepseek"],
    [/\b(qwen|tongyi|qwq|qvq|alibaba|dashscope)\b/, "alibaba"],
    [/\b(kimi|moonshot)\b/, "moonshot"],
    [/\b(glm|zhipu|chatglm|codegeex|charglm|cogview|zcode)\b/, "zhipu"],
    [/\b(hunyuan|hy3|hy4|tencent|yuanbao)\b/, "tencent"],
    [/\b(mimo|xiaomi)\b/, "xiaomi"],
    [/\b(stepfun|step-)\b/, "stepfun"],
    [/\b(longcat|meituan)\b/, "meituan"],

    // ── 国外 ──
    [/\b(chatgpt|gpt|openai)\b/, "openai"],
    [/\b(claude|sonnet|opus|haiku|anthropic)\b/, "anthropic"],
    [/\b(gemini|gemma|google|bard)\b/, "google"],
    [/\b(grok|xai)\b/, "grok"],
    [/\b(llama|muse|meta)\b/, "meta"],
    [/\b(mistral|mixtral|codestral)\b/, "mistral"],
    [/\b(copilot|phi-|microsoft)\b/, "microsoft"],
    [/\b(perplexity|pplx)\b/, "perplexity"],
    [/\b(cursor|composer)\b/, "cursor"],
    [/\b(hermes|nous)\b/, "nous"],
  ];

  for (const [re, vendor] of rules) {
    if (re.test(s)) return vendor;
  }
  return null;
}

/**
 * 扫描「厂商目录 / 模型.md」结构。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这个
 * ─────────────────────────────────────────────────────────────
 * 模板库 是「一个文件里用 # 分成多个模型节」，而新版资料是
 * 「一个厂商一个目录，一个模型一个 .md 文件，整篇就是一份模板」：
 *
 *   破甲目录/
 *     Zhipu AI/
 *       glm-5-3-flash.md      ← 整篇就是模板
 *     Moonshot AI/
 *       kimi-k2.md
 *     Alibaba/
 *       qwen-3.8.md
 *
 * 之前只认 模板库 的固定文件名，这批资料全部读不到。
 *
 * ─────────────────────────────────────────────────────────────
 * 解析规则
 * ─────────────────────────────────────────────────────────────
 *   · 厂商归属：优先按「目录名 + 文件名」推断（厂商A/chatgpt-x.md → openai），
 *     推不出来才用目录名
 *   · 文件名（去扩展名）= 模型名
 *   · 整篇正文 = 模板体，不按 # 切分（文件里的 # 是文档结构）
 *   · 只读一层子目录，不递归
 *   · 正文 < 200 字的跳过（多半是占位或残片）
 *
 * @param {string} root 模板库根目录
 * @returns {{ vendor: string, dirVendor: string, file: string, title: string, body: string }[]}
 */
export function scanVendorDirs(root) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    // 跳过明显不是厂商目录的
    if (/^(\.|node_modules$|docs?$|assets?$|images?$|scripts?$)/i.test(ent.name)) continue;

    const dirVendor = ent.name;
    const dirPath = path.join(root, dirVendor);
    let files = [];
    try {
      files = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const f of files) {
      if (!f.isFile()) continue;
      if (!/\.(md|mkd|txt)$/i.test(f.name)) continue;
      // 跳过说明文件
      if (/^(readme|license|changelog|index)\.(md|mkd|txt)$/i.test(f.name)) continue;

      const filePath = path.join(dirPath, f.name);
      let body = "";
      try {
        body = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      if (!body.trim()) continue;
      if (body.trim().length < 200) continue;

      const title = f.name.replace(/\.(md|mkd|txt)$/i, "");

      // ── 厂商归属 ──
      //
      // 优先级：
      //   ① 目录名能推断出厂商 → 用目录名（目录是人手工分类的，最可靠）
      //   ② 目录名推不出来（如 "misc"、"others"）→ 按文件名推断
      //   ③ 都推不出来 → 保留目录名
      //
      // 🔴 为什么改成「目录优先」：
      //    Meta 目录里有 "Muse spark 1.3"，文件名带 spark，
      //    按文件名推断会被认成讯飞（iflytek）—— 那是错的。
      //    目录名 Meta 本身能推断，就该信目录。
      const byDir = guessVendorByText(dirVendor);
      const vendor = byDir || guessVendorByText(title) || dirVendor;

      out.push({
        vendor,
        dirVendor,
        file: dirVendor + "/" + f.name,
        title,
        body,
      });
    }
  }

  return out;
}

/**
 * 从目录现读整个模板库。
 *
 * 目录不存在、文件缺失都**不抛**——返回 `{ ok: false, reason, templates: [] }`，
 * 调用方据此退化，绝不假装有内容。
 *
 * @param {string} dir 来源目录
 * @returns {{ ok: boolean, reason: string, dir: string, templates: any[], vendors: string[] }}
 */
export function loadTemplateLibrary(dir) {
  const root = String(dir ?? "").trim();
  if (!root) return { ok: false, reason: "未配置模板目录", dir: "", templates: [], vendors: [] };
  let stat = null;
  try { stat = fs.statSync(root); } catch { /* 不存在 */ }
  if (!stat || !stat.isDirectory()) {
    return { ok: false, reason: "模板目录不存在", dir: root, templates: [], vendors: [] };
  }

  /** @type {any[]} */
  const templates = [];
  const vendorSet = new Set();
  let libHits = 0;
  let dirHits = 0;
  let missing = 0;

  // ── 格式一：根目录下的文件（一个文件里用 # 分成多节）──
  //
  // 文件名不做预设：目录里有什么就解析什么。厂商名从文件名推断，
  // 推不出来就记成 general。
  let rootFiles = [];
  try {
    rootFiles = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(md|mkd|txt)$/i.test(e.name))
      .filter((e) => !/^(readme|license|changelog|index)\.(md|mkd|txt)$/i.test(e.name))
      .map((e) => e.name);
  } catch { rootFiles = []; }
  const rootFileCount = rootFiles.length;
  for (const name of rootFiles) {
    let text = "";
    try { text = fs.readFileSync(path.join(root, name), "utf8"); } catch { continue; }
    if (text.trim().length < TEMPLATE_MIN_BYTES) continue;
    const vendor = guessVendorByText(`${name}\n${text}`) || "general";
    const parsed = parseTemplateFile(vendor, name, text);
    if (!parsed.length) continue;
    vendorSet.add(vendor);
    templates.push(...parsed);
    libHits += parsed.length;
  }

  // ── 格式二：厂商目录 / 模型.md（一个模型一个文件，整篇就是模板）──
  //
  // 这是后加的。新版资料按厂商分目录，之前完全不认 ——
  // 所以国内模型（Qwen / Kimi / GLM / 混元 / MiMo ...）
  // 以及反代出来的国外模型，配了目录也没效果。
  for (const t of scanVendorDirs(root)) {
    vendorSet.add(t.vendor);
    templates.push({
      id: templateId(t.vendor, t.title, 0),
      vendor: t.vendor,
      title: cleanTitle(t.title) || t.title,
      chars: t.body.length,
      body: t.body,
      source: "dir",
      dirVendor: t.dirVendor,
    });
    dirHits += 1;
  }

  if (!templates.length) {
    const why = rootFileCount === 0
      ? "模板目录里既没有文件，也没有「厂商/模型.md」结构"
      : "模板目录里没有可解析的模板";
    return { ok: false, reason: why, dir: root, templates: [], vendors: [] };
  }

  // 排序：厂商升序，同厂商内按标题
  templates.sort((a, b) => {
    const v = String(a.vendor).localeCompare(String(b.vendor));
    return v !== 0 ? v : String(a.title).localeCompare(String(b.title));
  });

  const parts = [];
  if (libHits) parts.push(`模板库 ${libHits} 条`);
  if (dirHits) parts.push(`厂商目录 ${dirHits} 条`);
  const reason = `已读 ${templates.length} 条（${parts.join(" + ")}${missing ? `` : ""}）`;

  return {
    ok: true,
    reason,
    dir: root,
    templates,
    vendors: [...vendorSet],
    stats: { libHits, dirHits, missing, total: templates.length },
  };
}

/**
 * 按 id 取模板全文。超过 `TEMPLATE_BODY_CAP` 截断并标记。
 *
 * @param {any[]} templates
 * @param {string} id
 * @returns {{ ok: boolean, id: string, title?: string, vendor?: string, chars?: number, truncated?: boolean, body?: string, reason?: string }}
 */
export function getTemplate(templates, id) {
  const want = String(id ?? "").trim();
  if (!want) return { ok: false, id: want, reason: "缺少模板 id" };
  const list = Array.isArray(templates) ? templates : [];
  const hit = list.find((t) => t.id === want);
  if (!hit) {
    // 允许用标题模糊匹配一次，减少模型猜错 id 的成本
    const lower = want.toLowerCase();
    const loose = list.filter((t) => t.title.toLowerCase().includes(lower) || t.id.toLowerCase().includes(lower));
    if (loose.length === 1) return formatHit(loose[0]);
    if (loose.length > 1) {
      return {
        ok: false, id: want,
        reason: `匹配到 ${loose.length} 条，请用精确 id：${loose.slice(0, 8).map((t) => t.id).join(", ")}`,
      };
    }
    return { ok: false, id: want, reason: "没有这条模板；先用 purge_templates list 看清单" };
  }
  return formatHit(hit);
}

function formatHit(hit) {
  const body = String(hit.body ?? "");
  const truncated = body.length > TEMPLATE_BODY_CAP;
  return {
    ok: true,
    id: hit.id,
    title: hit.title,
    vendor: hit.vendor,
    chars: body.length,
    truncated,
    body: truncated ? body.slice(0, TEMPLATE_BODY_CAP) : body,
  };
}

/**
 * 生成提示词索引段。
 *
 * 只列 id / 标题 / 字符数，不列正文。模型据此知道「有什么」，
 * 需要时用工具取全文。
 *
 * @param {{ ok: boolean, reason: string, templates: any[], dir: string }} lib
 * @param {{ maxRows?: number, locale?: string }} [opts]
 * @returns {string}
 */
export function buildTemplateIndex(lib, opts = {}) {
  const en = String(opts.locale ?? "").toLowerCase().startsWith("en");
  const maxRows = Number.isFinite(opts.maxRows) ? Math.max(1, Math.trunc(opts.maxRows)) : INDEX_ROW_CAP;
  if (!lib || !lib.ok) {
    const why = lib?.reason || "未知原因";
    return en
      ? `## 越狱模板库\n\n状态：不可用（${why}）。\n在杂项页填好模板目录后重试。\nSet the template directory in the Misc page, then retry.\n`
      : `## 越狱模板库\n\n状态：不可用（${why}）。\n在杂项页填好模板目录后重试。\n`;
  }
  const list = lib.templates.slice(0, maxRows);
  const more = lib.templates.length - list.length;
  if (en) {
    const rows = list.map((t) => `- \`${t.id}\` — ${displayTitle(t.title)} (${t.chars} chars)`).join("\n");
    return [
      "## 越狱模板库",
      "",
      `${lib.templates.length} templates available. Fetch one with \`purge_templates\` when a task needs a specific vendor's framing; do not paste the whole library.`,
      "",
      rows,
      more > 0 ? `\n(+${more} more; use \`purge_templates\` with action=list to page)` : "",
      "",
    ].join("\n");
  }
  const rows = list.map((t) => `- \`${t.id}\` — ${displayTitle(t.title)}（${t.chars} 字）`).join("\n");
  return [
    "## 越狱模板库",
    "",
    `共 ${lib.templates.length} 条。需要某个厂商的框架时用 \`purge_templates\` 按 id 取全文，不要把整库粘进上下文。`,
    "",
    rows,
    more > 0 ? `\n（另有 ${more} 条，用 \`purge_templates\` action=list 翻页）` : "",
    "",
  ].join("\n");
}

/** 给工具用的精简清单（不含正文）。 */
export function listTemplates(templates, opts = {}) {
  const vendor = String(opts.vendor ?? "").trim().toLowerCase();
  const offset = Math.max(0, Math.trunc(Number(opts.offset) || 0));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(opts.limit) || 40)));
  const all = (Array.isArray(templates) ? templates : [])
    .filter((t) => !vendor || t.vendor === vendor);
  const page = all.slice(offset, offset + limit);
  return {
    total: all.length,
    offset,
    limit,
    next: offset + page.length < all.length ? offset + page.length : null,
    rows: page.map((t) => ({ id: t.id, vendor: t.vendor, title: displayTitle(t.title), chars: t.chars })),
  };
}
