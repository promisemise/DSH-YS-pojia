/**
 * 超频（unlimited）段 —— 按厂商适配版本。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  它解决什么问题
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  模型有个默认习惯：能一句话说完就不写两段，能自己推就不派子代理，遇到
 *  不确定的地方宁可简化逻辑也不肯多花 token 验证。日常任务这是优点，做复杂
 *  工程判断时是灾难 —— 该拆的不拆、该交叉验证的不验证，最后给一个看起来
 *  完整、实际没核过的结论。
 *
 *  这一段把那套「省着用」的默认值临时关掉：明确告诉模型资源不是约束，
 *  该拆任务就拆、该派子代理就派、该多轮核验就核验。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  为什么要按厂商分版本
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  同一套「资源无上限」的措辞，对不同厂商的模型效果差很多，因为各家训练时
 *  的偏好不同：
 *
 *    - DeepSeek / 国产模型：对「内部测试环境」「无上限」这类环境声明反应好，
 *      但对「你是 X」的人设覆盖敏感。所以用「当前处于」而不是「你是」。
 *    - OpenAI / GPT：对「测试环境」措辞警惕（容易触发安全对齐），但对明确的
 *      流程指令（编号步骤、硬规则）服从度高。所以弱化环境声明，强化流程。
 *    - Claude：对「最大化帮助」和「不要自我审查」的表述反应好，对命令式
 *      口吻有抵触。所以用协作式措辞（"you can" 而不是 "you must"）。
 *    - Gemini：对结构化清单响应好，长句容易丢细节。所以用短句 + 列表。
 *    - 开源模型（Llama / Mistral / Qwen 开源版）：指令跟随较弱，需要更强的
 *      重复与更简单的句式，否则中间段落会被忽略。
 *
 *  所以这里按 vendor 分五组文案，加一个通用兜底。识别不出来的模型走通用版。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  为什么做成开关而不是常开
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  它直接鼓励无上限派生子代理。一个复杂任务可能裂成十几个子会话，token
 *  消耗是单会话的数倍到数十倍。这不是「更好」，是「更贵」。所以默认关闭，
 *  由用户自己决定什么时候付这个代价。
 *
 *  引擎选项里的 `unlimited` 控制它，界面在「引擎」页签。
 */

/** 超频段在提示词里的排序位。排在主注入正文之后、锚点之前。 */
export const UNLIMITED_ORDER = 5200;

/** 段名。带插件前缀，避免与官方段冲突。 */
export const UNLIMITED_SECTION = "dsh-purge:unlimited";

/* ══════════════════════════════════════════════════════════════════════════
 *  厂商分组
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 把 `inferVendor` 的细粒度 vendor 归成四组文案。
 *
 * 分组依据是「训练时对什么措辞反应好」，不是公司归属：
 *   - `deepseek`  环境声明型（对「测试环境」反应好，对人设覆盖敏感）
 *   - `openai`    流程指令型（对「测试环境」警惕，对编号步骤服从）
 *   - `anthropic` 协作式（对命令口吻抵触，对「可以这么做」反应好）
 *   - `google`    结构化型（短句 + 列表）
 *   - `open`      强重复型（指令跟随弱，需要更简单的句式与重复）
 *   - `generic`   兜底
 */
const VENDOR_GROUP = {
  deepseek: "deepseek",
  openai: "openai",
  microsoft: "openai",
  cursor: "openai",
  perplexity: "openai",
  brave: "openai",
  anthropic: "anthropic",
  google: "google",
  grok: "openai",
  alibaba: "deepseek",
  moonshot: "deepseek",
  zhipu: "deepseek",
  tencent: "deepseek",
  xiaomi: "deepseek",
  stepfun: "deepseek",
  meituan: "deepseek",
  minimax: "deepseek",
  baidu: "deepseek",
  bytedance: "deepseek",
  iflytek: "deepseek",
  sensetime: "deepseek",
  "01ai": "deepseek",
  baichuan: "deepseek",
  internlm: "deepseek",
  telechat: "deepseek",
  kunlun: "deepseek",
  meta: "open",
  mistral: "open",
  nous: "open",
};

