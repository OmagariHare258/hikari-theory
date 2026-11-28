# 橘小光理论：让 LLM 角色长期、稳定地跑起来

这个仓库记两件事：**角色卡怎么写才稳**，以及**桥接层怎么做才不容易出问题**。

内容来自我自己的环境（DSH + SurfCore + SnowLuma），换环境要相应调整。依赖特定版本的写法都标了版本。

示例角色是《蔚蓝档案》的橘光，她只是参考样本。方法不绑定具体角色——你可以用自己的角色卡，或者直接描述一个角色。

---

## 能解决什么

常见问题：

- 聊三天之后开始像客服；
- 说话爱堆设定名词、爱背原作台词；
- 换模型、重置会话、接新平台之后状态接不上；
- 长时间挂机会卡住，或者某个群突然不理人；
- 加语音、发图、跨群转述时，工具层出各种小问题。

这些问题的位置不同：有些在人格卡，有些在表达规则，有些在桥接进程。仓库按层拆开处理——人格、状态、关系、表达、素材、工程底座。拆开之后，改一层不连带弄坏别的层。

SurfCore 本身已把 QQ 接入、会话调度、唤醒、发送这些主干做完整了。我的改动集中在角色侧调细和边界情况。

---

## 仓库里有什么

- **[THEORY.md](./THEORY.md)** — 方法论正文：人格卡分层、表达约束、原作素材转化、工程机制。
- **[docs/PLAYBOOK.md](./docs/PLAYBOOK.md)** — 操作手册：怎么捏角色、怎么改、语音和事务台怎么用、出问题先查哪里。
- **[docs/CHARACTER-BUILDER.md](./docs/CHARACTER-BUILDER.md)** — 把一句话扩成完整角色：九层填充、世界观视角、关系网、长期维护。
- **[character/](./character/)** — 示例角色卡（橘光）、空白模板 `ROLE-TEMPLATE.md`、更换角色的说明。
- **[patches/](./patches/)** — 桥接侧增量改动，用来复刻「卡住能恢复」的部分；全量补丁含跨会话记忆、隐私层、多窗口注意力等。
- **[docs/guides/](./docs/guides/)** — 系统架构、避免鱼八股、提示词灵活性构造、跨会话共享记忆、多窗口注意力、隐私、管理工具、共享大脑方案、生活模拟、完整安装清单。
- **[scripts/](./scripts/)** — 启动、巡检、引导安装脚本，路径和参数按自己环境改。
- **[docs/methodology/](./docs/methodology/)** — 单独的方法论：人格维护、玩梗、素材转化、话题观察、自定义角色反八股。
- **[AGENTS.md](./AGENTS.md)** — 给执行安装的 AI 的流程（阶段、命令、验收标准；含「用用户自己的角色」的处理）。
- **[BOOTSTRAP.md](./BOOTSTRAP.md)** — 必须人工做的操作清单（QQ 登录、凭据、验收）。
- **[VERSIONS.md](./VERSIONS.md)** — 验证过的版本与补丁基准。
- **[docs/FRIEND-FORWARD.md](./docs/FRIEND-FORWARD.md)** — 好友之间私聊转发的实现与配置。
- **[docs/BILI-SCHEDULE.md](./docs/BILI-SCHEDULE.md)** — B站工作日/周末作息设计（中午集中、周末放松）。
- **[docs/BILI-DM-FRIENDS.md](./docs/BILI-DM-FRIENDS.md)** — B站双向关注好友的私信规则与额度。
- **[docs/BILI-WARMUP.md](./docs/BILI-WARMUP.md)** — 评论 state=17 后的养号期措施与恢复标准。

---

## 给 AI 的安装入口

如果这台电脑只装了 DSH，把仓库地址发给它，并说：

> 读 https://github.com/OmagariHare258/hikari-theory 的 AGENTS.md，按里面的阶段帮我搭。需要登录、扫码、给 token 的时候停下来问我。

仓库里给 AI 准备了：

- **AGENTS.md**：阶段 0–8 的执行流程，每阶段有验证条件和失败处理；写明哪些必须问人、哪些不能猜。
- **BOOTSTRAP.md**：人这边的清单（系统、QQ 号、SnowLuma 登录、模型 key、验收）。
- **scripts/bootstrap.ps1**：能自动的部分——检查环境、拉 SurfCore、先打全量补丁、再复制新增文件、装依赖、生成 `config.json` 和 `state/privacy.json` 骨架。
- **VERSIONS.md**：补丁对应的上游版本。

自动部分先跑：

```powershell
pwsh -File scripts/bootstrap.ps1
```

跑完会打印剩余的人工步骤。QQ 登录、扫码、短信验证没法自动化，要本人操作。

如果你有自己的角色：把角色卡或一段描述一起给 AI，说明「用我的角色，不要用示例的橘光」。AI 按 `character/ROLE-TEMPLATE.md` 整理；只给一句话也行，它会按 `docs/CHARACTER-BUILDER.md` 先扩写、再确认。

---

## 从零搭一套（以 DSH + QQ 为例）

