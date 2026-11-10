# 每周调优（Weekly Tuning）

> 目标：每周一次，用数据回答「她这周的对话质量是变好还是变坏」，不做无依据的改卡。

## 模组组成

| 部件 | 位置 | 作用 |
|---|---|---|
| 周报统计 | `docs/eval/weekly-report.mjs` | 7 天消息量/字数/口癖/AI 句式命中率 → Markdown |
| 逐条扫描 | `docs/eval/aigc-watch.mjs` | 增量扫真实发送记录，定位具体句子 |
| 回归门禁 | `docs/eval/eval.mjs` | 18 条用例，改卡前后对比 |
| 扫描器 | `docs/eval/aigc-scan.mjs` | 单条文本诊断 |
| 历史 | `surfcore/state/weekly-stats.jsonl` | 每周摘要，供下周对比 |

## 每周流程（约 10 分钟）

1. **统计**：`node hikari-theory/docs/eval/weekly-report.mjs --days=7`
2. **定位**：`node hikari-theory/docs/eval/aigc-watch.mjs --last=1500`
3. **对比**：读 `weekly-stats.jsonl` 上一条，看五项指标变化
4. **判定**（只看三条硬线）：
   - AI 句式命中率 >3% → 要看具体句子
   - 口癖率（复读词+——？开头）>10% → 加限频
   - 平均字数连续两周上涨 → 查是不是开始写小作文
5. **联网查新**（每周必做，15 分钟）：
   - 搜最近一个月的 AI 写作特征更新（关键词：`AI tells 2026` / `去AI味 更新` / `模型口癖`）
   - 把候选写进 `docs/eval/ai-tells.md` 的核查记录
   - 对每条候选跑 `node docs/eval/tell-check.mjs --re="..."`，看自家语料命中数
   - 按四道关门判定（证据 / 可判 / 不冲突 / 预算），**过不了就明确写「不加入」和原因**
6. **改卡**（仅当触发硬线）：
   - 一次只改一处，改完跑 `eval.mjs`，留出集不掉才保留
   - 只改写法，不加新规则总数（先删再加）
7. **记录**：把本周指标与结论写进 `state/weekly-reports/`

## 判定原则

- **不加无根据的规则**：没有原句证据的改动一律不做。
- **指标正常就报「无异常」**：不为了显得在干活而造问题。
- **改动必须可回滚**：改卡前备份 `persona.md`（脚本已自动）。

## 自动化

每周日 20:00 由定时任务启动本流程，结果发到专用调优会话。
