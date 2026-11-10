/**
 * 跨会话事务台（方案 B）的纯逻辑：配置归一、请求校验、读片段、提示词拼装。
 *
 * 背景（2026-11-05 用户定）：
 *   小光要能「穿梭多个群/对话」帮人转述、整理私发，但普通会话的 agent token 是**绑死单会话**的
 *   （bridge 的 agentTokenOk）。所以做法是：普通会话只发起一个「跨会话任务」，
 *   桥接另开一个**独立事务台会话**，给它一次性 token 和明确的读/写范围；
 *   事务台只能读指定会话、只能发到指定目标，完成/超时即归档。
 *
 * 权限（2026-11-05 用户第二次定稿）：
 *   · 主人：任意内容转发，不限次；
 *   · 白名单里的人：不限次（按内容规则自行判断）；
 *   · 好感度 ≥ highAffectionAt（60）：每天最多 highAffectionDaily（5）次；
 *   · 其他人：每天最多 defaultDaily（3）次；
 *   · 转给第三方、群转私聊、私聊转群：都允许，由小光**按内容/关系自行审查**要不要帮；
 *     桥接只保留目标白名单、敏感信息拦截、每任务条数上限这些硬闸。
 *
 * 本文件不碰网络/状态，桥接负责真正的 IO，方便单测。
 */

export const DEFAULT_CROSS_TASK = {
  enabled: true,
  reportToChat: false,              // 是否把【事务台】摘要作为消息发回来源会话（默认关：不打断对话）
  ownerOnly: false,             // false = 非主人也可发起（按下面 tiers 限次）
  maxTasksPerDay: 200,          // 全局上限（防刷；个人限制见下）
  maxActivePerSource: 1,        // 同一个来源会话同时最多 1 个事务台
  ttlMs: 10 * 60 * 1000,        // 事务台 10 分钟没完成自动结束
  maxReads: 5,                  // 一次任务最多读几个会话
  maxSends: 3,                  // 一次任务最多发到几个目标
  maxSendsPerTask: 10,          // 一次任务最多真正发几条
  peekLimit: 30,                // 每次 peek 最多几条消息
  maxPeekChars: 4000,           // peek 返回正文总字数上限
  maxTaskChars: 500,
  keepSessionMs: 0,                 // 事务台结束后会话保留多久（0=立即归档，前端不可见）
  // 内容边界：默认都交给小光自审；只有显式关掉才硬拦。
  allowPrivateToGroup: true,
  allowGroupToPrivate: true,
  // 发起人档位
  highAffectionAt: 60,
  highAffectionDaily: 5,
  defaultDaily: 3,
  trustedWhitelistUnlimited: true,
};

function intInRange(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeCrossTaskConfig(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: raw.enabled !== false,
    reportToChat: raw.reportToChat === true,
    ownerOnly: raw.ownerOnly === true,
    maxTasksPerDay: intInRange(raw.maxTasksPerDay, DEFAULT_CROSS_TASK.maxTasksPerDay, 1, 2000),
    maxActivePerSource: intInRange(raw.maxActivePerSource, DEFAULT_CROSS_TASK.maxActivePerSource, 1, 10),
    ttlMs: intInRange(raw.ttlMs, DEFAULT_CROSS_TASK.ttlMs, 60_000, 60 * 60 * 1000),
    maxReads: intInRange(raw.maxReads, DEFAULT_CROSS_TASK.maxReads, 1, 20),
    maxSends: intInRange(raw.maxSends, DEFAULT_CROSS_TASK.maxSends, 1, 10),
    maxSendsPerTask: intInRange(raw.maxSendsPerTask, DEFAULT_CROSS_TASK.maxSendsPerTask, 1, 50),
    peekLimit: intInRange(raw.peekLimit, DEFAULT_CROSS_TASK.peekLimit, 1, 200),
    maxPeekChars: intInRange(raw.maxPeekChars, DEFAULT_CROSS_TASK.maxPeekChars, 200, 20000),
    maxTaskChars: intInRange(raw.maxTaskChars, DEFAULT_CROSS_TASK.maxTaskChars, 20, 2000),
    keepSessionMs: intInRange(raw.keepSessionMs, DEFAULT_CROSS_TASK.keepSessionMs, 0, 24 * 60 * 60 * 1000),
    allowPrivateToGroup: raw.allowPrivateToGroup !== false,
    allowGroupToPrivate: raw.allowGroupToPrivate !== false,
    highAffectionAt: intInRange(raw.highAffectionAt, DEFAULT_CROSS_TASK.highAffectionAt, 0, 100),
    highAffectionDaily: intInRange(raw.highAffectionDaily, DEFAULT_CROSS_TASK.highAffectionDaily, 0, 100),
    defaultDaily: intInRange(raw.defaultDaily, DEFAULT_CROSS_TASK.defaultDaily, 0, 100),
    trustedWhitelistUnlimited: raw.trustedWhitelistUnlimited !== false,
  };
}