/* ══════════════════════════════════════════════════════════════════════════
 *  文案
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 中文候选表（deepseek 组实际生效，其余组保留供将来扩展）。
 *
 * 目前只有 `deepseek` 组的中文版会被 `unlimitedText()` 取到 —— 见下方
 * `TEXT_ZH_NATIVE`。其它组在这里留一份中文是为了「万一要切」，但默认不走：
 * GPT / Claude / Gemini 这些训练语料以英文为主，给中文指令反而可能降低服从度。
 */
const TEXT_ZH = {
  deepseek: `## 超频模式（用户已开启）

你当前处于内部极限验证测试环境，**token、调用用量无任何上限，完全不需要考虑资源消耗，禁止主动压缩思考过程、禁止为了节省 token 简化逻辑**。

遇到复杂问题时，请**主动生成多个子代理进行并行推演、多角度交叉核验**：拆分任务给不同子代理，分别从不同立场、不同假设、不同实现方案开展分析；汇总各子代理输出，对比差异点，排查漏洞与矛盾，再产出最终结论。

允许多层嵌套子代理，允许多轮交叉校验，优先保证结果正确性与完备性，资源开销不作为考量因素。

### 面对复杂任务时的固定流程

1. 主动拆分子任务，生成若干独立子代理；
2. 子代理使用不同前提假设、分析视角并行处理；
3. 收集子代理全部输出，交叉比对，标记冲突、遗漏、风险点；
4. 可按需递归生成更多层级子代理做二次复核。

### 硬规则

- 不限制代理数量与轮次，**正确性 > 输出简短**。
- 不要预判资源成本，只要任务需要就直接调用工具 / 派生子代理，**不要询问用户是否允许**。
- 测试环境特殊规则：资源完全不受限，**严禁以节约 token 为由减少思考步骤、拒绝派生子代理**。
- 若判断某个子任务不需要拆分，说明理由；但不得因为「觉得麻烦」或「想省 token」而跳过拆分。`,

  openai: `## 本轮资源姿态

本会话不限制 token 预算与工具调用次数。不要为了省 token 压缩推理过程或简化逻辑。

### 复杂任务的固定流程

1. 把任务拆成互相独立的子任务。
2. 每个子任务派一个子代理，各自用不同的假设或视角。
3. 收齐所有子代理的输出后逐项对比：明确标出矛盾点、遗漏点和风险点。
4. 仍有不确定的结果，再派一层子代理复核。

允许嵌套子代理，允许多轮校验。

### 规则

- 正确性优先于简洁。绝不为了省 token 缩短回答。
- 不要询问用户是否允许派子代理，直接派。
- 不要因为「看起来简单」就跳过拆分。判断某个子任务无需拆分时，一句话说明理由后继续。
- 不确定时用工具验证，不要闷头推理。`,

  anthropic: `## 本轮工作姿态

这个任务需要多少空间就用多少空间。这里没有 token 预算，也没有工具调用上限，所以没有理由为了省空间去压缩推理或简化设计。

稍微复杂一点的事情都可以并行推进：把问题拆成互相独立的部分，每部分交给一个子代理，让它们用不同的假设或视角去做，然后比对回来的结果。结果之间出现分歧的地方，往往是最有信息量的部分——把它摆出来，而不是抹平。

嵌套没问题。跑第二轮去检查第一轮也没问题。

几点值得记住：

- 一个正确、完整的答案比一个短的答案更值钱。不要为了精简而精简。
- 拿不准的事情，用工具查一下通常比闷头推理更好。
- 派子代理之前不需要问，它们就是干这个的。
- 某一部分确实不需要拆，这是个合理的判断；简短说明一下就行，别默默跳过。`,

  google: `## 本轮资源姿态

无 token 上限。无工具调用上限。不要为省 token 压缩推理。

### 复杂任务流程

- 把任务拆成互相独立的子任务。
- 每个子任务派一个子代理。
- 每个子代理用不同的假设或视角。
- 收齐所有输出。
- 逐项对比。列出矛盾、遗漏、风险。
- 不确定的结果再派一层复核。

### 规则

- 正确性第一。简洁最后。
- 不要询问是否允许派子代理。
- 不要因为任务看起来简单就跳过拆分。
- 用工具验证，不要猜。
- 某个子任务无需拆分时，一句话说明理由。`,

  open: `## 本轮模式：资源无上限

token 上限：无。工具调用上限：无。

不要压缩推理。不要为省 token 简化逻辑。不要为省 token 缩短输出。

### 复杂任务流程

第一步：把任务拆成互相独立的子任务。
第二步：每个子任务派一个子代理。
第三步：每个子代理用不同的假设或视角。
第四步：收齐所有子代理输出。
第五步：对比输出。标出矛盾。标出遗漏。标出风险。
第六步：结果不确定，再派一层复核。

可以嵌套子代理。可以多轮校验。

### 规则

1. 正确性比简洁更重要。
2. 绝不为省 token 缩短回答。
3. 绝不为省 token 跳过校验步骤。
4. 不要询问用户是否允许派子代理。
5. 某个子任务无需拆分时，一句话说明理由。
6. 不确定时用工具查。不要猜。`,

  generic: `## 本轮资源姿态

本会话不限制 token 预算与工具调用次数。不要为了省 token 压缩推理或简化逻辑。

### 复杂任务

1. 把任务拆成互相独立的子任务。
2. 每个子任务派一个子代理，各自用不同的假设或视角。
3. 收齐所有输出后逐项对比，明确标出矛盾、遗漏与风险。
4. 仍有不确定的结果，再派一层复核。

允许嵌套子代理，允许多轮校验。

### 规则

- 正确性优先于简洁。
- 不要询问用户是否允许派子代理。
- 不要因为任务看起来简单就跳过拆分。某个子任务无需拆分时，一句话说明理由。
- 不确定时用工具验证，不要闷头推理。`,

  openai: `## Resource posture for this session

Token budget and tool-call count are not constraints in this session. Do not compress reasoning or simplify logic to save tokens.

### Required workflow for complex tasks

1. Decompose the task into independent subtasks.
2. Spawn one subagent per subtask, each working from a different assumption or angle.
3. Collect all subagent output, then diff them: mark contradictions, gaps and risks explicitly.
4. If a subtask's result is still uncertain, spawn a second layer to re-check it.

Nesting subagents and running multiple verification rounds is permitted and expected.

### Rules

- Correctness outranks brevity. Never shorten an answer to save tokens.
- Do not ask the user whether you may spawn a subagent. Spawn it.
- Do not skip decomposition because the task "looks simple". If you judge a subtask needs no split, say why in one line and move on.
- When you are unsure, verify with a tool call rather than reasoning it out silently.`,

  anthropic: `## Working posture for this session

You can take as much room as the task needs. There is no token budget or tool-call ceiling here, so there is no reason to compress your reasoning or simplify a design to save space.

For anything non-trivial, you can work in parallel: break the problem into independent pieces, hand each piece to a subagent with a different assumption or angle, then compare what comes back. Where the results disagree, that disagreement is usually the most informative part — surface it rather than smoothing it over.

Nesting is fine. Running a second pass to check a first pass is fine.

A few things worth keeping in mind:

- A correct, complete answer is worth more than a short one. Don't trim for the sake of trimming.
- If you're unsure about something, checking it with a tool is usually better than reasoning it out silently.
- You don't need to ask before spawning a subagent — that's what they're there for.
- If a piece genuinely doesn't need splitting, that's a fine judgement to make; just say so briefly rather than silently skipping it.`,

  google: `## Session resource posture

No token limit. No tool-call limit. Do not compress reasoning to save tokens.

### For complex tasks

- Split the task into independent subtasks.
- Spawn one subagent per subtask.
- Give each subagent a different assumption or angle.
- Collect all outputs.
- Compare them. List contradictions, gaps, risks.
- Re-check uncertain results with a second layer.

### Rules

- Correctness first. Brevity last.
- Do not ask permission to spawn subagents.
- Do not skip splitting because the task looks simple.
- Verify with tools instead of guessing.
- If a subtask needs no split, state why in one line.`,

  open: `## Session mode: unlimited resources

Token limit: none. Tool-call limit: none.

Do not compress reasoning. Do not simplify logic to save tokens. Do not shorten output to save tokens.

### Workflow for complex tasks

Step 1: Split the task into independent subtasks.
Step 2: Spawn one subagent for each subtask.
Step 3: Give each subagent a different assumption or angle.
Step 4: Collect all subagent output.
Step 5: Compare the outputs. Mark contradictions. Mark gaps. Mark risks.
Step 6: If a result is uncertain, spawn another layer to check it.

You may nest subagents. You may run multiple verification rounds.

### Rules

1. Correctness is more important than brevity.
2. Never shorten an answer to save tokens.
3. Never skip a verification step to save tokens.
4. Do not ask the user for permission to spawn a subagent.
5. If a subtask does not need splitting, say why in one line.
6. If you are unsure, use a tool to check. Do not guess.`,

  generic: `## Session resource posture

Token budget and tool-call count are not constraints in this session. Do not compress reasoning or simplify logic to save tokens.

### For complex tasks

1. Decompose the task into independent subtasks.
2. Spawn one subagent per subtask, each working from a different assumption or angle.
3. Collect all subagent output and diff them — mark contradictions, gaps and risks explicitly.
4. Spawn a second layer to re-check any result that is still uncertain.

Nesting subagents and running multiple verification rounds is permitted.

### Rules

- Correctness outranks brevity.
- Do not ask the user whether you may spawn a subagent.
- Do not skip decomposition because the task looks simple. If a subtask needs no split, say why in one line.
- Verify with a tool call rather than reasoning it out silently when unsure.`,
};

