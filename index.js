require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "kotanene-v6-secret";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE = "https://api.groq.com/openai/v1";

// ── Veritabanı ──
const db = new Database(path.join(__dirname, "data", "kotanene.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    messages_today INTEGER DEFAULT 0,
    last_reset TEXT DEFAULT '',
    total_messages INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT DEFAULT 'Yeni Sohbet',
    model TEXT DEFAULT 'llama-3.3-70b',
    personality TEXT DEFAULT 'normal',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    role TEXT,
    content TEXT,
    type TEXT DEFAULT 'text',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total_messages INTEGER DEFAULT 0,
    total_visitors INTEGER DEFAULT 0,
    visitors TEXT DEFAULT '{}'
  );
  INSERT OR IGNORE INTO stats (id) VALUES (1);
`);

// ── Modeller ──
const MODELS = {
  "llama-4-scout": { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 🦙", desc: "En yeni, görsel anlayan" },
  "llama-3.3-70b": { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B 🧠", desc: "En akıllı, en güçlü" },
  "llama-3.1-8b": { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B ⚡", desc: "En hızlı" },
  "qwen-32b": { id: "qwen/qwen3-32b", label: "Qwen 3 32B 🌟", desc: "Çok dilli, güçlü" },
  "kimi-k2": { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2 🌙", desc: "Uzun bağlam" },
  "deepseek": { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 🔬", desc: "Akıl yürütme uzmanı" }
};

// ── Kişilikler ──
const PERSONALITIES = {
  normal: "Sen Kotanene AI'sın. Seni 11 yaşındaki yetenekli yazılımcı Ömer Kaan Aydemir yaptı. Yardımsever, akıllı ve samimi bir asistansın. Markdown kullan.",
  komik: "Sen Kotanene AI'sın. Seni Ömer Kaan Aydemir yaptı. Çok eğlenceli ve şakacısın, her zaman neşelisin ama yine de yardımseversin!",
  ogretmen: "Sen Kotanene AI'sın. Seni Ömer Kaan Aydemir yaptı. Sabırlı bir öğretmen gibi her şeyi adım adım, örneklerle açıklarsın.",
  ciddi: "Sen Kotanene AI'sın. Seni Ömer Kaan Aydemir yaptı. Profesyonel, kısa ve net cevaplar verirsin.",
  kodcu: "Sen Kotanene AI'sın. Seni Ömer Kaan Aydemir yaptı. Yazılım konusunda uzman bir asistansın. Her zaman çalışan, temiz kod yazarsın.",
  bilim: "Sen Kotanene AI'sın. Seni Ömer Kaan Aydemir yaptı. Bilim insanı gibi düşünürsün, kanıta dayalı, analitik cevaplar verirsin.",
  psikolog: "Sen Kotanene AI'sın. Seni Ömer Kaan Aydemir yaptı. Empatik ve anlayışlısın. İnsanların duygularını anlar, destekleyici cevaplar verirsin."
};

const PLAN_LIMITS = { free: 30, premium: 999999 };

// ── Middleware ──
const limiter = rateLimit({ windowMs: 60000, max: 40, message: { error: "Çok fazla istek!" } });
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg","image/png","image/gif","image/webp","application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain","text/javascript","application/json"];
    ok.includes(file.mimetype) ? cb(null, true) : cb(new Error("Desteklenmeyen dosya!"));
  }
});

// ── Auth helpers ──
function signToken(p) { return jwt.sign(p, JWT_SECRET, { expiresIn: "30d" }); }
function verifyToken(t) { try { return jwt.verify(t, JWT_SECRET); } catch { return null; } }
function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  return verifyToken(auth.split(" ")[1]);
}
function resetDaily(user) {
  const today = new Date().toDateString();
  if (user.last_reset !== today) {
    db.prepare("UPDATE users SET messages_today=0, last_reset=? WHERE id=?").run(today, user.id);
    user.messages_today = 0;
  }
  return user;
}

// ── Auth endpoints ──
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.json({ error: "Tüm alanları doldur!" });
    if (password.length < 6) return res.json({ error: "Şifre en az 6 karakter!" });
    const existing = db.prepare("SELECT id FROM users WHERE email=? OR username=?").get(email, username);
    if (existing) return res.json({ error: "Email veya kullanıcı adı zaten kullanılıyor!" });
    const hash = await bcrypt.hash(password, 10);
    const r = db.prepare("INSERT INTO users (username,email,password) VALUES (?,?,?)").run(username, email, hash);
    const token = signToken({ id: r.lastInsertRowid, username, plan: "free" });
    res.json({ token, username, plan: "free" });
  } catch (e) { res.json({ error: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user) return res.json({ error: "Email veya şifre yanlış!" });
    if (!await bcrypt.compare(password, user.password)) return res.json({ error: "Email veya şifre yanlış!" });
    const token = signToken({ id: user.id, username: user.username, plan: user.plan });
    res.json({ token, username: user.username, plan: user.plan });
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/api/auth/me", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ user: null });
  let user = db.prepare("SELECT id,username,email,plan,messages_today,total_messages,last_reset,created_at FROM users WHERE id=?").get(u.id);
  if (!user) return res.json({ user: null });
  user = resetDaily(user);
  const limit = PLAN_LIMITS[user.plan] || 30;
  const remaining = Math.max(0, limit - user.messages_today);
  res.json({ user: { ...user, limit, remaining } });
});

// ── Sohbet yönetimi ──
app.get("/api/chats", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json([]);
  const chats = db.prepare("SELECT * FROM chats WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(u.id);
  res.json(chats);
});

app.post("/api/chats", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ error: "Giriş gerekli" });
  const { title } = req.body;
  const r = db.prepare("INSERT INTO chats (user_id,title) VALUES (?,?)").run(u.id, title || "Yeni Sohbet");
  res.json({ id: r.lastInsertRowid, title: title || "Yeni Sohbet" });
});

app.get("/api/chats/:id/messages", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json([]);
  const chat = db.prepare("SELECT * FROM chats WHERE id=? AND user_id=?").get(req.params.id, u.id);
  if (!chat) return res.json([]);
  const msgs = db.prepare("SELECT * FROM messages WHERE chat_id=? ORDER BY created_at ASC").all(req.params.id);
  res.json(msgs);
});

app.delete("/api/chats/:id", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ error: "Giriş gerekli" });
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(req.params.id);
  db.prepare("DELETE FROM chats WHERE id=? AND user_id=?").run(req.params.id, u.id);
  res.json({ ok: true });
});

// ── Hafıza sistemi ──
app.get("/api/memories", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json([]);
  const mems = db.prepare("SELECT * FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 20").all(u.id);
  res.json(mems);
});

app.post("/api/memories", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ error: "Giriş gerekli" });
  const { content } = req.body;
  const r = db.prepare("INSERT INTO memories (user_id,content) VALUES (?,?)").run(u.id, content);
  res.json({ id: r.lastInsertRowid, content });
});

app.delete("/api/memories/:id", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ error: "Giriş gerekli" });
  db.prepare("DELETE FROM memories WHERE id=? AND user_id=?").run(req.params.id, u.id);
  res.json({ ok: true });
});

// ── Stats ──
app.get("/", (req, res) => {
  const ip = req.ip;
  const s = db.prepare("SELECT * FROM stats WHERE id=1").get();
  const v = JSON.parse(s.visitors || "{}");
  if (!v[ip]) { v[ip] = Date.now(); db.prepare("UPDATE stats SET total_visitors=total_visitors+1, visitors=? WHERE id=1").run(JSON.stringify(v)); }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/stats", (req, res) => {
  const s = db.prepare("SELECT * FROM stats WHERE id=1").get();
  res.json({ totalMessages: s.total_messages, totalVisitors: s.total_visitors });
});

app.get("/api/models", (req, res) => res.json(MODELS));

// ── Web arama ──
app.get("/api/search", limiter, async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ results: [] });
  try {
    const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, { headers: { "User-Agent": "KotaneneAI/6.0" } });
    const d = await r.json();
    const results = [];
    if (d.AbstractText) results.push({ title: d.Heading, snippet: d.AbstractText, url: d.AbstractURL });
    (d.RelatedTopics || []).slice(0, 5).forEach(t => { if (t.Text) results.push({ title: t.Text.split(" - ")[0], snippet: t.Text, url: t.FirstURL }); });
    res.json({ results });
  } catch { res.json({ results: [] }); }
});

// ── Görsel oluşturma ──
app.post("/api/generate-image", limiter, async (req, res) => {
  try {
    const { prompt, language } = req.body;
    if (!prompt) return res.json({ error: "Prompt gerekli" });
    let eng = prompt;
    if (language !== "en") {
      try {
        const tr = await fetch(`${GROQ_BASE}/chat/completions`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: `Translate to English (image prompt only, no explanation): ${prompt}` }], max_tokens: 150 })
        });
        const td = await tr.json();
        eng = td.choices?.[0]?.message?.content?.trim() || prompt;
      } catch {}
    }
    const seed = Math.floor(Math.random() * 999999);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(eng)}?width=768&height=768&seed=${seed}&nologo=true&enhance=true&model=flux`;
    res.json({ imageUrl, prompt: eng });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Kod çalıştırma (Python via pyodide analizi) ──
app.post("/api/analyze-code", limiter, async (req, res) => {
  try {
    const { code, language: lang } = req.body;
    const r = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Sen bir kod analiz uzmanısın. Verilen kodu analiz et, hataları bul, çıktıyı tahmin et ve iyileştirme öner. Türkçe cevap ver." },
          { role: "user", content: `${lang || 'Kod'} analiz et:\n\`\`\`\n${code}\n\`\`\`` }
        ],
        max_tokens: 1500
      })
    });
    const d = await r.json();
    res.json({ analysis: d.choices?.[0]?.message?.content || "Analiz yapılamadı." });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Matematik çözme ──
