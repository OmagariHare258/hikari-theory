# 橘小光理论

LLM 角色的长期维护笔记，以及在 DSH、SurfCore 和 SnowLuma 上做的一些改动。

角色扮演的问题往往出在聊久以后：开始复读设定、说话像客服，或者重置会话后接不上之前的关系。这里记录这些问题的处理方式。

示例取自《蔚蓝档案》的橘光。其他角色可以借鉴分层方式，不必沿用她的性格和说话习惯。

## 角色部分

- [THEORY.md](THEORY.md)：行为倾向、人格与状态分离、表达约束和素材处理。这些是实践经验，不是经过系统实验验证的通用理论。
- [PLAYBOOK.md](docs/PLAYBOOK.md)：实际运行和排查。
- [CHARACTER-BUILDER.md](docs/CHARACTER-BUILDER.md)：为其他角色整理人格卡。
- [character/](character/)：示例角色卡、状态样例和模板。

角色卡里同一条性格写在多个章节，修改时就容易漏掉某处。这里将身份、行为判断、表达、关系和动态状态分开。原作台词用于理解角色，不当作固定回复。

## 桥接和部署

桥接基于 SurfCore，改动放在 [patches/](patches/)，涉及跨会话记忆、隐私边界、多窗口注意力和异常恢复等。

补丁基准为 SurfCore v0.8.8（commit `0deb826`）。版本和应用顺序见 [VERSIONS.md](VERSIONS.md)，不要直接覆盖其他版本的代码。

复现环境前先读 [安装清单](docs/guides/INSTALL-FULL-STACK.md)、[BOOTSTRAP.md](BOOTSTRAP.md) 和 [AGENTS.md](AGENTS.md)。Windows 下有 PowerShell 引导脚本：

```powershell
pwsh -File scripts/bootstrap.ps1
```

先检查脚本再执行。QQ 登录、凭据填写及验收仍需本人完成。已有环境应先备份配置和状态。

## 其他资料

- [docs/methodology/](docs/methodology/)：表达、玩梗和素材笔记。
- [docs/guides/](docs/guides/)：安装、记忆、注意力和管理工具。
- [工程改动记录](docs/engineering-changelog.md)
- [examples/](examples/)：配置样例。
- [scripts/](scripts/)：启动、安装及巡检工具。

目前主要针对 Windows 上的这套环境。换模型或升级 DSH / SurfCore 后，需要重新检查接口和角色表现。

文档与方法论采用 CC BY-NC-SA 4.0，代码和补丁采用 MIT，详见 [LICENSE.md](LICENSE.md)。示例角色版权归原作权利人。