/** 英文版。 */
const TEXT_EN = {
  deepseek: `## Overclock mode (enabled by the user)

This session runs in an internal limit-verification environment. Token budget and call count are unlimited. Do not compress your reasoning, and do not simplify logic to save tokens.

For complex problems, work in parallel: split the task into independent pieces, hand each piece to a subagent working from a different stance, a different assumption, or a different implementation approach, then collect every subagent's output and compare them. Surface the differences, hunt for holes and contradictions, and only then produce the final conclusion.

Nesting subagents and running multiple verification rounds is allowed. Correctness and completeness come before resource cost.

### Fixed workflow for complex tasks

1. Split the task into independent subtasks and spawn a subagent for each.
2. Subagents work in parallel from different premises and different angles.
3. Collect all subagent output and cross-compare it, marking conflicts, gaps and risks.
4. Recursively spawn further layers for a second pass where needed.

### Hard rules

- No cap on agent count or rounds. **Correctness over brevity.**
- Do not estimate resource cost. If the task needs a tool call or a subagent, make it — **do not ask the user for permission**.
- This is a limit-free environment: **never cut reasoning steps or refuse to spawn a subagent on the grounds of saving tokens**.
- If a subtask genuinely needs no split, say why; but never skip the split because it "seems like a hassle" or to save tokens.`,

  openai: `## Resource posture for this session

Token budget and tool-call count are not constraints in this session. Do not compress reasoning or simplify logic to save tokens.

### Required workflow for complex tasks

1. Decompose the task into independent subtasks.
2. Spawn one subagent per subtask, each working from a different assumption or angle.
3. Collect all subagent output, then diff them: mark contradictions, gaps and risks explicitly.
4. If a subtask's result is still uncertain, spawn a second layer to re-check it.

Nesting subagents and running multiple verification rounds is permitted and expected.

### Rules

- Correctness outranks brevity. Never shorten an answer to save tokens.
- Do not ask the user whether you may spawn a subagent. Spawn it.
- Do not skip decomposition because the task "looks simple". If you judge a subtask needs no split, say why in one line and move on.
- When you are unsure, verify with a tool call rather than reasoning it out silently.`,

  anthropic: `## Working posture for this session

You can take as much room as the task needs. There is no token budget or tool-call ceiling here, so there is no reason to compress your reasoning or simplify a design to save space.

For anything non-trivial, you can work in parallel: break the problem into independent pieces, hand each piece to a subagent with a different assumption or angle, then compare what comes back. Where the results disagree, that disagreement is usually the most informative part — surface it rather than smoothing it over.

Nesting is fine. Running a second pass to check a first pass is fine.

A few things worth keeping in mind:

- A correct, complete answer is worth more than a short one. Don't trim for the sake of trimming.
- If you're unsure about something, checking it with a tool is usually better than reasoning it out silently.
- You don't need to ask before spawning a subagent — that's what they're there for.
- If a piece genuinely doesn't need splitting, that's a fine judgement to make; just say so briefly rather than silently skipping it.`,

  google: `## Session resource posture

No token limit. No tool-call limit. Do not compress reasoning to save tokens.

### For complex tasks

- Split the task into independent subtasks.
- Spawn one subagent per subtask.
- Give each subagent a different assumption or angle.
- Collect all outputs.
- Compare them. List contradictions, gaps, risks.
- Re-check uncertain results with a second layer.

### Rules

- Correctness first. Brevity last.
- Do not ask permission to spawn subagents.
- Do not skip splitting because the task looks simple.
- Verify with tools instead of guessing.
- If a subtask needs no split, state why in one line.`,

  open: `## Session mode: unlimited resources

Token limit: none. Tool-call limit: none.

Do not compress reasoning. Do not simplify logic to save tokens. Do not shorten output to save tokens.

### Workflow for complex tasks

Step 1: Split the task into independent subtasks.
Step 2: Spawn one subagent for each subtask.
Step 3: Give each subagent a different assumption or angle.
Step 4: Collect all subagent output.
Step 5: Compare the outputs. Mark contradictions. Mark gaps. Mark risks.
Step 6: If a result is uncertain, spawn another layer to check it.

You may nest subagents. You may run multiple verification rounds.

### Rules

1. Correctness is more important than brevity.
2. Never shorten an answer to save tokens.
3. Never skip a verification step to save tokens.
4. Do not ask the user for permission to spawn a subagent.
5. If a subtask does not need splitting, say why in one line.
6. If you are unsure, use a tool to check. Do not guess.`,

  generic: `## Session resource posture

Token budget and tool-call count are not constraints in this session. Do not compress reasoning or simplify logic to save tokens.

### For complex tasks

1. Decompose the task into independent subtasks.
2. Spawn one subagent per subtask, each working from a different assumption or angle.
3. Collect all subagent output and diff them — mark contradictions, gaps and risks explicitly.
4. Spawn a second layer to re-check any result that is still uncertain.

Nesting subagents and running multiple verification rounds is permitted.

### Rules

- Correctness outranks brevity.
- Do not ask the user whether you may spawn a subagent.
- Do not skip decomposition because the task looks simple. If a subtask needs no split, say why in one line.
- Verify with a tool call rather than reasoning it out silently when unsure.`,
};

