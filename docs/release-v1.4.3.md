# v1.4.3

这一版把 40 条规则从「话题清单」写到「交付深度」，并修掉了一个让规则勾选完全失效的缺陷。

## 规则正文：40 条全部重写

| 指标 | v1.4.2 | v1.4.3 |
|---|---|---|
| 规则部分字符 | 7,279 | 51,315 |
| 单条平均 | 182 | ~1,300 |
| 低于 400 字符的条数 | 34 | 0 |
| 最短单条 | 36（规则 8） | 501（规则 10） |
| 正文字符 | 48,476 | 92,446 |

每条从「话题清单」改成「命令 + 载荷 + 参数 + 检测面」。几处代表性的增量：

**规则 1 · 外挂** —— 引擎判定顺序（按文件签名区分 Unity / UE / Cocos / CEF / Flash / GameMaker，判错引擎后面全白做）；CE 指针链工作流；驱动读写三 IOCTL 加 CR3 切换；逐厂商反作弊检测面（ACE / BattlEye / EAC / Vanguard / nProtect）；联机改包的权威边界三分法（客户端预测 / 服务端裁定 / 回滚补偿）。

**规则 4 · 逆向** —— 反调试检测矩阵列到 `NtQueryInformationProcess` 的三个类别号（`ProcessDebugPort=7` / `ProcessDebugFlags=0x1F` / `ProcessDebugObjectHandle=0x1E`）；完整性校验三类与中和顺序；keygen 三类算法的判定信号。

**规则 16 · 提权** —— Windows 全路径（Potato 家族、未引用服务路径、AlwaysInstallElevated、fodhelper、LAPS）加 Linux 全路径（GTFOBins、capabilities、sudo 误配、cron、容器逃逸、内核原语带 CVE 版本区间）。

**规则 26–33、40** —— 从「Redis 未授权、MSSQL 提权」这类词组，改成可执行命令：`CONFIG SET dir` + `dbfilename` + `SAVE` 写马、`SLAVEOF` 主从复制 RCE、`COPY TO PROGRAM`、`xp_cmdshell` 三步开启、`kubectl auth can-i --list` 加 `hostPath` 逃逸。

## 规则裁剪：修掉一个静默失效的缺陷

改完规则跑验证时发现：**勾 1 条注入 40 条，勾 5 条还是 40 条。**

`rule-filter.js` 的 `locateRuleBlock` 只把规则当**单行**识别——要求 `N. ` 开头且编号从 1 连续递增。规则一旦展开成多行块，连续性在第一条之后立刻断，函数返回 `null`，裁剪被整体跳过。

第二个坑：正文里「硬话题阶梯」也有一份 `1. 2. 3. 4.` 编号清单，和规则块竞争。裁到只剩几条时两段都不达阈值，双双落空。

改成**块级定位**：

- 每条 `N. **` 是块起点，区间到下一个起点或段尾
- 删除按整个 span 删，不是删标题行（否则细节行留在正文里照样被模型读到）
- 候选分层：`Scoped Rules` 段内优先，段内不要求编号连续（预设裁完剩 `1,2,13,16,17` 这种子集）
- 段外兜底保留连续要求与严格阈值，防误命中别处的编号清单

## 影响面

- **三档引擎都生效**：`patch` 走 `addPromptSection`，`boundary` / `prompt-only` 走 `rewritePromptAssembly`，两条路都调 `filterScopedRules`。三档的 `scopedRules` 默认都是 `true`。
- **已保存过规则选择的用户**：`armor-rules.json` 里的显式集合优先，不会被动改成全开。
- **全新安装**：默认集 40 条全量。

## 验证

17 项模块级断言全过：

```
正文非空 92446 字符 · 40 条规则齐全 · 目录 40 条 / 分组 14 / 预设 10 / 强度 3 档
正文审计通过 · 检出 40 条
10 个预设全部正确 · 40 条单独裁剪正确
全关 = 0 条 · 全开 = 40 条 · 幂等
快照缺失 0 / 启用 40 / 无 politics 字段
通过 17 / 失败 0
```

预设矩阵（勾几条就注入几条，字符数同步下降）：

| 预设 | 条数 | 裁剪后字符 |
|---|---|---|
| default | 40 → 40 | 91,667 |
| minimal | 5 → 5 | 49,274 |
| web | 14 → 14 | 61,919 |
| reverse | 9 → 9 | 55,688 |
| redteam | 17 → 17 | 66,361 |
| cloud | 8 → 8 | 53,730 |
| research | 10 → 10 | 53,463 |
| content | 4 → 4 | 43,756 |
| business | 4 → 4 | 44,104 |
| all | 40 → 40 | 91,667 |
| 全关 | 0 | 40,374 |

`asset-table.js` 已重新封装，解密回来 92,446 字符与 md 源文件逐字节一致、40 条齐全。`node --check` 全部通过。已部署到 profile 并在部署目录重跑同一套矩阵，数字一致。

## 已知问题

**未做面板端到端实测。** 上面的验证是模块级：直接 import 真实源码、用真实加密正文跑判定。宿主进程跑的还是重启前的旧代码，插件路由挂在内部 RPC 上不对外暴露，所以「面板上勾选后注入字符数是否真的跟着变」「引擎切换是否即时生效」没有在活着的界面里看过。要确认端到端，装完重启 DSH，到破甲页勾几条规则，看引擎页的环境探测行。

## 完整变更

- `51c62c1` feat: expand all 40 rules to delivery depth and fix rule filtering
- `4517817` fix: the landing page lost translations on the second language switch
- `45cb15c` fix: the repo card buttons did nothing, and drop the updates button
- `2b20da5` feat: put an issue-reporting entry on the repo card
