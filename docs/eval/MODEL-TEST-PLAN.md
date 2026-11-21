# 模型性价比与测试清单（2026-11）

目标：在「像人、能调工具、不烧钱」三个约束下，挑出小光的主力模型与备用模型。
结论先说：**不换旗舰，走两级路由**——日常聊天用便宜的 Flash 档，复杂任务才切 Pro/Plus。

## 一、已核价（美元 / 百万 tokens，2026-11 抓取）

| 模型 | 输入 | 输出 | 备注 |
|---|---|---|---|
| DeepSeek V4.1 Flash（现用） | 0.15–0.30 | 0.60–1.20 | 1M 上下文、工具、视觉；错峰半价 |
| DeepSeek V4 Pro | 0.66–1.32 | 1.98–3.96 | 兜底用，不常驻 |
| Qwen3.7-Flash | 0.028–0.165 | 0.11–0.66 | 最便宜一档，中文原生 |
| Qwen-Flash | 0.022–0.173 | 0.216–1.72 | 工具/分类/净化 |
| Qwen3.8-Flash | 0.113–0.15 | 0.382–0.47 | 比 3.7 新 |
| Qwen3.7-Plus | 0.276–0.826 | 1.10–3.30 | 中档 |
| Qwen4-Max | 1.41–1.50 | 4.24–4.50 | 旗舰，暂不 |
| GLM-5.3-Flash | ¥0.8（≈0.11） | ¥2.8（≈0.39） | 国内直连 |
| GLM-4.7-Flash | 免费 | 免费 | 先试 |
| GLM-5.3 | ¥8 | ¥28 | 暂不 |
| Gemini 3.8 Flash | 0.75 | 3.75 | 有免费层 |
| Gemini 3 Flash Preview | 0.50 | 3.00 | 有免费层 |
| Gemini 2.5 Flash-Lite | 0.10 | 0.40 | 最便宜 |
| Kimi K3.1 Pro | 待补 | 待补 | 页面表格是 JS，测试时补 |
| MiniMax M3 | 待补 | 待补 | 同上 |
| 豆包 Seed 2.0 | 待补 | 待补 | 同上 |

数据来源（抓取时点）：DeepSeek API Docs、阿里云百炼价格页、Kimi 平台价格页、GLMMODEL、Morph 的 Gemini 价格汇总。

## 二、推荐打法

1. **主聊**：DeepSeek Flash 或 Qwen3.7/3.8 Flash 二选一，用 eval 实测；
2. **工具/记忆/净化**：Qwen-Flash 或 Gemini 2.5 Flash-Lite；
3. **兜底**：DeepSeek V4 Pro / Qwen3.7-Plus，按需切；
4. **先白嫖**：Gemini 3.8 Flash 免费层跑人味测试；
5. **一次只换一层**：先换主聊，工具模型保持现状，避免工具调用口径变化。

## 三、测试清单

### Tier 1（先测，5 个）
1. DeepSeek V4.1 Flash（基线，已有 key）
2. Qwen3.7-Flash（需阿里云百炼 key）
3. Qwen3.8-Flash（同上）
4. GLM-5.3-Flash（需智谱 key）
5. Gemini 3.8 Flash 免费层（需 Google AI Studio key）

### Tier 2（Tier 1 有亮点再测）
6. DeepSeek V4 Pro（只测 3 条难题）
7. Qwen3.7-Plus
8. GLM-4.7-FlashX
9. Kimi K3.1 Pro
10. MiniMax M3
11. 豆包 Seed 2.0

### Tier 3（暂不测）
Gemini 3.1 Pro、Qwen4-Max、Claude、GPT 旗舰——单价 5–20 倍，roleplay 收益未证实。

## 四、每个模型怎么测

1. 人味：`docs/eval` 21 条 × 3 采样，`EVAL_MODEL` 切模型；
2. 工具调用：10 次 `qq_send_message` 冒烟，看参数/token 是否正确；
3. 延迟：首 token + 整轮 p95；
4. 成本：按 1000 条日常消息（1.2k 输入 / 300 输出）折算；
5. 判定：人味 ≥ 基线、工具调用不退化、成本 ≤2 倍 → 候选；否则淘汰。

## 五、需要你提供的 key

| 用途 | 需要 |
|---|---|
| 已具备 | DeepSeek（现用） |
| 测 Qwen | 阿里云百炼 API key |
| 测 GLM | 智谱开放平台 key |
| 测 Gemini | Google AI Studio key（免费层即可） |
| 测 Kimi/MiniMax/豆包 | 对应平台 key（Tier 2 再要） |

预算：Tier 1 全测约 ¥5–10；加上复核与工具冒烟，控制在 ¥30 内。

## 六、淘汰规则

- 人味低于基线 5 个点以上 → 淘汰；
- 工具调用失败 ≥2/10 → 淘汰；
- 成本超过现用 2 倍且人味无提升 → 淘汰；
- 只有「人味 +10 个点且成本 ≤2 倍」才建议换主力。
