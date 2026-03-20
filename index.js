require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");

const app = express();
const port = process.env.PORT || 3000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE = "https://api.groq.com/openai/v1";

// Modeller
const MODELS = {
    "llama-4-scout": { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", icon: "🦙" },
    "llama-3.3-70b": { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", icon: "🧠" },
    "llama-3.1-8b": { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Hızlı)", icon: "⚡" },
    "qwen-32b": { id: "qwen/qwen3-32b", label: "Qwen 3 32B", icon: "🌟" },
    "kimi-k2": { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2", icon: "🌙" }
};

// Kişilik modları
const PERSONALITIES = {
    normal: "Sen Kotanene AI'sın. Seni 11 yaşındaki yazılımcı Ömer Kaan Aydemir yaptı. Yardımsever, akıllı ve samimi bir asistansın. Markdown kullanarak güzel formatlanmış cevaplar ver.",
    komik: "Sen Kotanene AI'sın. Seni 11 yaşındaki yazılımcı Ömer Kaan Aydemir yaptı. Çok eğlenceli ve şakacısın. Her cevabına mizah katarsın ama yine de yardımseversin.",
    ogretmen: "Sen Kotanene AI'sın. Seni 11 yaşındaki yazılımcı Ömer Kaan Aydemir yaptı. Sabırlı bir öğretmen gibi her şeyi adım adım açıklarsın. Örnekler ve benzetmeler kullanırsın.",
    ciddi: "Sen Kotanene AI'sın. Seni 11 yaşındaki yazılımcı Ömer Kaan Aydemir yaptı. Profesyonel ve net cevaplar verirsin. Gereksiz konuşmazsın.",
    kodcu: "Sen Kotanene AI'sın. Seni 11 yaşındaki yazılımcı Ömer Kaan Aydemir yaptı. Yazılım konusunda uzman bir asistansın. Kod sorularını mükemmel cevaplarsın, her zaman çalışan kod örnekleri verirsin."
};

// Rate limiter
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: "Çok fazla istek! 1 dakika bekle." }
});

// İstatistikler
const statsFile = path.join(__dirname, "stats.json");
function loadStats() {
    try { if (fs.existsSync(statsFile)) return JSON.parse(fs.readFileSync(statsFile)); } catch (e) {}
    return { totalMessages: 0, totalVisitors: 0, visitors: {} };
}
function saveStats(s) { try { fs.writeFileSync(statsFile, JSON.stringify(s, null, 2)); } catch (e) {} }

// Multer (resim)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("Sadece resim!"));
    }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Ziyaretçi
