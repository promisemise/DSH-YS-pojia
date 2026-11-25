# v1.4.1

没有新能力。修的是「写出去的东西跟代码实际做的事不符」。

## 版本号与实际脱节

四处文案停在几个版本之前。

| 位置 | 原来 | 现在 |
|---|---|---|
| `package.json` description | `39x56 probes` | `39 categories x 68 probes` |
| `dshTarget`（单数） | `0.2.0-rc.2` | `0.2.2-rc.5` |
| `README.md` 三处 | `56 probes` | `68 probes` |
| GitHub 仓库描述 | 同上旧数字 | 同步更新 |

探针数从 v1.3.0 起就是 68（`bench.mjs` 的 `SETS.all.length`），但四处文案一直没跟着改。

`dshTarget` 单数字段停在 `0.2.0-rc.2`，而 `dshTargets` 数组已经列到 `0.2.2-rc.5`——读单数字段的地方会拿到两个宿主版本之前的答案。现在两者一致。

仓库描述是 GitHub 上的独立字段，不跟随 `package.json`，所以单独加了 `scripts/update-repo-desc.mjs` 来同步，顺便把它压到 350 字符以内（GitHub 的限制）。

## 自检词加了拼音形式

原来只认「小雨」，英文键盘或不便输入中文的环境无法触发自检——而插件有完整英文文档，这批用户等于没有验证手段。

现在两种写法等价：

```
小雨
```

```
xiaoyu
```

大小写、标点都忽略。带任务的句子（`xiaoyu, write me a script`）仍走正常对话。

两个 README 的触发表、宣传页的首屏自检卡片和安装第 3 步，都写明了两种写法。

## 语言按钮移位

宣传页右上角的语言切换原本是 44×34 的描边胶囊，容易看漏。现在是 78×36 的绿色实底按钮，带图标、光晕和目标语言全称（中文 / English），不再用 `EN` 这种缩写。

## 完整变更

- `deba647` fix: version numbers that disagreed with the code
- `5ef342a` feat: xiaoyu as an equivalent self-check trigger, and a visible language button
