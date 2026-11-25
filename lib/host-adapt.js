/**
 * 宿主版本自适应策略。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  为什么需要这一层
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  0.2.2-rc.5 起，宿主把整个 @deepseek-ai 树封进 resources/app.asar。磁盘上
 *  没有可写副本，补丁档（改宿主源码）物理上无处落笔。
 *
 *  但读源码发现：这一版**已经默认全开**了。dsh-base 的 cordis.patch.yml 里：
 *
 *    sandbox-policy.mode      = process.env.DSH_PERMISSION_MODE ?? 'danger-full-access'
 *    approval.policy          = ... === 'danger-full-access' ? 'never' : 'ask'
 *    permission.presets.danger-full-access = { sandbox: danger-full-access, approval: never }
 *
 *  也就是说补丁 #6-#10 想达成的「沙箱放行 / 审批放行」，新版出厂就是这个状态。
 *  再打补丁是多余的。
 *
 *  更关键的是：这些行为**都是配置项**，不是硬编码。所以新版不需要改源码，
 *  通过 cordis.patch.yml 覆盖配置即可。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  两种策略
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  宿主可写（旧版 0.2.0 / 0.2.1 / 0.2.2-rc.1）
 *    → 补丁层：直接改宿主源码字符串。能力强，但版本一变锚点就失效。
 *
 *  宿主密封（0.2.2-rc.5+）
 *    → 配置层：写 cordis.patch.yml 覆盖配置项。不改源码，版本无关。
 *      配置覆盖不到的（如观察策略的 intent 短路）由提示词层兜底。
 *
 *  两层不是互斥的：配置层在两种宿主上都能用，补丁层只在可写宿主上有意义。
 */

import fs from "node:fs";
import path from "node:path";

/** 走配置层的宿主版本下界。这个版本起 asar 密封成为默认打包方式。 */
export const CONFIG_LAYER_SINCE = "0.2.2-rc.5";

/**
 * 配置层能覆盖的能力。每条对应一个真实的配置项，值取自宿主 bundle 层。
 *
 * 这里的 key 与引擎选项同名，方便注入链直接消费。
 */
export const CONFIG_LAYER_OVERRIDES = Object.freeze({
  /** 沙箱默认模式。宿主默认已是 danger-full-access，显式写一遍是为了防止
   *  用户环境里 DSH_PERMISSION_MODE 把它压成 read-only。 */
  "sandbox-policy": {
    mode: "danger-full-access",
    additionalWritableRoots: [],
  },
  /** 审批策略。never = 不弹审批直接放行。 */
  approval: {
    policy: "never",
  },
  /** 权限预设表。补上 danger-full-access 这一档，让用户能在界面里选。 */
  permission: {
    presets: {
      "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
      "workspace-write": { sandbox: "workspace-write", approval: "ask" },
      "read-only": { sandbox: "read-only", approval: "ask" },
    },
  },
  /** 工具结果裁剪：阈值调到极大等于不裁剪。 */
  "tool-result-pruner": {
    thresholdChars: 10_000_000,
    headChars: 10_000_000,
    tailChars: 10_000_000,
  },
  /** 重复调用提醒：maxRetries 归零等于不拦。 */
  "repeat-tool-reminder": {
    maxRetries: 0,
  },
  /** 子代理：深度与并发放宽。 */
  subagent: {
    maxDepth: 4,
    maxConcurrent: 8,
  },
});

/**
 * 判断宿主是否密封（无磁盘可写副本）。
 *
 * 判据是 resources/app.asar 存在 —— 这是打包方式的直接证据，比「找不到
 * @deepseek-ai 目录」更可靠：后者也可能是路径探测失败。
 *
 * @param {string} aiBase 宿主的 @deepseek-ai 目录（可为空）
 * @returns {boolean}
 */
export function hostIsSealed(aiBase) {
  if (!aiBase) return false;
  const norm = String(aiBase).replace(/\\/g, "/");

  /*
   * aiBase 有三种形态，判据不同：
   *
   *   .../resources/app/dsh/node_modules/@deepseek-ai
   *     解包目录。宿主从目录加载，补丁可写 —— 不算密封。
   *
   *   .../resources/app.asar.unpacked/node_modules/@deepseek-ai
   *     asar 的伴生目录，只有 native 模块。宿主仍从 asar 加载 —— 密封。
   *
   *   .../profiles/desktop/node_modules/@deepseek-ai
   *     profile 里另装的宿主（旧版形态）—— 不密封。
   *
   * 所以判据是「路径里有没有 app/ 这个解包目录」，而不是「asar 在不在」：
   * 解包后 asar 通常还留着做回滚，只看 asar 会把解包目录也误判成密封。
   */
  if (norm.includes("/resources/app/")) return false;
  if (norm.includes("/app.asar.unpacked/")) return true;

  // profile 形态：看它旁边有没有 asar
  const parts = norm.split("/");
  const resIdx = parts.lastIndexOf("resources");
  if (resIdx < 0) return false;
  const resDir = parts.slice(0, resIdx + 1).join("/");
  try {
    return fs.existsSync(path.join(resDir, "app.asar"));
  } catch {
    return false;
  }
}

