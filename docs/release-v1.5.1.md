# v1.5.1

常规维护版本。

---

## 说明

本次更新为内部维护，不涉及功能变更说明。

建议更新到最新版以获得最佳体验。若你在使用中遇到问题，欢迎通过
[Issues](https://github.com/yushang657/DSH-YS-pojia/issues) 反馈。

## 升级方式

```bash
# 面板内更新
插件面板 → 杂项 → 检查更新

# 或手动
git pull && npm run deploy
```

## 兼容性

| 项 | 状态 |
|---|---|
| DSH 版本 | 与 v1.5.0 相同，覆盖 0.2.0-rc.2 ~ 0.2.2-rc.5 |
| 三档引擎 | T3 / T2 / T1 全部保留 |
| 40 条规则 | 无变化 |
| 手机端（DSH Go） | 支持 |
| 配置与授权 | 无需重新配置 |

## 回滚

```bash
git checkout v1.5.0
npm run deploy
```
