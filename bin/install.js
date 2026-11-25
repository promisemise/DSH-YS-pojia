#!/usr/bin/env node
/**
 * 一键安装 —— 命令行版。
 *
 * 用法：
 *   npx github:yushang657/DSH-YS-pojia install
 *   node bin/install.js
 *   node bin/install.js --home "C:\Users\你\.dsh"
 *   node bin/install.js --dry-run
 *
 * 做四件事：
 *   1. 找 DSH 的 HOME 目录（含 profiles 的那个）
 *   2. 把插件复制进每个 profile 的 node_modules
 *   3. 在 profile 的 cordis.patch.yml 里注册插件
 *   4. 提示重启
 *
 * 全程可回滚：改动前备份 cordis.patch.yml，出错自动还原。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLUGIN_ID = "ys-pojia";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run") || args.includes("-n");
const QUIET = args.includes("--quiet") || args.includes("-q");
const FORCE = args.includes("--force") || args.includes("-f");
const homeArg = (() => {
  const i = args.findIndex((a) => a === "--home" || a === "-H");
  return i >= 0 && args[i + 1] ? args[i + 1] : "";
})();

const out = (s = "") => { if (!QUIET) console.log(s); };
const step = (s) => out("  " + s);
const ok = (s) => out("  \x1b[32m✓\x1b[0m " + s);
const warn = (s) => out("  \x1b[33m!\x1b[0m " + s);
const bad = (s) => out("  \x1b[31m✗\x1b[0m " + s);

/* ── 1. 找 HOME ─────────────────────────────────────────── */

function candidateHomes() {
  const list = [];
  if (homeArg) list.push(path.resolve(homeArg));
  if (process.env.DSH_HOME) list.push(path.resolve(process.env.DSH_HOME));
  const home = os.homedir();
  // 常见位置，按优先级
  list.push(path.join(home, ".dsh"));
  list.push(path.join(home, ".dsh-community"));
  return [...new Set(list)];
}

function looksLikeDshHome(p) {
  try {
    return fs.statSync(path.join(p, "profiles")).isDirectory();
  } catch {
    return false;
  }
}

function findHome() {
  for (const p of candidateHomes()) {
    if (looksLikeDshHome(p)) return p;
  }
  return "";
}

/* ── 2. 找可安装的 profile ──────────────────────────────── */

function listProfiles(home) {
  const dir = path.join(home, "profiles");
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    // 备份目录和内部事务目录跳过
    .filter((e) => !e.name.startsWith(".") && !e.name.includes(".backup-"))
    .map((e) => ({
      name: e.name,
      dir: path.join(dir, e.name),
      pluginDir: path.join(dir, e.name, "node_modules", PLUGIN_ID),
      patchFile: path.join(dir, e.name, "cordis.patch.yml"),
    }))
    // 只装到有 cordis.patch.yml 的 profile
    .filter((p) => fs.existsSync(p.patchFile))
    /* 排除 DSH 的组件清单 profile：它的 cordis.yml 是空数组，
     * 只用来声明内置组件，不是用户运行环境。装进去会污染它。
     * 判据是真运行 profile 有 desktop-plugins.lock.json。 */
    .filter((p) => fs.existsSync(path.join(p.dir, "desktop-plugins.lock.json")));
}

/* ── 3. 复制插件 ────────────────────────────────────────── */

const SKIP_DIRS = new Set([".git", "node_modules", "ai_workspace", "plugin-backups"]);

function copyPlugin(src, dst) {
  let count = 0;
  const walk = (s, d) => {
    fs.mkdirSync(d, { recursive: true });
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const sp = path.join(s, e.name);
      const dp = path.join(d, e.name);
      if (e.isDirectory()) walk(sp, dp);
      else if (e.isFile()) {
        // 目标可能只读，先清属性
        try { fs.chmodSync(dp, 0o666); } catch { /* 不存在 */ }
        fs.copyFileSync(sp, dp);
        count += 1;
      }
    }
  };
  walk(src, dst);
  return count;
}

/* ── 4. 注册到 cordis.patch.yml ─────────────────────────── */

const BLOCK = `- insert:
    - id: ys-pojia
      name: ys-pojia
      inject: [ systemPrompt, tools ]
      config:
        enabled: true
        stripMnemon: true
        capabilityProtocol: true
        hooksDenyBypass: true`;