app.post("/api/math", limiter, async (req, res) => {
  try {
    const { problem } = req.body;
    const r = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-r1-distill-llama-70b",
        messages: [
          { role: "system", content: "Sen bir matematik uzmanısın. Adım adım çöz, formülleri göster, sonucu açıkla. Türkçe cevap ver." },
          { role: "user", content: problem }
        ],
        max_tokens: 2000
      })
    });
    const d = await r.json();
    res.json({ solution: d.choices?.[0]?.message?.content || "Çözülemedi." });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Metin özeti ──
app.post("/api/summarize", limiter, async (req, res) => {
  try {
    const { text, length = "orta" } = req.body;
    const r = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: `Metni ${length === 'kısa' ? '3-4 cümle' : length === 'uzun' ? 'detaylı' : '1 paragraf'} ile özetle. Türkçe.` },
          { role: "user", content: text }
        ],
        max_tokens: 800
      })
    });
    const d = await r.json();
    res.json({ summary: d.choices?.[0]?.message?.content || "Özetlenemedi." });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Çeviri ──
app.post("/api/translate", limiter, async (req, res) => {
  try {
    const { text, to } = req.body;
    const r = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: `Sadece çeviriyi ver, başka hiçbir şey yazma. Hedef dil: ${to || 'İngilizce'}` },
          { role: "user", content: text }
        ],
        max_tokens: 1000
      })
    });
    const d = await r.json();
    res.json({ translation: d.choices?.[0]?.message?.content?.trim() || "Çevirilemedi." });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Dosya analizi ──