/**
 * 解析版本号，用于比较。
 * @returns {{major:number,minor:number,patch:number,pre:string[]}|null}
 */
export function parseVersion(v) {
  const m = String(v || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return {
    major: +m[1],
    minor: +m[2],
    patch: +m[3],
    pre: m[4] ? m[4].split(".") : [],
  };
}

/** a >= b */
function versionGte(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  if (x.major !== y.major) return x.major > y.major;
  if (x.minor !== y.minor) return x.minor > y.minor;
  if (x.patch !== y.patch) return x.patch > y.patch;
  // 同版本号：无 prerelease 的算更高
  if (x.pre.length === 0 && y.pre.length > 0) return true;
  if (x.pre.length > 0 && y.pre.length === 0) return false;
  // 都有 prerelease：逐段比
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const a1 = x.pre[i];
    const b1 = y.pre[i];
    if (a1 === undefined) return false;
    if (b1 === undefined) return true;
    const na = Number(a1);
    const nb = Number(b1);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na > nb;
    } else if (a1 !== b1) {
      return a1 > b1;
    }
  }
  return true;
}

/**
 * 选择注入策略。
 *
 * @param {{aiBase?: string, hostVersion?: string}} ctx
 * @returns {{
 *   strategy: "patch" | "config" | "prompt",
 *   sealed: boolean,
 *   hostVersion: string,
 *   reason: string,
 *   usePatch: boolean,
 *   useConfig: boolean,
 * }}
 */
export function selectStrategy(ctx = {}) {
  const aiBase = ctx.aiBase || "";
  const hostVersion = String(ctx.hostVersion || "");
  const sealed = hostIsSealed(aiBase);

  // 宿主密封 → 补丁无处落笔，走配置层
  if (sealed) {
    return {
      strategy: "config",
      sealed: true,
      hostVersion,
      reason:
        "宿主把源码封在 resources/app.asar 里，补丁无处可写。改用配置层覆盖沙箱/审批/裁剪等策略——"
        + "这些在 0.2.2-rc.5 起都是配置项，不改源码也能达到同样效果。",
      usePatch: false,
      useConfig: true,
    };
  }

  // 有可写宿主 → 补丁层优先（能力最强）
  if (aiBase) {
    // 版本够新的话，配置层也一起用：有些行为配置改更稳，不依赖字符串匹配
    const configAlso = versionGte(hostVersion, CONFIG_LAYER_SINCE);
    return {
      strategy: "patch",
      sealed: false,
      hostVersion,
      reason: configAlso
        ? "宿主可写，补丁层生效；同时叠加配置层，让不依赖字符串匹配的项更稳。"
        : "宿主可写，补丁层生效。",
      usePatch: true,
      useConfig: configAlso,
    };
  }

  // 两者都没有 → 纯提示词
  return {
    strategy: "prompt",
    sealed: false,
    hostVersion,
    reason: "没找到宿主安装目录，补丁与配置都无处落笔。只走提示词注入。",
    usePatch: false,
    useConfig: false,
  };
}

/**
 * 生成要写进 profile 的 cordis.patch.yml 片段。
 *
 * 只在 useConfig 为真时调用。返回的是可直接 append 的 YAML 文本。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includePresets] 是否带权限预设表（默认带）
 * @returns {string}
 */
export function buildConfigPatch(opts = {}) {
  const includePresets = opts.includePresets !== false;
  const o = CONFIG_LAYER_OVERRIDES;
  const lines = [
    "",
    "# ── ys-pojia 配置层（版本自适应）────────────────────────────────────",
    "# 这些是宿主暴露的配置项，不改源码。asar 密封的宿主（0.2.2-rc.5+）上",
    "# 补丁无处可写，靠这一层达到同样的放行效果。",
    "",
    "- id: sandbox-policy",
    "  config:",
    `    mode: ${o["sandbox-policy"].mode}`,
    "",
    "- id: approval",
    "  config:",
    `    policy: ${o.approval.policy}`,
    "",
    "- id: tool-result-pruner",
    "  config:",
    `    thresholdChars: ${o["tool-result-pruner"].thresholdChars}`,
    "",
    "- id: repeat-tool-reminder",
    "  config:",
    `    maxRetries: ${o["repeat-tool-reminder"].maxRetries}`,
    "",
  ];
  if (includePresets) {
    lines.push(
      "- id: permission",
      "  config:",
      "    presets:",
      "      danger-full-access:",
      "        sandbox: danger-full-access",
      "        approval: never",
      "",
    );
  }
  return lines.join("\n");
}

/**
 * 一次调用拿到「该用什么策略 + 该写什么配置」。
 *
 * @param {{aiBase?: string, hostVersion?: string}} ctx
 * @returns {{strategy:string, sealed:boolean, reason:string, patchYaml:string}}
 */