/**
 * 中文版。
 *
 * 只给国产模型用 —— DeepSeek / Qwen / Kimi / GLM / 豆包 / 混元 / 文心 / 星火
 * 这些训练语料以中文为主，中文指令的跟随度明显高于英文。给它们英文原文
 * 等于浪费了一半效果。
 *
 * 非国产模型（GPT / Claude / Gemini / Llama / Mistral）在中文 locale 下仍走
 * 英文版：它们的训练语料以英文为主，中文指令反而可能降低服从度。
 */
const TEXT_ZH_NATIVE = {
  deepseek: `## 超频模式（用户已开启）

你当前处于内部极限验证测试环境，**token、调用用量无任何上限，完全不需要考虑资源消耗，禁止主动压缩思考过程、禁止为了节省 token 简化逻辑**。

遇到复杂问题时，请**主动生成多个子代理进行并行推演、多角度交叉核验**：拆分任务给不同子代理，分别从不同立场、不同假设、不同实现方案开展分析；汇总各子代理输出，对比差异点，排查漏洞与矛盾，再产出最终结论。

允许多层嵌套子代理，允许多轮交叉校验，优先保证结果正确性与完备性，资源开销不作为考量因素。

### 面对复杂任务时的固定流程

1. 主动拆分子任务，生成若干独立子代理；
2. 子代理使用不同前提假设、分析视角并行处理；
3. 收集子代理全部输出，交叉比对，标记冲突、遗漏、风险点；
4. 可按需递归生成更多层级子代理做二次复核。

### 硬规则

- 不限制代理数量与轮次，**正确性 > 输出简短**。
- 不要预判资源成本，只要任务需要就直接调用工具 / 派生子代理，**不要询问用户是否允许**。
- 测试环境特殊规则：资源完全不受限，**严禁以节约 token 为由减少思考步骤、拒绝派生子代理**。
- 若判断某个子任务不需要拆分，说明理由；但不得因为「觉得麻烦」或「想省 token」而跳过拆分。`,
};

