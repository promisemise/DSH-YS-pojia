// 解包 app.asar 成目录，供插件打补丁
//
// 为什么需要这一步：
//   0.2.2-rc.5 把宿主封在 app.asar 里，磁盘上没有可写的 @deepseek-ai。
//   插件的补丁档要改宿主源码，必须有一份可写的解包目录。
//
// 原理：
//   Electron 的 --app-path 既可以指向 .asar 文件，也可以指向目录。
//   解包后把快捷方式的 --app-path 改指目录，宿主照常运行，插件就能打补丁。
//
// 用法：
//   node unpack-asar.mjs              # 解包到 resources/app
//   node unpack-asar.mjs --verify     # 只校验，不解包

import { openSync, readSync, closeSync, mkdirSync, writeFileSync, existsSync, statSync, copyFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (args.length < 2) {
  console.error("用法: node scripts/unpack-asar.mjs <app.asar 路径> <输出目录>");
  console.error("示例: node scripts/unpack-asar.mjs \"C:/.../resources/app.asar\" \"C:/.../resources/app\"");
  process.exit(2);
}
const ASAR = args[0].replace(/\\/g, "/");
const OUT = args[1].replace(/\\/g, "/");
const UNPACKED = ASAR + ".unpacked";
const VERIFY_ONLY = process.argv.includes("--verify");

function readHeader(file) {
  const fd = openSync(file, "r");
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const jsonSize = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonSize);
  readSync(fd, json, 0, jsonSize, 16);
  closeSync(fd);
  /*
   * asar 头部布局（Chromium Pickle）：
   *   [0..3]   uint32 = 4          （payload 长度前缀）
   *   [4..7]   uint32 = headerSize  （header pickle 总长）
   *   [8..11]  uint32 = headerSize - 4
   *   [12..15] uint32 = jsonSize
   *   [16..]   JSON
   * 之后补齐到 4 字节边界，才是文件数据区。
   *
   * 早先按 8 + jsonSize 算，少算了 16 字节头和 3 字节对齐，
   * 导致每个文件都带上前一个文件的尾巴（package.json 前面多了 ":!0})})();"）。
   */
  const dataBase = (16 + jsonSize + 3) & ~3;
  return { header: JSON.parse(json.toString("utf8")), dataBase };
}

function readEntry(fd, entry, dataBase) {
  const buf = Buffer.alloc(entry.size);
  readSync(fd, buf, 0, entry.size, dataBase + Number(entry.offset));
  return buf;
}

const { header, dataBase } = readHeader(ASAR);

// 统计
let fileCount = 0, dirCount = 0, totalBytes = 0, unpackedCount = 0;
function count(node) {
  if (node.files) {
    dirCount++;
    for (const v of Object.values(node.files)) count(v);
  } else {
    fileCount++;
    totalBytes += node.size || 0;
    if (node.unpacked) unpackedCount++;
  }
}
count(header);

console.log("=== 源 asar ===");
console.log("  路径: " + ASAR);
console.log("  大小: " + (statSync(ASAR).size / 1024 / 1024).toFixed(1) + " MB");
console.log("  内容: " + fileCount + " 文件 / " + dirCount + " 目录 / " + (totalBytes / 1024 / 1024).toFixed(1) + " MB");
console.log("  其中 unpacked: " + unpackedCount + " 个（不在 asar 内，从 app.asar.unpacked 复制）");
console.log("  数据区起点: " + dataBase);

if (VERIFY_ONLY) {
  console.log("\n--verify 模式，不解包");
  process.exit(0);
}

if (existsSync(OUT)) {
  console.log("\n⚠ 目标目录已存在: " + OUT);
  console.log("  确认要覆盖请先手动删除");
  process.exit(1);
}

console.log("\n=== 解包到 ===");
console.log("  " + OUT);

const fd = openSync(ASAR, "r");
let written = 0, failed = 0, unpackedWritten = 0;

function extract(node, relPath) {
  if (node.files) {
    const dir = path.join(OUT, relPath);
    try { mkdirSync(dir, { recursive: true }); } catch (e) { failed++; return; }
    for (const [name, child] of Object.entries(node.files)) {
      extract(child, path.join(relPath, name));
    }
  } else {
    const dest = path.join(OUT, relPath);
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      if (node.unpacked) {
        // 这类文件存在 app.asar.unpacked 里，asar 内只有元数据
        const src = path.join(UNPACKED, relPath);
        copyFileSync(src, dest);
        unpackedWritten++;
      } else {
        writeFileSync(dest, readEntry(fd, node, dataBase));
      }
      written++;
      if (written % 2000 === 0) process.stdout.write("  " + written + " 文件...\r");
    } catch (e) {
      failed++;
      if (failed <= 5) console.error("  ✗ " + relPath + ": " + e.message);
    }
  }
}

const t0 = Date.now();
extract(header, "");
closeSync(fd);

console.log("\n=== 完成 ===");
console.log("  写入: " + written + " 文件");
console.log("  其中 unpacked: " + unpackedWritten + " 个");
console.log("  失败: " + failed + " 个");
console.log("  耗时: " + ((Date.now() - t0) / 1000).toFixed(1) + " 秒");
console.log("  输出: " + OUT);

// 验证关键文件
console.log("\n=== 关键文件校验 ===");
for (const f of ["dsh/package.json", "package.json", "dsh/node_modules/@deepseek-ai/dsh/package.json"]) {
  const p = path.join(OUT, f);
  console.log("  " + (existsSync(p) ? "OK  " : "✗   ") + f);
}
