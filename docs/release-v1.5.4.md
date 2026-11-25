# v1.5.4 —— 一键安装

装插件原来要三步：clone、cd、`npm run deploy`。而且 `deploy` 只更新**已存在**的插件目录——新用户根本没有目录可更新，装不进去。

这一版把安装压成一条命令，并把文档收短。

## 一键安装

三种入口，同一套逻辑：

```powershell
# Windows，双击 install.bat
# 或 PowerShell：
irm https://raw.githubusercontent.com/yushang657/DSH-YS-pojia/main/install.ps1 | iex
```

```bash
# 任意平台，需要 Node.js ≥ 18
npx github:yushang657/DSH-YS-pojia install
```

安装器处理从零安装：

1. 找 DSH 的 HOME（探 `.dsh` / `.dsh-community` / `DSH_HOME`）
2. 找真正在用的 profile
3. 复制插件进去
4. 往 `cordis.patch.yml` 追加注册块

改动前备份 yml，写入失败自动还原。

想看它会做什么，不实际改动：

```bash
npx github:yushang657/DSH-YS-pojia install --dry-run
```

### 跳过组件清单 profile

DSH 有个 `desktop-builtins` profile，也带 `cordis.patch.yml`，但它的 `cordis.yml` 是空数组——那是内置组件清单，不是运行环境。装进去会污染它。

判据是 `desktop-plugins.lock.json`，只有真运行 profile 才有。

### 重复运行安全

- 插件目录已存在 → 跳过复制（`--force` 强制覆盖）
- 已注册 → 跳过写入

注册检测只扫未注释的行。profile 里有一段注释掉的旧配置（记录「已停用」那段历史），天真搜索会误判成「已注册」。

## install.bat 优先用本地源码

上一版总是重新 clone，即使你就在本地仓库里双击它。

现在先看自己所在目录：`%~dp0` 里的 `package.json` 如果叫 `ys-pojia`，直接用。只有本地没有才下载。

同时修的：

- **Node 版本检查**。原来只查 `where node`，v12 也会继续，然后卡在深处报错。现在解析版本号，低于 18 直接说明。
- **编码**。原文件是 LF 换行、无 BOM。`cmd.exe` 对 LF 解析不稳，没有 BOM 时中文输出乱码。改成 CRLF + UTF-8 BOM。
- **临时目录清理**。成功和失败两条路径都清理。
- **错误提示**。失败时列出两个真实原因：DSH 从没启动过，或 DSH 还在运行占着文件。
- **参数透传**。`--dry-run` 和 `--home` 从 bat 也能用。

## 文档收短

README 原来 708 行 / 20.8 KB，英文版 720 行 / 36.8 KB。绝大多数人只想看「这是什么、怎么装、去哪看细节」。

现在：

| | 之前 | 现在 |
|---|---|---|
| 中文 README | 20.8 KB | 3.2 KB |
| 英文 README | 36.8 KB | 5.2 KB |

留在 README 的：一键安装、怎么验、三层机制概述、三档对比表、核心数据、短板、版本表、CLI 命令。

迁到宣传页的：每层具体实现、完整实测数据、分类明细、模板库细节、自适应升档流程、完整变更记录。README 里每节末尾都有对应锚点链接。

宣传页的安装章节也重写了：一键安装排第一位，手动方式折叠在 `<details>` 里。

## 升级

```bash
cd DSH-YS-pojia && git pull && npm run deploy
```

或者重跑一遍一键安装。

## 装完自检

对话框输入两个字：

```
小雨
```

看到四行回复就是装好了。没反应就重启 DSH，确认面板顶栏显示版本号。

## 完整变更

- 新增 `bin/install.js`（跨平台安装器）
- 新增 `install.ps1`（PowerShell 包装，UTF-8 BOM）
- 新增 `install.bat`（双击安装，优先本地源码）
- 新增 npm scripts：`install` / `install:dry`
- `package.json` 的 `bin` 增加 `ys-pojia-install`
- 两个 README 重写，从 708/720 行压到 167/176 行
- 宣传页安装章节改为「一键优先」
- 修复 `scripts/deploy.mjs` 的 EPERM（目标文件只读时 `copyFileSync` 失败）