const KEY_RE = /^(group|private):(\d+)$/;

export function isCanonicalChatKey(key) {
  return KEY_RE.test(String(key ?? ''));
}

/**
 * 发起人当天的次数上限：0 表示不限次。
 * owner / 白名单（trustedWhitelistUnlimited）→ 0；好感 ≥ highAffectionAt → highAffectionDaily；其他 → defaultDaily。
 */
export function crossTaskDailyLimit({ requester = {}, gate } = {}) {
  const g = normalizeCrossTaskConfig(gate);
  if (requester.isOwner) return 0;
  if (requester.isWhitelisted && g.trustedWhitelistUnlimited) return 0;
  const score = Number(requester.affection);
  if (Number.isFinite(score) && score >= g.highAffectionAt) return g.highAffectionDaily;
  return g.defaultDaily;
}

/** 群/私聊内容的硬边界（默认全放开，交给小光自审；只有配置显式关闭才拦）。返回错误文案或空串。 */
export function crossSendPolicyError({ readKeys = [], targetKey = '', gate } = {}) {
  const g = normalizeCrossTaskConfig(gate);
  const reads = (Array.isArray(readKeys) ? readKeys : []).map(String);
  const target = String(targetKey ?? '');
  const hasPrivateRead = reads.some((k) => k.startsWith('private:'));
  const hasGroupRead = reads.some((k) => k.startsWith('group:'));
  if (hasPrivateRead && target.startsWith('group:') && !g.allowPrivateToGroup) {
    return '任务读取了私聊内容，且私聊→群已关闭（allowPrivateToGroup=false）';
  }
  if (hasGroupRead && target.startsWith('private:') && !g.allowGroupToPrivate) {
    return '任务读取了群内容，且群→私聊已关闭（allowGroupToPrivate=false）';
  }
  return '';
}

/**
 * 校验一次「跨会话任务」请求。
 * @param {object} args
 * @param {string} args.requesterKey 发起会话（任何允许的群/私聊）
 * @param {string} args.task
 * @param {string[]} args.readKeys
 * @param {string[]} args.sendTargets
 * @param {{personId:string,isOwner:boolean,isWhitelisted:boolean,affection:number,name?:string}} args.requester
 * @param {(key:string, kind:string, id:number)=>boolean} args.allowed
 * @param {number} args.dailyCount 发起人今天已开过多少事务台
 * @param {number} args.totalDailyCount 全局今天已开过多少
 * @param {number} args.activeForSource
 * @param {string} args.ownerQQ
 * @param {object} args.gate
 */