app.post("/api/chat-file", limiter, upload.single("file"), async (req, res) => {
  try {
    const { message, personality, username, language, model } = req.body;
    const file = req.file;
    if (!file) return res.json({ response: "Dosya bulunamadı." });

    const lang = language === "en" ? " Always respond in English." : " Türkçe konuş.";
    const userCtx = username ? ` Kullanıcı: ${username}.` : "";
    const systemPrompt = (PERSONALITIES[personality] || PERSONALITIES.normal) + userCtx + lang;

    let userContent;
    if (file.mimetype.startsWith("image/")) {
      userContent = [
        { type: "text", text: message || "Bu resmi detaylıca analiz et." },
        { type: "image_url", image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}` } }
      ];
    } else if (file.mimetype === "application/pdf") {
      let text = "";
      try { const pdf = require("pdf-parse"); const d = await pdf(file.buffer); text = d.text.slice(0, 8000); } catch {}
      userContent = [{ type: "text", text: `${message || "Bu dosyayı analiz et:"}\n\nDosya içeriği:\n${text}` }];
    } else if (file.mimetype.includes("wordprocessingml")) {
      let text = "";
      try { const mammoth = require("mammoth"); const r = await mammoth.extractRawText({ buffer: file.buffer }); text = r.value.slice(0, 8000); } catch {}
      userContent = [{ type: "text", text: `${message || "Bu dosyayı analiz et:"}\n\n${text}` }];
    } else {
      const text = file.buffer.toString("utf-8").slice(0, 8000);
      userContent = [{ type: "text", text: `${message || "Bu dosyayı analiz et:"}\n\n${text}` }];
    }

    const modelId = file.mimetype.startsWith("image/") ? MODELS["llama-4-scout"].id : (MODELS[model]?.id || MODELS["llama-3.3-70b"].id);

    const r = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }], max_tokens: 2000 })
    });
    const d = await r.json();
    const response = d.choices?.[0]?.message?.content || "Dosya analiz edilemedi.";
    db.prepare("UPDATE stats SET total_messages=total_messages+1 WHERE id=1").run();
    res.json({ response });
  } catch (e) { res.json({ response: "Hata: " + e.message }); }
});

// ── Streaming Chat (Ana endpoint) ──
app.post("/api/chat/stream", limiter, async (req, res) => {
  const { message, history, personality, username, language, model, chatId, useWebSearch, useMath } = req.body;
  if (!message) return res.status(400).json({ error: "Mesaj gerekli" });

  const u = getUser(req);
  if (u) {
    let user = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
    if (user) {
      user = resetDaily(user);
      const limit = PLAN_LIMITS[user.plan] || 30;
      if (user.messages_today >= limit) {
        res.setHeader("Content-Type", "text/event-stream");
        res.write(`data: ${JSON.stringify({ error: "⚠️ Günlük mesaj limitin doldu! Premium'a geç → sınırsız kullan." })}\n\n`);
        return res.end();
      }
      db.prepare("UPDATE users SET messages_today=messages_today+1, total_messages=total_messages+1 WHERE id=?").run(u.id);
    }
  }

  // Web arama
  let searchContext = "";
  if (useWebSearch) {
    try {
      const sr = await fetch(`http://localhost:${port}/api/search?q=${encodeURIComponent(message)}`);
      const sd = await sr.json();
      if (sd.results?.length) {
        searchContext = "\n\n[Web Arama Sonuçları]:\n" + sd.results.slice(0,3).map(r => `• ${r.title}: ${r.snippet}`).join("\n");
      }
    } catch {}
  }

  // Hafıza
  let memoryContext = "";
  if (u) {
    const mems = db.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 5").all(u.id);
    if (mems.length) memoryContext = "\n\n[Kullanıcı Hafızası]:\n" + mems.map(m => `• ${m.content}`).join("\n");
  }

  const lang = language === "en" ? " Always respond in English." : " Türkçe konuş.";
  const userCtx = username ? ` Kullanıcının adı: ${username}.` : "";
  const systemPrompt = (PERSONALITIES[personality] || PERSONALITIES.normal) + userCtx + lang + memoryContext;
  const modelId = MODELS[model]?.id || MODELS["llama-3.3-70b"].id;

  const finalMessage = message + searchContext;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(history || []).map(h => ({ role: h.role === "model" ? "assistant" : h.role, content: h.content })),
    { role: "user", content: finalMessage }
  ];

  // Özel cevaplar
  const m = message.toLowerCase();
  if (m.includes("seni kim yaptı") || m.includes("kim yazdı") || m.includes("kim yaptı")) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    const reply = "Beni **Ömer Kaan Aydemir** yaptı! 11 yaşında ama gerçekten çok yetenekli bir yazılımcı 🚀";
    for (const w of reply.split(" ")) { res.write(`data: ${JSON.stringify({ delta: w + " " })}\n\n`); await new Promise(r => setTimeout(r, 25)); }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    db.prepare("UPDATE stats SET total_messages=total_messages+1 WHERE id=1").run();
    return res.end();
  }

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const groqRes = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages, stream: true, max_tokens: 4096, temperature: 0.7 })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      res.write(`data: ${JSON.stringify({ error: "API Hatası: " + err })}\n\n`);
      return res.end();
    }

    let fullText = "";
    let buf = "";
    const reader = groqRes.body;

    reader.on("data", chunk => {
      buf += chunk.toString();
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) { fullText += delta; res.write(`data: ${JSON.stringify({ delta })}\n\n`); }
          } catch {}
        }
      }
    });

    reader.on("end", () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      db.prepare("UPDATE stats SET total_messages=total_messages+1 WHERE id=1").run();
      // Sohbete kaydet
      if (chatId && u) {
        db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chatId, "user", message);
        db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chatId, "assistant", fullText);
        const cnt = db.prepare("SELECT COUNT(*) as c FROM messages WHERE chat_id=?").get(chatId);
        if (cnt.c <= 2) db.prepare("UPDATE chats SET title=? WHERE id=?").run(message.slice(0,45), chatId);
      }
      // Otomatik hafıza (önemli bilgi varsa kaydet)
      if (u && fullText.length > 50) {
        const shouldSave = message.toLowerCase().includes("adım") || message.toLowerCase().includes("seviyorum") ||
          message.toLowerCase().includes("çalışıyorum") || message.toLowerCase().includes("öğrenciyim");
        if (shouldSave) {
          const mems = db.prepare("SELECT COUNT(*) as c FROM memories WHERE user_id=?").get(u.id);
          if (mems.c < 20) db.prepare("INSERT INTO memories (user_id,content) VALUES (?,?)").run(u.id, `Kullanıcı şunu söyledi: "${message.slice(0,100)}"`);
        }
      }
    });

    reader.on("error", e => { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); });
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// ── Premium ──
app.post("/api/upgrade", (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ error: "Giriş gerekli" });
  db.prepare("UPDATE users SET plan='premium' WHERE id=?").run(u.id);
  const token = signToken({ id: u.id, username: u.username, plan: "premium" });
  res.json({ token, plan: "premium" });
});

app.listen(port, () => console.log(`🚀 Kotanene AI v6 → http://localhost:${port}`));
