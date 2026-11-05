# AgentHub — Zero-Code Multi-Agent Hosting Platform

A full-stack web platform that lets anyone create and host custom AI agents **without writing code** — just fill in a name, description, system prompt, and custom skills, then chat with them instantly.

> Built as a hands-on full-stack learning project: vanilla HTML/CSS/JS frontend, Node.js/Express backend, OpenRouter LLM integration, and Telegram bot integration.

## ✨ Features

- **Zero-code agent creation** — name + description + system prompt + emoji avatar, done
- **Custom skills with trigger-word injection** — skills are dynamically injected into the system prompt when user messages hit their triggers (prompt engineering in action)
- **Multi-model support** — pluggable LLM providers (OpenRouter, Zhipu GLM-4-Flash, SiliconFlow) via a unified OpenAI-compatible interface; switch models with one config change
- **Demo mode** — runs the full flow even without an API key
- **Telegram bot integration** — agents serve users directly in Telegram, with per-chat conversation memory (see `telegram-bot.js`)
- **XSS-safe rendering** — all user input is HTML-escaped before rendering

## 🏗️ Architecture

```
Browser (public/index.html — vanilla SPA)
   │  fetch: GET / POST / PUT / DELETE
   ▼
Express server (server.js, port 3000)
   │  fs read/write
   ▼
JSON files (data/agents.json — agent store, data/config.json — model config)
   │  only when a reply is needed
   ▼
LLM provider (OpenRouter / Zhipu — OpenAI-compatible chat completions)
```

**Key design decisions**

- API keys live in backend config, never in frontend code (security + config/code separation)
- Only the last 10 history messages are sent per request (token cost control)
- Stateless agent store: every request re-reads the JSON store (simple & correct for low traffic)
- Demo mode fallback keeps the product usable before any API key is configured

## 🚀 Run locally

```bash
npm install
node server.js
# open http://localhost:3000
```

Configure a model: open the web UI → ⚙ Model Settings → pick a provider → paste your API key.
Or set environment variable `LLM_API_KEY` (takes precedence over the config file).

## 💬 Telegram bot

1. Talk to [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token
2. Add to `config.json`: `"telegramToken": "your-token"`
3. Make sure `server.js` is running, then: `node telegram-bot.js`

## 🛠️ Tech stack

`JavaScript` · `Node.js` · `Express` · `Fetch API` · `async/await` · `JSON file storage` · `Telegram Bot API` · `OpenAI-compatible LLM APIs`

## 📌 Roadmap

- [ ] WhatsApp Business Cloud API channel
- [ ] RAG: agents answer from uploaded documents
- [ ] User accounts & multi-tenancy
- [ ] SQLite persistence (concurrency-safe store)