export function validateCrossTaskRequest({
  requesterKey, task, readKeys = [], sendTargets = [], requester = {},
  allowed = () => false, dailyCount = 0, totalDailyCount = 0, activeForSource = 0, ownerQQ = '', gate,
}) {
  const g = normalizeCrossTaskConfig(gate);
  if (!g.enabled) return { ok: false, error: '跨会话任务已关闭（socialV2.crossTask.enabled=false）' };
  if (!isCanonicalChatKey(requesterKey)) return { ok: false, error: '发起会话 key 不合法' };
  if (g.ownerOnly && !requester.isOwner) return { ok: false, error: '跨会话任务目前只允许主人发起（ownerOnly=true）' };
  const text = String(task ?? '').trim();
  if (!text) return { ok: false, error: '任务描述不能为空' };
  if (text.length > g.maxTaskChars) return { ok: false, error: `任务描述最多 ${g.maxTaskChars} 字` };
  if (totalDailyCount >= g.maxTasksPerDay) return { ok: false, error: `今天全局的事务台次数已用完（上限 ${g.maxTasksPerDay}）` };
  if (activeForSource >= g.maxActivePerSource) return { ok: false, error: '这个会话已经有一个事务台在跑，等它结束再发' };

  const limit = crossTaskDailyLimit({ requester, gate: g });
  if (limit > 0 && dailyCount >= limit) {
    const why = requester.isOwner || requester.isWhitelisted
      ? '今天的跨会话次数已用完'
      : `好感度 ${Number.isFinite(Number(requester.affection)) ? requester.affection : '?'}（${requester.affection >= g.highAffectionAt ? `≥${g.highAffectionAt}` : `<${g.highAffectionAt}`}）每天最多 ${limit} 次`;
    return { ok: false, error: why };
  }

  const reads = [...new Set((Array.isArray(readKeys) ? readKeys : []).map(String))];
  const sends = [...new Set((Array.isArray(sendTargets) ? sendTargets : []).map(String))];
  if (!reads.length) return { ok: false, error: '至少要给一个要读的会话（readKeys）' };
  if (reads.length > g.maxReads) return { ok: false, error: `一次最多读 ${g.maxReads} 个会话` };
  if (!sends.length) return { ok: false, error: '至少要给一个发送目标（sendTargets）' };
  if (sends.length > g.maxSends) return { ok: false, error: `一次最多发到 ${g.maxSends} 个目标` };

  // 发起人自己的会话永远可读（好友想让她把话转给主人，不需要先被加进白名单）；
  // 发给主人也永远允许。其余目标照旧走白名单/好友校验。
  const ownerKey = ownerQQ ? `private:${String(ownerQQ)}` : '';
  const readOk = (k) => k === requesterKey || allowed(k, k.split(':')[0], Number(k.split(':')[1]));
  const sendOk = (k) => (!ownerKey || k === ownerKey) || allowed(k, k.split(':')[0], Number(k.split(':')[1]));
  const badRead = reads.find((k) => !isCanonicalChatKey(k) || !readOk(k));
  if (badRead) return { ok: false, error: `不能读取这个会话：${badRead}（不在当前模式允许范围/白名单）` };
  const badSend = sends.find((k) => !isCanonicalChatKey(k) || !sendOk(k));
  if (badSend) return { ok: false, error: `不能发送到这个会话：${badSend}（不在当前模式允许范围/白名单）` };
  for (const target of sends) {
    const policyError = crossSendPolicyError({ readKeys: reads, targetKey: target, gate: g });
    if (policyError) return { ok: false, error: policyError };
  }
  return { ok: true, reads, sends, gate: g, dailyLimit: limit };
}

/** 把会话的 recentMessages 裁成给模型看的片段（纯函数）。 */
export function buildPeekSlice(messages, { limit = 30, maxChars = 4000 } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const picked = [];
  let total = 0;
  for (let i = list.length - 1; i >= 0 && picked.length < limit; i -= 1) {
    const m = list[i];
    if (!m || typeof m !== 'object') continue;
    const body = String(m.text ?? m.plain ?? '').replace(/\s+/g, ' ').trim();
    if (!body) continue;
    const entry = {
      messageId: m.messageId != null ? String(m.messageId) : (m.seq != null ? `seq:${m.seq}` : ''),
      from: m.isSelf ? '我' : String(m.sender || m.name || (m.userId != null ? `QQ ${m.userId}` : '对方')),
      qq: m.userId != null ? String(m.userId) : '',
      self: Boolean(m.isSelf),
      text: body,
      at: Number(m.time) || 0,
    };
    if (total + entry.text.length > maxChars && picked.length > 0) break;
    picked.push(entry);
    total += entry.text.length;
  }
  return picked.reverse();
}