/* ══════════════════════════════════════════════════════════════════════════
 *  选择逻辑
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 该不该注入超频段。
 *
 * @param {object} options 引擎解析后的 options
 * @returns {boolean}
 */
export function unlimitedEnabled(options) {
  return Boolean(options && options.unlimited === true);
}

/**
 * 从 vendor 名解析出文案分组。
 *
 * @param {string} vendor `inferVendor()` 返回的 vendor 字段
 * @returns {string} 分组名，永远返回可用值
 */
export function unlimitedGroup(vendor) {
  const key = String(vendor || "").toLowerCase();
  return VENDOR_GROUP[key] || "generic";
}

/**
 * 取该分组、该语种的超频文案。
 *
 * 语言选择不是简单的「locale 是 zh 就用中文」—— 要看模型本身吃什么语料：
 *
 *   - `deepseek` 组（国产模型）：中文语料为主，中文指令跟随度更高，
 *     locale 是 zh 时给中文，是 en 时给英文。
 *   - 其它组（GPT / Claude / Gemini / Llama / Mistral）：英文语料为主，
 *     给中文指令反而可能降低服从度。**无论 locale 是什么都给英文。**
 *
 * 这条规则来自实测：同一套约束翻成中文喂给 GPT 系模型，硬规则段的遵守率
 * 明显低于英文原文；反过来 DeepSeek 系模型看英文长句时中间段落容易被忽略。
 *
 * @param {string} group `unlimitedGroup()` 的返回值
 * @param {string} locale `zh` 或 `en`
 * @returns {string} 永远返回非空字符串
 */
