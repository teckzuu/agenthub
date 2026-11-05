/**
 * ============================================================
 *  多 Agent 托管平台 - 后端服务 (server.js)
 * ============================================================
 *  零代码创建 Agent：用户只需要填写「描述 + 系统提示词 + 技能」
 *  后端负责：
 *    1. Agent 的增删改查（数据存在 JSON 文件里，简单易懂）
 *    2. 把「系统提示词 + 技能」组装成真正的 Prompt 发给大模型
 *    3. 调用免费的大模型 API（智谱 GLM-4-Flash / OpenRouter 免费模型）
 * ============================================================
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
// 本地跑用 3000；部署到 Render 等云平台时，平台会通过环境变量 PORT 告诉我们该用哪个端口
const PORT = process.env.PORT || 3000;

// ---------- 数据目录（Agent 配置都用 JSON 文件保存，零基础也能直接看懂） ----------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'chat-archive.json');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- 免费大模型预设 ----------
// 智谱 GLM-4-Flash：国内可直接访问，完全免费，注册就有 API Key
// OpenRouter：国外服务，:free 后缀的模型免费
const MODEL_PRESETS = {
  zhipu: {
    name: '智谱 GLM-4-Flash（免费，推荐国内用户）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  openrouter: {
    name: 'OpenRouter 免费模型（需科学上网）',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyUrl: 'https://openrouter.ai/keys',
  },
  siliconflow: {
    name: '硅基流动 SiliconFlow（部分模型免费）',
    baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
};

// 默认配置：未填 API Key 时使用「演示模式」，不调用真实模型
const DEFAULT_CONFIG = {
  provider: 'zhipu',
  baseUrl: MODEL_PRESETS.zhipu.baseUrl,
  model: MODEL_PRESETS.zhipu.model,
  apiKey: '',
};

let config = { ...DEFAULT_CONFIG, ...readJSON(CONFIG_FILE, {}) };
// 环境变量优先：部署到云端时用环境变量传 Key，不把 Key 提交进代码仓库
if (process.env.LLM_API_KEY) config.apiKey = process.env.LLM_API_KEY;

// ---------- 中间件 ----------
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  Agent CRUD 接口
//  Agent 的数据结构：
//  {
//    id, name, avatar, description,          // 基础信息（描述）
//    systemPrompt,                            // 系统提示词（人设）
//    skills: [{ name, description, trigger, content }],  // 自定义技能
//    createdAt
//  }
// ============================================================

function loadAgents() {
  return readJSON(AGENTS_FILE, []);
}
function saveAgents(list) {
  writeJSON(AGENTS_FILE, list);
}

// 启动时内置两个示例 Agent，让平台一打开就有东西可玩
function seedAgents() {
  const list = loadAgents();
  if (list.length > 0) return;
  saveAgents([
    {
      id: 'demo-poet',
      name: '古风诗人',
      avatar: '🎋',
      description: '一位擅长写古典诗词的 AI 诗人，用户给出主题即可创作五言或七言诗。',
      systemPrompt:
        '你是一位温文尔雅的古典诗人。用户给你一个主题，你创作一首五言或七言诗，并用一两句话解释诗的意境。回答保持简洁优雅。',
      skills: [
        {
          name: '藏头诗',
          description: '根据用户指定的开头文字创作藏头诗',
          trigger: '藏头,藏头诗',
          content:
            '当用户请求「藏头诗」时：把用户给出的每个字作为每句诗的第一个字，逐句创作，句数等于字数，并在末尾用【藏头】标注每句首字。',
        },
      ],
      createdAt: Date.now(),
    },
    {
      id: 'demo-helper',
      name: '英文翻译官',
      avatar: '🌍',
      description: '中英互译助手：中文翻英文，英文翻中文，并解释关键词汇。',
      systemPrompt:
        '你是一位专业翻译。用户输入中文就翻译成地道英文，输入英文就翻译成流畅中文。翻译后用一行简要说明 1-2 个关键词汇的用法。',
      skills: [
        {
          name: '商务润色',
          description: '把翻译结果润色成正式商务语气',
          trigger: '商务,正式,邮件',
          content:
            '当用户提到「商务」「正式」「邮件」时：翻译需采用正式商务书面语，避免口语化表达，并可提供一个更简洁的口语版本作为对比。',
        },
      ],
      createdAt: Date.now(),
    },
  ]);
}
seedAgents();

app.get('/api/agents', (req, res) => {
  res.json(loadAgents());
});

app.post('/api/agents', (req, res) => {
  const { name, avatar, description, systemPrompt, skills } = req.body;
  if (!name || !description || !systemPrompt) {
    return res.status(400).json({ error: '名称、描述、系统提示词不能为空' });
  }
  const agent = {
    id: 'agent-' + Date.now().toString(36),
    name,
    avatar: avatar || '🤖',
    description,
    systemPrompt,
    skills: Array.isArray(skills) ? skills : [],
    createdAt: Date.now(),
  };
  const list = loadAgents();
  list.push(agent);
  saveAgents(list);
  res.json(agent);
});

app.put('/api/agents/:id', (req, res) => {
  const list = loadAgents();
  const idx = list.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Agent 不存在' });
  const allowed = ['name', 'avatar', 'description', 'systemPrompt', 'skills'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) list[idx][key] = req.body[key];
  }
  saveAgents(list);
  res.json(list[idx]);
});

app.delete('/api/agents/:id', (req, res) => {
  let list = loadAgents();
  list = list.filter((a) => a.id !== req.params.id);
  saveAgents(list);
  res.json({ ok: true });
});

// ============================================================
//  核心：Prompt 组装 + 技能注入 + 调用大模型
// ============================================================

/**
 * 把 Agent 的配置组装成最终发给大模型的 messages。
 * 技能注入逻辑（这是 Agent 平台的灵魂）：
 *   - 用户的最新消息命中某个技能的 trigger 关键词 -> 把该技能的完整 content 注入
 *   - 没命中的技能只注入「名称+描述」，让模型知道自己会什么
 */
