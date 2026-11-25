#!/usr/bin/env node
/**
 * 生成 version-manifest.json。
 *
 * 内容：每个参与更新的文件的 sha256。客户端拿它比对本地文件，
 * 只下载变化的那些。
 *
 * 用法：
 *   node scripts/gen-manifest.mjs
 *
 * 发布流程里应该跑一次，然后提交清单。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* 与 lib/file-update.js 保持一致 */
const SKIP_PREFIXES = [".git/", "node_modules/", "ai_workspace/", "plugin-backups/"];
const SKIP_EXACT = new Set(["package.json", "cordis.patch.yml", "version-manifest.json"]);

function shouldSkip(rel) {
  if (SKIP_EXACT.has(rel)) return true;
  return SKIP_PREFIXES.some((p) => rel.startsWith(p));
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function walk(dir, prefix, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + "/" + e.name : e.name;
    if (shouldSkip(rel)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, rel, out);
    else if (e.isFile()) {
      out[rel] = sha256(fs.readFileSync(full));
    }
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const files = {};
walk(ROOT, "", files);

/* 排序，让 diff 稳定 */
const sorted = {};
for (const k of Object.keys(files).sort()) sorted[k] = files[k];

const manifest = {
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  fileCount: Object.keys(sorted).length,
  files: sorted,
};

const outPath = path.join(ROOT, "version-manifest.json");
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log("version-manifest.json");
console.log("  版本   " + manifest.version);
console.log("  文件数 " + manifest.fileCount);
console.log("  大小   " + (fs.statSync(outPath).size / 1024).toFixed(1) + " KB");
