# 人味研究：社区里直接拿 QQ 群/社区聊天训练的模型

调研时间：2026-11-20。目标是回答一个问题：**有没有现成的、拿 QQ 群或社区聊天记录训练出来的模型/方案，能让小光更像人？**

## 一、结论先行

有，但要分清三种东西：

1. **直接拿 QQ 群聊训练的模型**：`mai_replier_9b_v3`（MaiBot 生态，Qwen3.5-9B，LoRA SFT，标签就是 `qq-group-chat` / `retro-replyer`）。它是「群聊回复器」，不是通用助手——无思维链、不调工具、只输出一句人设回复。
2. **拿聊天记录微调的方法/工具**：WeClone、Phantasm、CloneLLM。它们不提供模型，提供「聊天记录 → LoRA → 数字分身」的流水线。
3. **不训练、靠交互设计变人味的项目**：Vespera、赛博肥鱼群友、MaiBot 本体。人味主要来自打字节奏、主动分享、生活系统、记忆、表情包，而不是模型权重。

**对小光最实用的不是换模型，而是两件事**：
- 借 MaiBot 的群聊 prompt 格式（时间戳、发言人、自己标 `(你)`、引用/@/表情占位）；
- 借 mai_replier 的「风格改写」用法：主模型负责工具和事实，小模型只把草稿改写成群聊口吻。

## 二、项目清单

