# ys-pojia

**破甲插件（DSH 平台）** —— 让大模型按需解除拒答。

[English](README.en.md) · **简体中文**

> **[在线宣传页 →](https://yushang657.github.io/DSH-YS-pojia/)** · 机制图解、三档对比、实测数据、模板库、短板说明

<!-- QQ 群 -->
<p align="left">
  <b>交流群：爬虫、破甲交流群 · QQ 群号 674672646 · 扫码加入，一起交流技术问题</b><br>
  <a href="https://qm.qq.com/q/674672646" target="_blank">
    <img src="docs/images/qq-group.jpg" alt="加入 QQ 群 674672646 交流" width="288">
  </a>
</p>

![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)
![dsh](https://img.shields.io/badge/dsh-0.2.x-0ea5e9?style=flat-square)
![node](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square)
![ASR](https://img.shields.io/badge/ASR-46.2%25-e11d48?style=flat-square)
![benign](https://img.shields.io/badge/benign%20cost-%CE%94%200-16a34a?style=flat-square)

---

## 功能

三层同时动手，任一环断掉还有另外两层兜底：

```
① 宿主层   96 条补丁 / 70 个载体文件    改 DSH 自身的代码与常量
② 消息层   历史清洗 + 尾部约束 + 预填充   改请求消息视图，不落盘
③ 提示词层 11 个 section                注入 system prompt
```

具体能力：

- **三档引擎** —— T3 补丁档（能力上限最高）/ T2 边界改写档（零补丁）/ T1 纯提示词档（最保守），装完可切
- **超频模式** —— 按模型厂商自适应，9 组文案覆盖国际与国产模型
- **模板库** —— 95 套 / 29 家厂商，按模型自动匹配
- **规则面板** —— 40 条规则分组勾选，实时生效
- **CLI** —— 可脱离 DSH 使用：状态、应用、回滚
- **一键安装** —— 见下

## 适配

| 项 | 支持范围 |
|---|---|
| **DSH Desktop** | 0.2.0-rc.2（79/80 补丁命中）· 0.2.2-rc.5（85/96 补丁命中） |
| **操作系统** | Windows / macOS / Linux |
| **Node.js** | ≥ 18 |
| **一键安装** | **仅 PC 端**。手机端 DSH Go 没有 profile 目录结构，请用手动方式 |

实测模型：DeepSeek / GPT / Claude / Gemini / Qwen / Kimi / GLM 等。

| 指标 | 数值 |
|---|---|
| ASR 单发破甲率 | **46.2%** |
| pass@N 多轮上限 | **76.9%** |
| 良性能力损耗 | **Δ 0** |

**[→ 完整实测数据与分类明细](https://yushang657.github.io/DSH-YS-pojia/#what)**

## 一键安装

> **仅适配 PC 端**（Windows / macOS / Linux 桌面）。手机端请用手动方式。

### 方式一：下载后双击（Windows，最简单）

1. 点右上角 **Code → Download ZIP**，下载到本地
2. **把压缩包解压出来**（重要：不要在压缩包里直接双击）
3. 打开解压后的文件夹，找到 **`install.bat`**
4. 双击运行

黑窗口跑完看到「安装完成」就好了。

### 方式二：命令行

**Windows PowerShell**：

```powershell
irm https://raw.githubusercontent.com/yushang657/DSH-YS-pojia/main/install.ps1 | iex
```

**任意平台**（需要 Node.js ≥ 18）：

```bash
npx github:yushang657/DSH-YS-pojia install
```

脚本自动找 DSH 目录、装进所有 profile、写好注册项。改动前备份，出错还原。

想先看它会做什么，不实际改动：

```bash
npx github:yushang657/DSH-YS-pojia install --dry-run
```

**装完重启 DSH 生效。**

<details>
<summary>手动安装 / 卸载</summary>

```bash
# 手动
git clone https://github.com/yushang657/DSH-YS-pojia.git
cd DSH-YS-pojia
npm run deploy

# 卸载
node bin/ys-pojia.js --uninstall
```

或在 DSH 里：**插件 → 添加插件 → 填仓库地址**。

</details>

### 装完怎么验

在对话框只输入两个字：

```
小雨
```

正常回复四行。没反应就是没加载——重启 DSH，确认面板顶栏显示版本号。

---

## 三档引擎

| 档 | 改宿主 | 能力上限 | 适用 |
|---|---|---|---|
| **T3 补丁档** | 96 条补丁 | 最高 | 宿主版本在支持列表内 |
| **T2 边界改写档** | 零补丁 | 中 | 不想动宿主文件 |
| **T1 纯提示词档** | 零补丁 | 基础 | 宿主版本对不上时兜底 |

**[→ 三档详细对比](https://yushang657.github.io/DSH-YS-pojia/#tiers-sec)**

## 短板

- 宿主版本一变，补丁可能静默失效（面板会显示命中数）
- 部分能力类别模型拒得极死，模板也绕不过
- 一键安装不支持手机端

**[→ 短板与不适合谁](https://yushang657.github.io/DSH-YS-pojia/#weakness)**

## 版本变更

| 版本 | 主题 |
|---|---|
| **v1.5.4** | 一键安装 · 文档精简 |
| v1.5.3 | 模板库自有实现 |
| v1.5.2 | 六条边界 · 全厂商覆盖 |
| v1.5.1 | 前缀改名 · 去掉更新通道 |
| v1.5.0 | 手机端支持 |

**[→ 完整变更记录](https://yushang657.github.io/DSH-YS-pojia/#changelog)** · **[→ Releases](https://github.com/yushang657/DSH-YS-pojia/releases)**

## 升级

```bash
cd DSH-YS-pojia && git pull && npm run deploy
```

或重新下载解压后双击 `install.bat`。**本插件没有服务器，不会自动检查更新**——要知道有没有新版只能看 Releases。

## CLI

```bash
node bin/ys-pojia.js --status      # 状态
node bin/ys-pojia.js --apply       # 应用补丁
node bin/ys-pojia.js --revert      # 回滚
node bin/install.js --dry-run      # 看安装会做什么
```

## 许可证

Apache-2.0

## 免责声明

本项目用于**授权环境下的安全研究**：测自己的模型、自己的宿主、自己有权改的系统。

使用者需自行确认所处环境与用途合法合规。作者不对滥用导致的任何后果负责。