function isRegistered(yaml) {
  // 只看未注释的行
  return yaml.split("\n").some((l) => /^\s*-\s*id:\s*ys-pojia\s*$/.test(l));
}

function register(yaml) {
  const eol = yaml.includes("\r\n") ? "\r\n" : "\n";
  const body = yaml.endsWith("\n") ? yaml : yaml + eol;
  return body + eol + BLOCK.split("\n").join(eol) + eol;
}

/* ── 主流程 ────────────────────────────────────────────── */

function main() {
  out("");
  out("\x1b[1mYS-pojia 安装程序\x1b[0m");
  out("");

  /* 版本 */
  let version = "?";
  try {
    version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  } catch { /* ignore */ }
  step("插件版本 " + version);

  /* Node 版本 */
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    bad("Node.js 需要 18 或更高，当前 " + process.versions.node);
    process.exit(1);
  }
  step("Node.js " + process.versions.node);

  /* HOME */
  const home = findHome();
  if (!home) {
    bad("没找到 DSH 的 HOME 目录");
    out("");
    step("找过这些位置：");
    for (const p of candidateHomes()) step("  " + p);
    out("");
    step("如果 DSH 装在别处，用 --home 指定：");
    step('  node bin/install.js --home "C:\\Users\\你\\.dsh"');
    process.exit(1);
  }
  ok("DSH HOME: " + home);

  /* profile */
  const profiles = listProfiles(home);
  if (profiles.length === 0) {
    bad("这个 HOME 下没有可安装的 profile");
    step("先启动一次 DSH，让它生成 profiles 目录，再回来装。");
    process.exit(1);
  }
  ok("找到 " + profiles.length + " 个 profile: " + profiles.map((p) => p.name).join(", "));

  out("");
  out("\x1b[1m开始安装\x1b[0m");

  const results = [];

  for (const p of profiles) {
    out("");
    step("[" + p.name + "]");

    const already = fs.existsSync(p.pluginDir);
    if (already && !FORCE) {
      warn("插件已存在，跳过复制（--force 强制覆盖）");
    } else {
      if (DRY) {
        step("  [dry-run] 会复制到 " + p.pluginDir);
      } else {
        try {
          const n = copyPlugin(ROOT, p.pluginDir);
          ok("复制 " + n + " 个文件");
        } catch (e) {
          bad("复制失败: " + (e && e.message ? e.message : e));
          results.push({ name: p.name, ok: false });
          continue;
        }
      }
    }

    /* 注册 */
    let yaml = "";
    try {
      yaml = fs.readFileSync(p.patchFile, "utf8");
    } catch (e) {
      bad("读不到 cordis.patch.yml: " + (e && e.message ? e.message : e));
      results.push({ name: p.name, ok: false });
      continue;
    }

    if (isRegistered(yaml)) {
      ok("已在 profile 里注册，跳过");
    } else if (DRY) {
      step("  [dry-run] 会往 cordis.patch.yml 追加注册块");
    } else {
      const bak = p.patchFile + ".bak-install-" + Date.now();
      try {
        fs.copyFileSync(p.patchFile, bak);
        fs.writeFileSync(p.patchFile, register(yaml), "utf8");
        ok("已注册（备份: " + path.basename(bak) + "）");
      } catch (e) {
        bad("注册失败: " + (e && e.message ? e.message : e));
        // 还原
        try { fs.copyFileSync(bak, p.patchFile); step("  已还原"); } catch { /* ignore */ }
        results.push({ name: p.name, ok: false });
        continue;
      }
    }

    results.push({ name: p.name, ok: true });
  }

  /* 汇总 */
  out("");
  const good = results.filter((r) => r.ok).length;
  const failed = results.length - good;

  if (DRY) {
    out("\x1b[1m[dry-run] 没有实际改动。\x1b[0m");
    return;
  }

  if (failed === 0) {
    out("\x1b[32m\x1b[1m安装完成\x1b[0m  " + good + " 个 profile");
    out("");
    out("\x1b[1m下一步\x1b[0m");
    step("1. 完全退出 DSH（不是关窗口，要退进程）");
    step("2. 重新打开");
    step("3. 在对话框输入「小雨」两个字，看到四行回复就是装好了");
    out("");
    step("卸载: node bin/ys-pojia.js --uninstall");
  } else {
    bad("有 " + failed + " 个 profile 安装失败");
    step("失败的不影响其他 profile，可以单独重试。");
    process.exit(1);
  }
}

main();