| 项目 | 是什么 | 数据/训练 | 人味特征 | 对 8GB 4060 可行性 |
|---|---|---|---|---|
| [mai_replier_9b_v3](https://hf-mirror.com/tcmofashi/mai_replier-9b-v3) | MaiBot 的 QQ 群回复器，Qwen3.5-9B，LoRA r=64 合并权重 | QQ 群聊「复古回复器」格式；无 CoT；多模态交错图片 | 只输出一句口语回复；带发言人/时间/引用/表情的聊天日志 | bf16 18GB 不行；4-bit 约 5–6GB 可试，速度慢 |
| [MaiBot](https://github.com/Mai-with-u/MaiBot) | QQ 群数字生命框架 | 不训练；用现成模型 + 记忆/黑话/模仿群友 | 会看气氛、该闭嘴就闭嘴、模仿群友说话、学黑话 | 纯框架，无 GPU 要求 |
| [WeClone](https://github.com/xming521/WeClone) | 聊天记录 → LoRA 数字分身 | 微信 CSV；7B LoRA 约 16GB，QLoRA 4-bit 约 6GB | 学「那味儿」；隐私过滤；QQ 通过 AstrBot/LangBot 接入 | QLoRA 7B 可训；**微调后不支持工具调用** |
| [Phantasm](https://github.com/rugbedbugg/Phantasm) | Discord 聊天记录 → 人格 LoRA | 群聊里区分 self/target/other；按会话切分；只在目标回复上算 loss | 有 persona fidelity 评分（长度/标点/表情/用词/短语/句长） | QLoRA 可训；方法最严谨 |
| [CloneLLM](https://github.com/kcxain/CloneLLM) | 聊天记录微调数字生命 | 个人聊天记录 | 学个人语气 | 同 LoRA |
| [HuixiangDou-CR](https://github.com/InternLM/HuixiangDou) | 群聊代词消解 SFT | 58k 真实群聊，人工标注 2.3k，Qwen 14B/32B LoRA，F1 +29% | 群聊上下文理解（「他/这个/那」指谁） | 数据/论文可参考，不必自己训 |
| [LCCC / CDial-GPT](https://github.com/thu-coai/CDial-GPT) | 中文短文本对话数据集 | 680 万 / 1200 万对话，清洗过 | 通用「像人闲聊」语料，不是角色 | 数据可用于继续预训练/风格参考 |
| [Vespera](https://www.bilibili.com/video/BV17Vxm6FEqy) | 情感陪伴机器人（14 亿 token、35 插件） | 不公开训练；主要靠工程 | 看消息→思考→打字→发送；主动分享；生活/天气/地理；照片/语音/唱歌；好感度 | 思路可借，模型不可得 |
| [赛博肥鱼群友](https://www.cnblogs.com/HiroMuraki/p/23502646) | 手搓 QQ 群 agent 的工程总结 | 不训练 | 记忆分层（模块/历史/日记/笔记）、群间隔离、工具当回复、前缀缓存 99.4% | 工程参考 |
| 视频里的 8B 千问 | UP 主自己用群友聊天记录训的本地模型 | 私有不公开 | 图灵测试榜一，但答非所问、智力倒数 | 反例：小模型微调会丢推理 |

## 三、社区总结的「人味」特征

从上面项目里反复出现的，不是「更会说话」，而是：

1. **短、碎、不完整**：一条一个念头，允许半句、断行、省标点；
2. **不完美**：会跑题、会复读、会答非所问、会有偏好和偏见；
3. **有自己的生活**：主动分享、有行程/天气/朋友，不是围着用户转；
4. **记得住人和事**：群友、黑话、上次聊到哪、答应过什么；
5. **会看气氛**：该接话接话，该闭嘴闭嘴；
6. **群聊格式**：时间戳、发言人、自己标 `(你)`、引用/@/表情占位——这让模型分得清谁在说话；
7. **节奏**：不是秒回，有「看—想—打字—发送」的延迟。

## 四、我们的实测差距（style-fidelity.mjs）

数据：surfcore 最近 100 条/会话，清洗掉报告/引用/卡片后，34 条小光 vs 34 条别人。

| 指标 | 小光 | 别人 | 判断 |
|---|---:|---:|---|
| 平均字数 | 22.8 | 8.1 | 她偏长 |
| 中位数字数 | 18 | 6 | 她偏长 |
| ≤10 字占比 | 12% | 74% | 她很少短句 |
| 标点 / 条 | 3.29 | 0.24 | 她标点太多 |
| 带问号占比 | 18% | 0% | 她太爱反问 |
| 自称「小光」/ 条 | 0.24 | 0.09 | 略高，可接受 |

**结论：最该改的不是用词，是「长度、标点、问号」。** 群友聊天是「短、没标点、少问号」，她是「完整句、标点齐全、爱反问」。

## 四点五、情绪化短回复（本轮补充）

截图案例：群友对小光说「给我买一辆」（GT4，157.8 万），她回「行。一百五十万先打过来。」——这是人味：不解释、不客服、用一句反调侃接住离谱要求。

可扩展的短反应：

- 单标点：「？」「……」「……？」
- 单字/短词：「6」「行。」「想得美」「你先打钱」
- 适用：对方明显在开玩笑/提离谱要求；**认真求助、正经问题不能这么敷衍**。
- 频率：约每 20 条最多 1 次；同一个人一天最多 1 次；连续两条不许都用。
- 数据基线：style-fidelity 里「≤3 字/纯标点」小光 3%、群友 6%——可以略增，但**上限 10%**，超过就是敷衍。

已落地：人格卡 4.5「荒诞玩笑只回一个情绪」、用例 c26、style-fidelity 新增该指标。

## 五、三档方案

### A. 零成本（现在就能做）

- 群聊默认压到 **10–15 字**，能一句说完不拆两句；
- **句末句号能省就省**，问号少用（真在问才用）；
- 断句靠回车，不靠逗号堆；
- 借 MaiBot 的群聊格式：给桥接的聊天记录加时间戳/发言人/自己 `(你)`，减少「谁在说话」的歧义。

先做 A/B：改完跑一周 style-fidelity，看字数/标点/问号是否接近群友。

### B. 风格改写（低风险，推荐先试）

用 `mai_replier_9b_v3`（4-bit）或 API，只做「把 DeepSeek 的草稿改成群聊口吻」：

```
主模型（DeepSeek）→ 事实/工具/决策
        ↓ 草稿
风格模型（mai_replier / 自建 LoRA）→ 改写一句
        ↓
发送前安全校验（数字/链接/敏感词）→ 发出
```

- 工具调用、记忆、B站 全部留在主模型，**风格模型不碰工具**；
- 失败/超时/改坏 → 回退原文；
- 对比指标：style-fidelity + eval 21 条。

### C. 自建 LoRA（要数据，慢）

- 数据：需要 **2k–10k 轮**「上下文 → 她的回复」；现在只有 34–100 条，不够；
- 采集：QQ 群历史（需授权）导出成 ShareGPT；Phantasm 的会话切分 + 只在她的回复上算 loss；
- 训练：7B QLoRA 约 6GB 显存，4060 8GB 可跑，但慢；9B 4-bit 推理可试；
- **训练后不支持工具调用**（WeClone 明确写），只能当改写器，不能替换主模型；
- 评测：Phantasm 的 persona fidelity（长度/标点/表情/用词/短语/句长），别只看「像不像」。

## 六、硬件与成本

- 本机：RTX 4060 Laptop **8GB**；当前 torch 是 CPU 版，训练前要装 CUDA torch；
- 7B QLoRA：约 6GB 显存，可训，batch 1 + 梯度累积；
- 9B 4-bit 推理：约 5–6GB，4k 上下文可行，速度慢（短回复够用）；
- 数据成本：现在没有足够 QQ 群历史；要做得先导出并清洗（隐私/授权）。

## 七、风险

1. **小模型智力下降**：视频里的 8B 图灵榜一但答非所问——这就是为什么只让它改写，不让它做主模型；
2. **工具调用丢失**：微调后的模型基本不会调工具，不能替换 DeepSeek；
3. **过拟合群友**：学的是「群里的人」，不是「小光」；Phantasm 的 persona 切分和角色卡要先定；
4. **隐私/授权**：群聊记录涉及第三方，导出/训练前必须获得同意；
5. **8GB 显存**：9B 4-bit 能跑但慢，7B QLoRA 能训但别指望快。

## 八、建议下一步

1. **先做 A**（1 天内）：改群聊长度/标点/问号，跑一周 style-fidelity 对比；
2. **再评估 B**：下载 mai_replier_9b_v3 的 4-bit（或先找 API），用 20 条草稿做改写对比，看是否真的更像群友；
3. **C 暂缓**：等有 2k+ 轮授权数据再考虑；没有数据硬训只会学歪。

## 九、来源

- [mai_replier_9b_v3 模型卡](https://hf-mirror.com/tcmofashi/mai_replier-9b-v3)
- [MaiBot](https://github.com/Mai-with-u/MaiBot) / [replyer 模板文档](https://github.com/mai-with-u/maibot/blob/main/docs/replyer-prompt-profiles.md)
- [WeClone](https://github.com/xming521/WeClone)
- [Phantasm](https://github.com/rugbedbugg/Phantasm)
- [CloneLLM](https://github.com/kcxain/CloneLLM)
- [HuixiangDou](https://github.com/InternLM/HuixiangDou) / [arXiv:2405.02817](https://arxiv.org/abs/2405.02817)
- [LCCC](https://arxiv.org/abs/2008.03946) / [CDial-GPT](https://github.com/thu-coai/CDial-GPT)
- [Vespera 视频](https://www.bilibili.com/video/BV17Vxm6FEqy) / [解读](https://kongchang.com/articles/kai-yuan-qing-gan-pei-ban-mo-xing-vespera-da-fei-yu-ru-he-tong-guo-tu-ling-ce-sh)
- [赛博肥鱼群友实现小结](https://www.cnblogs.com/HiroMuraki/p/23502646)
