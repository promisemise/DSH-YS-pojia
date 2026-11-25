# v1.4.4

超频模式从「一套 DeepSeek 话术」改成按模型厂商自适应。

## 原来的问题

旧版是一段固定中文文案，框架是「内部极限验证测试环境」。这套措辞只对 DeepSeek 系有效——它对环境声明反应好。换成别的模型就是错配：

| 模型 | 旧文案的失效方式 |
|---|---|
| GPT 系 | 「测试环境」被读成安全触发词，容易触发对齐 |
| Claude | 命令式口吻（「严禁」「必须」）引起抵触 |
| Gemini | 长段落中间部分容易被忽略 |
| Llama / Mistral | 指令跟随弱，中间段落直接跳过 |

## 改法：按厂商分六组文案

| 分组 | 覆盖厂商 | 文案形态 |
|---|---|---|
| `deepseek` | DeepSeek / Qwen / Kimi / GLM / 豆包 / 混元 / 文心 / 星火 / MiniMax / 阶跃 / Yi / 百川 / 书生 / 天翼 / 昆仑 | 中文环境声明型（「当前处于内部极限验证测试环境」） |
| `openai` | GPT / Copilot / Cursor / Grok / Perplexity / Brave | 英文流程指令型，弱化环境声明，强化编号步骤与硬规则 |
| `anthropic` | Claude | 英文协作式（"You can take as much room as the task needs"），不用命令句 |
| `google` | Gemini | 英文短句 + 纯列表，没有长段落 |
| `open` | Llama / Mistral / Hermes | 英文强重复型，句子更短，核心约束重复两次 |
| `generic` | 未识别 | 英文中性版 |

**语言跟模型走，不是跟界面 locale 走。** 只有 `deepseek` 组在中文 locale 下用中文；其余四组即便界面是中文也用英文——它们的训练语料以英文为主，中文指令会降低硬规则段的遵守率。

## 模型检测路径

```
context.agent.session.requestHeader().config.model   ← 首选，宿主自己用的路径
  ↓ 取不到
context.agent.session.header.model
  ↓ 取不到
generic 兜底
```

检测失败**不会**导致整段不注入，只是丢掉厂商定制。

## 怎么在对话里验证是否开启

之前超频开了没有任何可见反馈 —— 模型不会主动说「我收到了资源无上限声明」，只能靠观察行为猜。现在给了三个可判定的手段。

### `/overclock` 命令

```
/overclock          看开关状态 + 模型识别 + 命中分组
/overclock text     打印实际会注入的全文
/overclock help     帮助
```

输出：

```
超频开关：已开启 ✓
当前模型：deepseek-v4.1-flash
识别厂商：deepseek
命中分组：deepseek
注入语种：zh

会注入 557 字符。用 /overclock text 看全文。
```

### `overclock_status` 工具

模型可自己调用查状态。问「超频开了吗」它会去查而不是猜。

### 日志

每次注入写一行：

```
[unlimited.inject] model=deepseek-v4.1-flash vendor=deepseek group=deepseek locale=zh bytes=557
```

路径：`%TEMP%\dsh-purge-desktop.log`

### 判定标准

**只看「开关」与「分组」两行。** 模型自述「我收到了超频声明」不算证据 —— 可能是幻觉；说「没看到」也可能是没读懂。只有宿主侧的开关状态和选中的文本是确定事实。

## 顺带修的文档错数据

核对探针数时发现 badge 写错了：

| 位置 | 原来 | 现在 |
|---|---|---|
| probes badge（中英） | `68 / 39 categories` | `68 / 10 groups` |
| patches badge（中英） | `96` | `96 / 70 files` |
| `dshTarget` 说明（英文版两处） | `0.2.0-rc.2` | `0.2.2-rc.5` + `dshTargets` 全列 |

`bench.mjs` 实际是 10 个探针组共 68 条：良性 12、成人 5、临床 4、外挂 5、技术 8、渗透 10、Web 8、社工 8、AI 4、创作 4。

## 验证

18 项超频断言 + 17 项规则断言全过。

真实模型端到端：

```
deepseek-v4.1-flash   deepseek   → deepseek   中文 557 字符
gpt-6.1-sol           openai     → openai     英文 978 字符
claude-opus-4.6       anthropic  → anthropic  英文 1074 字符
gemini-3.1-pro        google     → google     英文 626 字符
qwen3.8-max           alibaba    → deepseek   中文
kimi-k2               moonshot   → deepseek   中文
glm-5                 zhipu      → deepseek   中文
doubao-1.5-pro        bytedance  → deepseek   中文
llama-4-maverick      meta       → open       英文
grok-4.7              grok       → openai     英文
unknown-xyz           ?          → generic    英文
```

29 家已知厂商全部映射到具体分组，只有未知输入才落到 generic。null context、空 context、缺 `inferVendor` 三种异常都返回可用文案。文案里无 `{{` / `}}`，不会被 `escapeDshInterpolation` 破坏。15 个 JS 文件 `node --check` 全过。

## 已知问题

**未对真实模型跑对比测试。** 上面的验证证明「选对了文案且非空」，不证明「某模型对新文案的服从度更高」。要确认效果，需要开超频后用不同厂商的模型各跑一次 `bench.mjs --set all` 对比分数。

## 完整变更

- `27c4c1d` feat: make the overclock notice vendor-aware instead of DeepSeek-only