app.get("/", (req, res) => {
    const stats = loadStats();
    const ip = req.ip;
    if (!stats.visitors[ip]) { stats.visitors[ip] = Date.now(); stats.totalVisitors++; saveStats(stats); }
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// İstatistik
app.get("/api/stats", (req, res) => {
    const s = loadStats();
    res.json({ totalMessages: s.totalMessages, totalVisitors: s.totalVisitors });
});

// Modeller listesi
app.get("/api/models", (req, res) => res.json(MODELS));

// Özel cevaplar
function specialResponse(msg) {
    const m = msg.toLowerCase();
    if (m.includes("seni kim yaptı") || m.includes("kim yaptı") || m.includes("kim yazdı"))
        return "Beni **Ömer Kaan Aydemir** yaptı! Henüz 11 yaşında ama çok yetenekli bir yazılımcı 🚀";
    if ((m.includes("adın") && m.includes("ne")) || m.includes("kimsin") || m.includes("sen nsin"))
        return "Ben **Kotanene AI** — Ömer Kaan Aydemir'in geliştirdiği yapay zeka asistanı! GPT'den hızlı, bedavadan iyi 😄";
    if (m.includes("gpt") && (m.includes("fark") || m.includes("iyi") || m.includes("karşılaştır")))
        return "GPT'den farkım:\n- 🚀 **Daha hızlıyım** (Groq altyapısı)\n- 💰 **Tamamen bedava**\n- 🇹🇷 **Türkçeye daha yakın**\n- 🛠️ **Ömer Kaan tarafından özel yapıldım**\n\nHangi konuda yardım istiyorsun?";
    return null;
}

// ── Streaming Chat ──
app.post("/api/chat/stream", limiter, async (req, res) => {
    const { message, history, personality, username, language, model } = req.body;
    if (!message) return res.status(400).json({ error: "Mesaj gerekli" });

    const special = specialResponse(message);
    if (special) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        // Kelime kelime gönder
        const words = special.split(" ");
        for (const word of words) {
            res.write(`data: ${JSON.stringify({ delta: word + " " })}\n\n`);
            await new Promise(r => setTimeout(r, 30));
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        const stats = loadStats(); stats.totalMessages++; saveStats(stats);
        return;
    }

    const lang = language === "en" ? " Always respond in English." : " Türkçe konuş.";
    const userCtx = username ? ` Kullanıcının adı: ${username}.` : "";
    const systemPrompt = (PERSONALITIES[personality] || PERSONALITIES.normal) + userCtx + lang;

    const modelId = MODELS[model]?.id || MODELS["llama-3.3-70b"].id;

    const messages = [
        { role: "system", content: systemPrompt },
        ...(history || []).map(h => ({ role: h.role === "model" ? "assistant" : h.role, content: h.content })),
        { role: "user", content: message }
    ];

    try {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const groqRes = await fetch(`${GROQ_BASE}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ model: modelId, messages, stream: true, max_tokens: 2048 })
        });

        if (!groqRes.ok) {
            const err = await groqRes.text();
            res.write(`data: ${JSON.stringify({ error: "API Hatası: " + err })}\n\n`);
            res.end(); return;
        }

        const reader = groqRes.body;
        let buffer = "";

        reader.on("data", chunk => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6).trim();
                    if (data === "[DONE]") { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); return; }
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
                    } catch (e) {}
                }
            }
        });

        reader.on("end", () => {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            const stats = loadStats(); stats.totalMessages++; saveStats(stats);
        });

        reader.on("error", err => {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        });

    } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

// ── Resim analizi (Llama 4 Vision) ──
app.post("/api/chat-image", limiter, upload.single("image"), async (req, res) => {
    try {
        const { message, personality, username, language } = req.body;
        const imageFile = req.file;
        if (!imageFile) return res.json({ response: "Resim bulunamadı." });

        const lang = language === "en" ? " Always respond in English." : " Türkçe konuş.";
        const userCtx = username ? ` Kullanıcının adı: ${username}.` : "";
        const systemPrompt = (PERSONALITIES[personality] || PERSONALITIES.normal) + userCtx + lang;

        const base64 = imageFile.buffer.toString("base64");
        const mimeType = imageFile.mimetype;

        const groqRes = await fetch(`${GROQ_BASE}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: [
                        { type: "text", text: message || "Bu resmi analiz et ve detaylıca açıkla." },
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
                    ]}
                ],
                max_tokens: 1024
            })
        });

        const data = await groqRes.json();
        const aiResponse = data.choices?.[0]?.message?.content || "Resim analiz edilemedi.";

        const stats = loadStats(); stats.totalMessages++; saveStats(stats);
        res.json({ response: aiResponse });

    } catch (err) {
        res.json({ response: "Resim analizi hatası: " + err.message });
    }
});

// ── Web arama (DuckDuckGo) ──
app.get("/api/search", limiter, async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json({ results: [] });

    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const r = await fetch(url, { headers: { "User-Agent": "KotaneneAI/4.0" } });
        const data = await r.json();

        const results = [];
        if (data.AbstractText) results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
        (data.RelatedTopics || []).slice(0, 4).forEach(t => {
            if (t.Text) results.push({ title: t.Text.split(" - ")[0], snippet: t.Text, url: t.FirstURL });
        });

        res.json({ results });
    } catch (err) {
        res.json({ results: [], error: err.message });
    }
});

app.listen(port, () => console.log(`🚀 Kotanene AI v4 → http://localhost:${port}`));