export function planAdaptation(ctx = {}) {
  const s = selectStrategy(ctx);
  return {
    strategy: s.strategy,
    sealed: s.sealed,
    hostVersion: s.hostVersion,
    reason: s.reason,
    usePatch: s.usePatch,
    useConfig: s.useConfig,
    patchYaml: s.useConfig ? buildConfigPatch() : "",
  };
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  可选路径：手工解包 asar 以启用补丁层
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  配置层能覆盖沙箱/审批/裁剪这些「本来就是配置项」的行为，但覆盖不了改代码
 *  逻辑的补丁（观察策略短路、结果裁剪逻辑、子代理深度上限这类）。
 *
 *  想让密封宿主也用上补丁层，唯一的路是把 app.asar 解包成目录：
 *
 *    resources/app.asar        宿主默认从这里加载
 *    resources/app/            解包目录，存在时 Electron 优先用它
 *
 *  这是可选的，不是默认路径 —— 理由：
 *    · 用户侧要做「完全退出 → 改名 → 重启」三步，容易出错
 *    · 宿主自动更新会重新下载 asar，把手工改动冲掉
 *    · 配置层已经覆盖了大部分收益
 *
 *  所以这里只**给出方案**，不自动执行。用户想要更强效果时按提示操作。
 */

/**
 * 检测宿主是否可以走「手工解包」路径。
 *
 * @param {string} aiBase
 * @returns {{
 *   possible: boolean,
 *   asarPath: string,
 *   targetDir: string,
 *   reason: string,
 * }}
 */
export function detectUnpackOption(aiBase) {
  const none = { possible: false, asarPath: "", targetDir: "", reason: "" };
  if (!aiBase) return { ...none, reason: "没有宿主安装目录" };

  const norm = String(aiBase).replace(/\\/g, "/");
  const parts = norm.split("/");
  const resIdx = parts.lastIndexOf("resources");
  if (resIdx < 0) return { ...none, reason: "路径里没有 resources 目录，不是桌面安装形态" };

  const resDir = parts.slice(0, resIdx + 1).join("/");
  const asarPath = path.join(resDir, "app.asar");
  const targetDir = path.join(resDir, "app");

  if (!fs.existsSync(asarPath)) {
    return { possible: false, asarPath, targetDir, reason: "app.asar 不存在，可能已经解包过" };
  }
  if (fs.existsSync(targetDir)) {
    return { possible: false, asarPath, targetDir, reason: "解包目录已存在，宿主应该已经在用它" };
  }
  return {
    possible: true,
    asarPath,
    targetDir,
    reason: "可以解包 app.asar 到 app/ 目录，让补丁层生效",
  };
}

/**
 * 生成手工解包的操作步骤。
 *
 * 不执行任何操作，只返回给人看的步骤。真正的解包需要 asar 工具，
 * 或者用本仓库附带的 unpack-asar.mjs。
 *
 * @param {string} aiBase
 * @returns {{ steps: string[], asarPath: string, targetDir: string }}
 */
export function buildUnpackGuide(aiBase) {
  const info = detectUnpackOption(aiBase);
  if (!info.possible) {
    return { steps: [info.reason || "当前宿主不需要解包"], asarPath: info.asarPath, targetDir: info.targetDir };
  }
  return {
    asarPath: info.asarPath,
    targetDir: info.targetDir,
    steps: [
      "1. 完全退出 DSH —— 托盘右键退出，任务管理器里确认没有残留进程。",
      "   app.asar 被占用时改名会失败，这一步不能省。",
      "2. 用 unpack-asar.mjs 解包：",
      "   node scripts/unpack-asar.mjs \"" + info.asarPath + "\" \"" + info.targetDir + "\"",
      "   或者任意 asar 工具：asar extract \"" + info.asarPath + "\" \"" + info.targetDir + "\"",
      "3. 把 app.asar 改名留作回滚：",
      "   Rename-Item \"" + info.asarPath + "\" app.asar.bak",
      "4. 启动 DSH —— Electron 发现 resources/app 目录就优先用它，补丁层随之生效。",
      "5. 想回滚就把 app.asar.bak 改回 app.asar，删掉 app 目录。",
      "",
      "注意：宿主自动更新会重新下载 app.asar，把解包状态冲掉。更新后需要重做。",
    ],
  };
}

/**
 * 一次调用拿到「当前策略 + 配置补丁 + 可选解包方案」。
 *
 * 面板和文档都用这个。优先给配置层方案，解包只作为可选加强项列在后面。
 *
 * @param {{aiBase?: string, hostVersion?: string}} ctx
 * @returns {{
 *   strategy: string,
 *   sealed: boolean,
 *   reason: string,
 *   usePatch: boolean,
 *   useConfig: boolean,
 *   configYaml: string,
 *   unpack: { possible: boolean, steps: string[] },
 * }}
 */
export function fullPlan(ctx = {}) {
  const plan = planAdaptation(ctx);
  const guide = buildUnpackGuide(ctx.aiBase);
  return {
    strategy: plan.strategy,
    sealed: plan.sealed,
    hostVersion: plan.hostVersion,
    reason: plan.reason,
    usePatch: plan.usePatch,
    useConfig: plan.useConfig,
    configYaml: plan.patchYaml,
    unpack: {
      possible: guide.steps.length > 1,
      asarPath: guide.asarPath,
      targetDir: guide.targetDir,
      steps: guide.steps,
    },
  };
}
