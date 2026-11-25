/**
 * 安装位置与版本查询。
 *
 * 这个文件原来还带着一整套「更新渠道」逻辑：检查远端版本、下载 zip、切换
 * channel、启动时自动更新。那套东西是 dsh-purge 时代的残留 —— 仓库地址常量
 * 早就被清空成 `const REPO = ""`，拼出来的 URL 是
 * `codeload.github.com//zip/refs/heads/master`，一个不存在的地址。
 *
 * 也就是说它不是「失效的功能」，而是「指向别人的功能」。本插件没有服务器，
 * 也不该有自动更新：更新会覆盖用户改过的 prompt-inject.md、armor-rules.json
 * 和本地补丁。现在只保留三个查询能力，其余全部删除。
 *
 * 想升级的话，用户自己去 Releases 页看，然后 `git pull && npm run deploy`。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDshHome } from "./core.js";

/** 插件根目录（本文件所在目录的上一级）。 */
const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * 包名 / 安装目录名。
 *
 * 改名之后装的是 `node_modules/ys-pojia`，但历史安装仍在 `node_modules/dsh-purge`。
 * 两个都要认 —— 卸载和 profile 查找靠它，少认一个就会留一堆删不掉的旧文件。
 */
export const PKG_NAMES = ["ys-pojia", "ys-pojia"];

/** 插件根目录。 */
export function pluginRoot() {
  return PLUGIN_ROOT;
}

/** 当前安装的版本号，读 package.json。读不到返回空字符串。 */
export function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"));
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

/** 读 JSON，失败返回 null。 */
function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

/** 解析符号链接，拿真实路径。拿不到就返回原路径。 */
export function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * 列出所有装着本插件的 profile。
 *
 * 遍历 `~/.dsh/profiles/*`，看每个 profile 的 package.json 里有没有
 * `ys-pojia` 或 `ys-pojia` 依赖。
 *
 * @returns {Array<{name: string, dir: string, spec: string}>}
 */
export function findPurgeProfiles() {
  const root = path.join(findDshHome(), "profiles");
  if (!fs.existsSync(root)) return [];

  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }

  const out = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const pkg = readJson(path.join(dir, "package.json"));

    let spec = null;
    for (const key of ["dependencies", "devDependencies"]) {
      for (const pn of PKG_NAMES) {
        if (pkg?.[key]?.[pn]) {
          spec = pkg[key][pn];
          break;
        }
      }
      if (spec) break;
    }
    if (!spec) continue;

    out.push({ name, dir, spec: String(spec) });
  }
  return out;
}

/**
 * 某个 profile 里插件的实际安装目录。找不到返回空字符串。
 *
 * 两个包名都试 —— 老安装是 dsh-purge 目录。
 */
export function profilePluginDir(profileDir) {
  for (const nm of PKG_NAMES) {
    const p = path.join(profileDir, "node_modules", nm);
    if (fs.existsSync(p)) return realPath(p);
  }
  return "";
}