/** 事务台提示词（纯函数；token/任务都只进这一个会话）。 */
export function formatCrossTaskPrompt({
  persona = '', task = '', reads = [], sends = [], token = '', taskKey = '',
  limits = DEFAULT_CROSS_TASK, names = {}, requester = {}, people = {},
}) {
  const g = normalizeCrossTaskConfig(limits);
  const label = (k) => (names[k] ? `「${names[k]}」（${k}）` : k);
  const readLines = reads.map((k) => `- ${label(k)}`).join('\n');
  const sendLines = sends.map((k) => `- ${label(k)}`).join('\n');
  const peopleLines = Object.entries(people).filter(([qq, name]) => qq && name).slice(0, 20).map(([qq, name]) => `- QQ ${qq} = 「${name}」`).join('\n');
  const who = requester.name ? `（请求人：${requester.name}${Number.isFinite(Number(requester.affection)) ? `，好感度 ${requester.affection}` : ''}）` : '';
  return `${persona ? `${persona}\n\n` : ''}【跨会话事务台】你现在在处理一个「帮人跨会话传话/整理」的任务，不在普通 QQ 聊天里。只做这一件事，不要闲聊、不要调用任务以外的工具。

【任务】${String(task).slice(0, g.maxTaskChars)}${who}

【可读会话（只能读这些）】
${readLines}

【可发送目标（只能发到这些）】
${sendLines}

【怎么称呼（重要）】
- 【可读会话】/【可发送目标】里写的是「群名（group:群号）」或「昵称（private:QQ）」，**群名和号码都给你对照用**；真正对用户说话/发消息时只用群名和昵称。
- 群和私聊一律用**名字**说（如「示例群A」群、「群友A」），**不要直接念 group:123 / private:456 这种编号**；只有确实需要唯一标识时才写「QQ 123」。
- peek 返回的每条消息带 from（昵称）、qq（QQ 号）、self（是否你自己说的）。**先确认每条是谁说的，再落笔**：self=true / from=我是你自己（小光）以前说过的话；别人说的不要归到请求人头上。请求人只是让你转述的人，不等于内容来源。
- 示例：如果视频是你自己刷到的，转述就说「小光刷到一个视频」，不要写成「sensei 刷到的 / sensei 让你带话」。
- finish 的 summary 也一样：用群名/昵称，不要只用号码。
${peopleLines ? `\n【人物对照（QQ 号 → 昵称）】\n${peopleLines}\n` : ''}
【工具（只有这三个能用，其它 QQ 工具一律会拒绝，别试）】
- qq_peek_conversation：读一个可读会话的最近消息（key 用上面列表里的 key，limit 默认 ${g.peekLimit}）
- qq_cross_send：发一条文本到可发送目标（targetKey 用上面列表里的 key；每条都会记账，最多 ${g.maxSendsPerTask} 条）
- qq_cross_finish：**必须最后调用**，把结果摘要回报给发起人

【会话参数】key=${taskKey}；token=${token}

【怎么判断该不该帮（重要）】
1. 先看内容：涉及隐私/私事/别人明确说不要外传/敏感信息/会让人社死或起冲突的，**不要转**，在 finish 里说明拒绝。
2. 参考关系与好感度：熟的人、正向的请求优先；不熟的人让你转发别人的私事，更谨慎。
3. 转给第三方（群或其他好友）可以，但只转任务要求的、必要的那部分；不要顺手扩散、不要二次转述。
4. 群内容转私聊、私聊内容转群都允许，但私事进群默认要谨慎；拿不准就拒绝。
5. **可以用小光自己的口吻复述**：把原话的意思用你会说的话讲出来（可以带一点你的语气/吐槽/拖音），不必逐字照搬；但「谁说的、数字、时间、条件、约定」这些关键信息不能改，不要添油加醋或编造。
5.1) **原样转写还是由你复述，自己判断**：如果内容是题目、选项、表格、代码、文件、数字约定这类「改了就会失真/让对方没法用」的东西，就逐字转写，别重写、别重新出题；如果只是闲聊、观点、故事，可以按你的口吻复述，但事实、数字、条件、结论不能变。判断标准：改完之后，对方还能不能正确使用或理解这段内容？来源是图片时，先用 qq_get_message_images 看，再决定转写还是概述；只能发文字就跟对方说明，不要假装转发图片。
6. 必须原样保留的内容（引用、约定、地址、ID、数字）用引号括起来，并注明来源会话（如「A 群那边有人说…」）；不要整段复制超长内容。
7. 复述后自己读一遍：意思有没有变？对方看完会不会误会成另一个人说的？会的话就改。

【硬规则】
1. 只用上面三个工具；不要尝试 qq_send_message / qq_send_private_message / qq_send_group_message 等普通工具（它们会 403）。
2. 只读列出的会话、只发列出的目标；绝不越界。
3. 出现手机号/证件号/住址/密码/令牌等敏感信息：不要发，在 finish 里说「已拦截敏感信息」。
4. 每条发送尽量短、像小光在转述；最多 ${g.maxSendsPerTask} 条。
5. 做完立刻 qq_cross_finish，summary 写：发了什么、发到哪、有没有失败/拦截/拒绝。不要等别人回话。
6. 不合理/越权的请求直接 finish 拒绝，不要执行。
7. 拿不准「该转写还是复述」时，优先保证信息能用：按原文转写，别自己发挥。`;
}

/** 事务台会话的摘要/审计行（JSONL）。 */
export function crossTaskAuditLine(record) {
  return JSON.stringify({
    at: new Date().toISOString(),
    taskId: record.taskId,
    sourceKey: record.sourceKey,
    requester: record.requester ?? null,
    task: String(record.task ?? '').slice(0, 200),
    reads: record.reads ?? [],
    sends: record.sends ?? [],
    sent: record.sent ?? [],
    summary: String(record.summary ?? '').slice(0, 500),
    reason: record.reason ?? 'finished',
  });
}








