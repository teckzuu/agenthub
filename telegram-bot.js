/**
 * ============================================================
 *  第 11 课：Telegram 机器人 —— 让你的 Agent 在聊天软件里服务真实用户
 * ============================================================
 *  原理（你已经全会了，只是换了两个门牌）：
 *    1. Telegram 的服务器把用户消息递给你（getUpdates 长轮询）
 *    2. 你调 AgentHub 的 /api/agents/:id/chat（你亲手写过的链路！）
 *    3. 把回复用 sendMessage 递回 Telegram
 *
 *  运行前提：
 *    - config.json 里 telegramToken 已填（找 @BotFather 领）
 *    - server.js 已经在另一个终端跑着（node server.js）
 *    - node telegram-bot.js
 * ============================================================
 */

const fs = require('fs');
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const TOKEN = config.telegramToken;
if (!TOKEN) {
  console.log('⚠️  config.json 里的 telegramToken 还是空的！');
  console.log('   去 Telegram 找 @BotFather → 发 /newbot → 按提示起名 → 复制 token 粘贴进来。');
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${TOKEN}`;
const AGENTHUB = 'http://localhost:3000/api/agents';
const AGENT_ID = config.telegramAgentId || 'demo-poet';   // 默认让「古风诗人」接待，可换成你自己的 Agent id

// 每个聊天窗口独立的记忆（chatId → history 数组）
// 这就是你在面试讲解稿里写的「模型没记忆，多轮=历史重发」的真身！
const memories = new Map();

// ---------- Telegram 工具函数：往 Telegram 寄包裹 ----------
async function tg(method, body) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ---------- 处理一条用户消息（全链路核心） ----------
async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;   // 只处理文字消息（图片、贴纸先忽略）

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // /start 是 Telegram 机器人的「见面礼」惯例
  if (text === '/start') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '你好！我是 AgentHub 平台上的 AI 助手 🤖\n直接发消息和我聊吧！',
    });
    return;
  }

  // ① 取这个聊天的历史记忆（每个用户独立，互不串台）
  if (!memories.has(chatId)) memories.set(chatId, []);
  const history = memories.get(chatId);

  // ② 调 AgentHub 的聊天接口 —— 门牌暗号和 index.html 里的一模一样！
  const res = await fetch(`${AGENTHUB}/${AGENT_ID}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, history }),
  });
  const data = await res.json();
  const reply = data.reply || ('（出错了：' + (data.error || '未知错误') + '）');

  // ③ 更新记忆（只留最近 10 条 —— 和 server.js 的 history.slice(-10) 同一个省钱逻辑）
  history.push({ role: 'user', content: text });
  history.push({ role: 'assistant', content: reply });
  if (history.length > 10) history.splice(0, history.length - 10);

  // ④ 把回复递回 Telegram
  await tg('sendMessage', { chat_id: chatId, text: reply });
}

// ---------- 长轮询主循环：不停地问 Telegram「有新消息吗」 ----------
// getUpdates 带 timeout=30 = 服务器最多挂 30 秒等新消息（长轮询，省流量又实时）
let offset = 0;
async function loop() {
  try {
    const res = await fetch(`${TG_API}/getUpdates?timeout=30&offset=${offset}`);
    const data = await res.json();
    for (const update of data.result || []) {
      offset = update.update_id + 1;   // 告诉 Telegram：这条我处理过了，下次别再递
      await handleUpdate(update);       // 不 await？不，必须等处理完再收下一条（初版先串行，够用）
    }
  } catch (err) {
    console.log('⚠️ 网络抖动，3 秒后重试：', err.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
  loop();   // 循环站岗 —— 和 server.js 的 app.listen 一个道理，永不结束
}

console.log('🤖 Telegram 机器人已上岗！');
console.log('   接待 Agent：' + AGENT_ID);
console.log('   去 Telegram 给你的机器人发条消息试试！');
loop();