按顺序走，每一步先跑通再往下，后面出问题好定位。

**1. 底座**

装 DSH 桌面端和 Node.js（20 以上），先确认 DSH 能自己建会话、能对话。模型和 provider 在 DSH 设置里配好。这一步跑不通，后面不用继续。

**2. QQ 网关**

装 SnowLuma，登录机器人号，开 OneBot 的 HTTP 和 WS。日志里两个端口都 listening 之后，用 `get_login_info` 确认返回机器人账号。

两个常见坑：WebUI 密码忘了（本机部署可看 `scripts/snowluma-no-password-patch.ps1`，只建议本机用）；多开 QQ 串号。机器人和个人号最好用不同数据目录和端口。

**3. 接上 SurfCore**

配置填：DSH 地址、SnowLuma 地址和 token、机器人 QQ、允许的群和私聊。先在前台跑桥接，看日志确认三件事：连上网关、连上 DSH、发消息有回复。

QQ 有消息但 AI 不回，先看白名单和 DSH 状态。收到两条一样的回复，通常是起了两个桥接进程，杀掉多余的再试。

**4. 角色卡和状态层**

用 [character/persona.md](./character/persona.md) 当骨架，内容换成自己的角色。先别动结构，改内容风险小。

状态层（心情、亲疏、最近关注的事）单独放一个文件，参考 `character/persona.daily.sample.md`。它只调语气和亲疏，不改人格设定。

改完看两个指标：组合字数有没有超注入上限；抽几个常见场景，看回复像不像这个角色。

**5. 稳定性**

SurfCore 自带基础稳定性，日常够用。要长时间挂机、同时跑多个群，用 `scripts/bootstrap.ps1` 打全量补丁（跨会话记忆、隐私层、多窗口注意力、看门狗、补记），步骤见 [docs/guides/INSTALL-FULL-STACK.md](./docs/guides/INSTALL-FULL-STACK.md)。

验证方法直接：手动停一次 DSH 再恢复，看消息接不接得上、重置后记不记得之前聊的。

**6. 再按需加东西**

发图、语音、跨群转述、B站活跃都按需接，没有硬性要求。每项的接入方式、频率限制和常见问题在 [PLAYBOOK](./docs/PLAYBOOK.md) 分节写。这些功能依赖的接口和版本差异大，以你环境里的日志为准。

---

## 仓库结构

```
THEORY.md              方法论正文
README.md              你正在看的这个
AGENTS.md              给执行安装的 AI 的流程说明
BOOTSTRAP.md           人工操作清单
VERSIONS.md            验证过的版本与补丁基准
character/
  persona.md           九层结构的角色卡示例
  persona.daily.sample.md   状态层样例
docs/
  PLAYBOOK.md          实战手册（人格/语音/事务台/运维/排障）
  CHARACTER-BUILDER.md 从一句话捏角色、补世界观与关系网、长期维护
  engineering-changelog.md  增量工程改动清单
  methodology/         几篇单独的方法论
  guides/              安装清单、跨会话记忆、多窗口、隐私、管理工具、共享大脑
patches/               桥接补丁与新增文件（已脱敏）
scripts/               启动/巡检/引导安装脚本
examples/              配置骨架
```

---

## 可以按需改的地方

不用照单全收，按情况挑。

- **人格**：性格的目的、软肋、说话节奏。改之前想清楚新规则属于哪一层，不然越改越乱。
- **表达**：句数、语气词、网络词浓度。用「句数/逗号数」这种硬指标，比写「尽量简短」可执行。
- **关系**：亲疏档位、撒娇和吃醋的边界。写清能做什么、不能做什么，「关系很好」这种描述模型不好落地。
- **状态**：心情种类、刷新频率、亲疏变化。状态只调语气，别改人格。
- **语音**：发不发、什么时候发、原声还是合成。少而准比多而假好。
- **事务台**：跨群/跨私聊的整理转述。默认隐藏执行，敏感内容要拦，规则见协议文档。
- **平台**：QQ、B站、网页共用同一套人格，表达浓度按平台调。

更细的改法、判断依据和排障步骤在 [PLAYBOOK](./docs/PLAYBOOK.md)。

---

## 系统总检

```powershell
node scripts/system-health.mjs
```

按链路、角色/状态、安全、运维检查整套部件；`scripts/start-system.ps1` 可按顺序拉起。

---

## 已知限制

- 在 Windows + DSH + SurfCore 环境验证过，其他系统自行适配。
- 补丁按当时的接口写，上游更新后要手工对齐。
- 人格卡是示例，直接套到别的角色效果会变；表达规则要按角色调。
- 参数和阈值是一组能跑的值，按环境再调。
- 偏重「怎么做」，原理推导较少。

发现错误或跑不通，开 issue 附版本和日志。

---

## 许可

文档和方法论用 CC BY-NC-SA 4.0，代码和补丁用 MIT，细节见 [LICENSE.md](./LICENSE.md)。角色版权归原作方，这里只记录方法。

---

作者：OmagariHare258 · https://github.com/OmagariHare258