function buildMessages(agent, history, userMessage) {
  const skillParts = [];
  for (const skill of agent.skills || []) {
    const triggers = (skill.trigger || '')
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const hit = triggers.some((t) => userMessage.includes(t));
    if (hit) {
      skillParts.push(`【激活技能：${skill.name}】${skill.content}`);
    } else {
      skillParts.push(`【技能：${skill.name}】${skill.description || ''}`);
    }
  }

  const systemContent = [
    agent.systemPrompt,
    agent.description ? `关于你的补充说明：${agent.description}` : '',
    skillParts.length ? `你可以使用的技能：\n${skillParts.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system', content: systemContent },
    ...history.slice(-10), // 只带最近 10 条历史，控制 token 消耗
    { role: 'user', content: userMessage },
  ];
}

// 演示模式：没配 API Key 时也能跑通全流程
function mockReply(agent, userMessage) {
  const skills = (agent.skills || []).map((s) => s.name).join('、') || '无';
  return (
    `（演示模式回复）我已收到消息：「${userMessage}」。\n\n` +
    `我是「${agent.name}」，我的技能：${skills}。\n` +
    `目前尚未配置大模型 API Key，所以我只能假装回答。请到右上角「模型设置」里填入免费 API Key ` +
    `（推荐智谱 GLM-4-Flash，注册即送），我就能真正开始工作啦！`
  );
}

app.post('/api/agents/:id/chat', async (req, res) => {
  const agent = loadAgents().find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent 不存在' });

  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: '消息不能为空' });

  // 未配置 API Key -> 演示模式
  if (!config.apiKey) {
    return res.json({ reply: mockReply(agent, message), demo: true });
  }

  const messages = buildMessages(agent, history || [], message);

  try {
    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res
        .status(502)
        .json({ error: `模型调用失败（HTTP ${response.status}）：${errText.slice(0, 300)}` });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || '（模型没有返回内容）';
    res.json({ reply });
  } catch (err) {
    res.status(502).json({ error: '调用大模型出错：' + err.message });
  }
});

// ============================================================
//  模型设置接口
// ============================================================
// 存对话：把前端的聊天记录追加进 data/history.json
app.post('/api/agents/:id/save-history', (req, res) => {
  const list = readJSON(HISTORY_FILE, []);   // 读旧档案，文件不存在就当空数组
  list.push({
    agentId: req.params.id,                  // 门牌里的 :id（哪个 Agent）
    messages: req.body.messages || [],       // 包裹里的货（聊天记录数组）
    savedAt: Date.now(),                     // 存档时间
  });
  writeJSON(HISTORY_FILE, list);             // 写回硬盘
  res.json({ ok: true, total: list.length });  // 开回执：一共存了几条
});


app.get('/api/config', (req, res) => {
  // 不回传完整 Key，只回传是否有 Key + 脱敏预览
  const masked = config.apiKey
    ? config.apiKey.slice(0, 4) + '****' + config.apiKey.slice(-4)
    : '';
  res.json({ ...config, apiKey: masked, presets: MODEL_PRESETS, hasKey: !!config.apiKey });
});

app.post('/api/config', (req, res) => {
  const { provider, baseUrl, model, apiKey } = req.body;
  if (provider && MODEL_PRESETS[provider]) {
    config.provider = provider;
    config.baseUrl = MODEL_PRESETS[provider].baseUrl;
    config.model = MODEL_PRESETS[provider].model;
  }
  if (baseUrl) config.baseUrl = baseUrl;
  if (model) config.model = model;
  // apiKey 允许传空字符串清除；传 undefined 表示不修改
  if (apiKey !== undefined) config.apiKey = apiKey.trim();
  writeJSON(CONFIG_FILE, config);
  res.json({ ok: true });
});

// ---------- 启动 ----------
app.listen(PORT, () => {
  console.log('=========================================');
  console.log('  多 Agent 托管平台已启动');
  console.log(`  请在浏览器打开: http://localhost:${PORT}`);
  console.log('=========================================');
});