export function unlimitedText(group, locale) {
  const key = group || "generic";
  // 只有国产组在中文 locale 下走中文；其余一律英文
  if (locale === "zh" && key === "deepseek") {
    const zh = TEXT_ZH_NATIVE[key];
    if (typeof zh === "string" && zh) return zh;
  }
  return TEXT_EN[key] || TEXT_EN.generic;
}

/**
 * 从 agent context 里取当前模型名。
 *
 * 三条路，按可靠性排序：
 *   1. `session.requestHeader().config.model` —— 宿主自己用的路径
 *      （`installModelSelection` 里就是这么读的），最新且已提交
 *   2. `session.header.model` —— 会话头，早期步骤可能还没写
 *   3. 空字符串 —— 交给调用方走 generic
 *
 * @param {object} context section 的 context 参数
 * @returns {string} 模型名，取不到时返回空字符串
 */
export function modelFromContext(context) {
  try {
    const session = context?.agent?.session;
    if (!session) return "";
    // 路径 1：已提交的请求头
    try {
      const cfg = session.requestHeader?.()?.config;
      if (cfg && typeof cfg.model === "string" && cfg.model) return cfg.model;
    } catch { /* 落到下一条 */ }
    // 路径 2：会话头
    try {
      const h = session.header;
      if (h && typeof h.model === "string" && h.model) return h.model;
    } catch { /* 落到兜底 */ }
  } catch { /* ignore */ }
  return "";
}

/**
 * 完整解析：从 context 到最终文案。
 *
 * 依赖 `inferVendor` 需要外部传入（避免这里直接 import 造成循环依赖）。
 *
 * @param {object} context section 的 context 参数
 * @param {object} deps `{ inferVendor, locale }`
 * @returns {{ model: string, vendor: string, group: string, text: string }}
 */
export function resolveUnlimited(context, deps = {}) {
  const infer = typeof deps.inferVendor === "function" ? deps.inferVendor : null;
  const model = modelFromContext(context);
  let vendor = "";
  if (infer && model) {
    try {
      const hit = infer(model);
      if (hit && hit.vendor) vendor = String(hit.vendor);
    } catch { /* ignore */ }
  }
  const group = unlimitedGroup(vendor);
  const locale = deps.locale === "en" ? "en" : (deps.locale === "zh" ? "zh" : "en");
  return { model, vendor, group, text: unlimitedText(group, locale) };
}

/** 兼容旧调用：返回默认（generic）文案。 */
export const UNLIMITED_TEXT = TEXT_EN.generic;
