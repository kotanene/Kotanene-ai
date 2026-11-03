// ── State ──
let token = localStorage.getItem("kt") || null;
let currentUser = null;
let history = [];
let lang = "tr";
let personality = "normal";
let model = "gpt-oss-120b";
let pendingFile = null;
let isGenerating = false;
let currentChatId = null;
let allChats = [];
let activeTool = null;

// ── Marked ──
marked.setOptions({ breaks: true, gfm: true });
const renderer = new marked.Renderer();
renderer.code = (code, l) => {
    const esc = code.replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return `<div style="position:relative"><button class="code-copy" onclick="copyCode(this)">Kopyala</button><pre><code>${esc}</code></pre></div>`;
};
marked.setOptions({ renderer });

function copyCode(btn) {
    navigator.clipboard.writeText(btn.nextElementSibling.querySelector("code").textContent).then(() => {
        btn.textContent = "✓"; btn.style.color = "#22c55e";
        setTimeout(() => { btn.textContent = "Kopyala"; btn.style.color = ""; }, 2000);
    });
}

// ── Init ──
window.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    setTimeout(async () => {
        document.getElementById("splash").classList.add("out");
        await init();
    }, 2400);
});

async function init() {
    document.getElementById("layout").style.display = "flex";
    loadModels(); loadStats();
    if (token) {
        try {
            const r = await api("/api/auth/me");
            if (r.user) { currentUser = r.user; updateUserUI(); loadChats(); return; }
        } catch {}
        token = null; localStorage.removeItem("kt");
    }
    document.getElementById("authOverlay").style.display = "flex";
}

// ── Theme ──
function initTheme() {
    const t = localStorage.getItem("kt_theme") || "dark";
    document.documentElement.setAttribute("data-theme", t);
    updateThemeIcons(t);
}
function toggleTheme() {
    const c = document.documentElement.getAttribute("data-theme");
    const n = c === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    localStorage.setItem("kt_theme", n);
    updateThemeIcons(n);
}
function updateThemeIcons(t) {
    const i = t === "dark" ? "☀️" : "🌙";
    document.getElementById("themeBtn").textContent = i + " Tema";
    document.getElementById("themeTopBtn").textContent = i;
}
document.getElementById("themeBtn").addEventListener("click", toggleTheme);
document.getElementById("themeTopBtn").addEventListener("click", toggleTheme);

// ── Auth ──
function switchTab(tab) {
    document.getElementById("loginForm").style.display = tab === "login" ? "block" : "none";
    document.getElementById("regForm").style.display = tab === "register" ? "block" : "none";
    document.querySelectorAll(".tab").forEach((t,i) => t.classList.toggle("active", (i===0&&tab==="login")||(i===1&&tab==="register")));
    document.getElementById("authErr").textContent = "";
}

async function doLogin() {
    const email = document.getElementById("loginEmail").value.trim();
    const pass = document.getElementById("loginPass").value;
    if (!email || !pass) return showAuthErr("Tüm alanları doldur!");
    const r = await api("/api/auth/login", "POST", { email, password: pass });
    if (r.error) return showAuthErr(r.error);
    token = r.token; localStorage.setItem("kt", token);
    currentUser = { username: r.username, plan: r.plan };
    document.getElementById("authOverlay").style.display = "none";
    updateUserUI(); loadChats();
}

async function doRegister() {
    const username = document.getElementById("regUser").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const pass = document.getElementById("regPass").value;
    if (!username || !email || !pass) return showAuthErr("Tüm alanları doldur!");
    const r = await api("/api/auth/register", "POST", { username, email, password: pass });
    if (r.error) return showAuthErr(r.error);
    token = r.token; localStorage.setItem("kt", token);
    currentUser = { username: r.username, plan: r.plan };
    document.getElementById("authOverlay").style.display = "none";
    updateUserUI(); loadChats();
}

function guestMode() {
    currentUser = { username: "Misafir", plan: "free" };
    document.getElementById("authOverlay").style.display = "none";
    updateUserUI();
}

function showAuthErr(msg) { document.getElementById("authErr").textContent = msg; }

document.getElementById("logoutBtn").addEventListener("click", () => {
    token = null; localStorage.removeItem("kt"); location.reload();
});

// ── User UI ──
function updateUserUI() {
    if (!currentUser) return;
    const name = currentUser.username || "Misafir";
    document.getElementById("userName").textContent = name;
    document.getElementById("userPlan").textContent = currentUser.plan === "premium" ? "👑 Premium" : "Ücretsiz";
    document.getElementById("userAva").textContent = name[0].toUpperCase();
    if (currentUser.plan === "premium") { document.getElementById("usageWrap").style.display = "none"; return; }
    const used = currentUser.messages_today || 0;
    const limit = currentUser.limit || 30;
    const pct = Math.min(100, (used / limit) * 100);
    document.getElementById("usageTxt").textContent = `${used}/${limit} mesaj`;
    document.getElementById("usageFill").style.width = pct + "%";
    document.getElementById("usageFill").style.background = pct > 80 ? "#ef4444" : "";
}

// ── Premium ──
function openPremium() { document.getElementById("premiumOverlay").style.display = "flex"; }
function closePremium() { document.getElementById("premiumOverlay").style.display = "none"; }
async function doUpgrade() {
    if (!token) return alert("Önce giriş yapmalısın!");
    const r = await api("/api/upgrade", "POST");
    if (r.token) { token = r.token; localStorage.setItem("kt", token); if (currentUser) currentUser.plan = "premium"; updateUserUI(); closePremium(); addMsg("🎉 Premium'a yükseltildin! Artık sınırsız mesaj gönderebilirsin!", false); }
}

// ── Hafıza ──
function openMemory() { loadMemories(); document.getElementById("memoryOverlay").style.display = "flex"; }
function closeMemory() { document.getElementById("memoryOverlay").style.display = "none"; }

async function loadMemories() {
    if (!token) return;
    const mems = await api("/api/memories");
    const list = document.getElementById("memoryList");
    list.innerHTML = mems.length === 0 ? '<div style="color:var(--t3);font-size:.78rem;text-align:center;padding:12px">Henüz hafıza yok</div>' :
        mems.map(m => `<div class="mem-item"><span>${m.content}</span><button onclick="deleteMemory(${m.id})">✕</button></div>`).join("");
}

async function addMemory() {
    const content = document.getElementById("newMemory").value.trim();
    if (!content || !token) return;
    await api("/api/memories", "POST", { content });
    document.getElementById("newMemory").value = "";
    loadMemories();
}

async function deleteMemory(id) {
    await api(`/api/memories/${id}`, "DELETE");
    loadMemories();
}

// ── Görsel oluşturma ──
function openImgGen() { document.getElementById("imgGenOverlay").style.display = "flex"; }
function closeImgGen() { document.getElementById("imgGenOverlay").style.display = "none"; }

async function generateImage() {
    const prompt = document.getElementById("imgPrompt").value.trim();
    if (!prompt) return;
    const btn = document.getElementById("genBtn");
    btn.disabled = true; btn.textContent = "Oluşturuluyor... ✨";
    document.getElementById("imgResult").innerHTML = '<div style="color:var(--t2);font-size:.82rem;padding:16px;text-align:center">🎨 Görsel hazırlanıyor, 10-30 saniye sürebilir...</div>';
    try {
        const r = await api("/api/generate-image", "POST", { prompt, language: lang });
        if (r.error) throw new Error(r.error);
        document.getElementById("imgResult").innerHTML = `
            <img src="${r.imageUrl}" onload="this.style.opacity=1" style="opacity:0;transition:opacity .5s;max-width:100%;border-radius:12px;border:1px solid var(--b1)">
            <div class="img-actions">
                <button class="img-action-btn" onclick="sendGenImg('${r.imageUrl}','${r.prompt.replace(/'/g,"\\'")}')">💬 Sohbete Ekle</button>
                <a href="${r.imageUrl}" target="_blank" class="img-action-btn">↗ Tam Boy</a>
            </div>`;
    } catch (e) {
        document.getElementById("imgResult").innerHTML = `<div style="color:#ef4444;font-size:.8rem">${e.message}</div>`;
    } finally { btn.disabled = false; btn.textContent = "✨ Oluştur"; }
}

function sendGenImg(url, prompt) {
    const ws = document.getElementById("welcome");
    if (ws) ws.style.display = "none";
    const msgDiv = document.createElement("div");
    msgDiv.className = "message ai";
    const ava = document.createElement("div");
    ava.className = "ava"; ava.textContent = "✦";
    const bwrap = document.createElement("div");
    bwrap.className = "bwrap";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = `<img src="${url}" style="max-width:260px;border-radius:10px;border:1px solid var(--b1)"><div style="font-size:.72rem;color:var(--t3);margin-top:5px;font-style:italic">${prompt}</div>`;
    bwrap.appendChild(bubble);
    msgDiv.appendChild(ava); msgDiv.appendChild(bwrap);
    document.getElementById("messages").appendChild(msgDiv);
    document.getElementById("messages").scrollTop = 999999;
    closeImgGen();
}

// ── Araçlar ──
function openTools() { document.getElementById("toolsOverlay").style.display = "flex"; document.getElementById("toolArea").style.display = "none"; document.getElementById("toolResult").innerHTML = ""; }
function closeTools() { document.getElementById("toolsOverlay").style.display = "none"; }

function runTool(tool) {
    activeTool = tool;
    document.getElementById("toolArea").style.display = "block";
    document.getElementById("toolLang").style.display = tool === "translate" ? "block" : "none";
    const placeholders = { math: "Matematik sorusunu yaz...", summary: "Özetlenecek metni yaz...", translate: "Çevrilecek metni yaz...", code: "Analiz edilecek kodu yaz..." };
    document.getElementById("toolInput").placeholder = placeholders[tool] || "Metni yaz...";
    document.getElementById("toolInput").value = "";
    document.getElementById("toolResult").innerHTML = "";
}

async function executeTool() {
    const text = document.getElementById("toolInput").value.trim();
    if (!text) return;
    const btn = document.getElementById("toolRunBtn");
    btn.disabled = true; btn.textContent = "İşleniyor...";
    document.getElementById("toolResult").innerHTML = '<div style="color:var(--t2);font-size:.8rem">⟳ İşleniyor...</div>';
    try {
        let result = "";
        if (activeTool === "math") { const r = await api("/api/math", "POST", { problem: text }); result = r.solution; }
        else if (activeTool === "summary") { const r = await api("/api/summarize", "POST", { text }); result = r.summary; }
        else if (activeTool === "translate") { const to = document.getElementById("translateTo").value; const r = await api("/api/translate", "POST", { text, to }); result = r.translation; }
        else if (activeTool === "code") { const r = await api("/api/analyze-code", "POST", { code: text }); result = r.analysis; }
        document.getElementById("toolResult").innerHTML = marked.parse(result || "Hata oluştu.");
    } catch (e) {
        document.getElementById("toolResult").innerHTML = `<div style="color:#ef4444">${e.message}</div>`;
    } finally { btn.disabled = false; btn.textContent = "Çalıştır"; }
}

// ── Modeller ──
async function loadModels() {
    try {
        const models = await api("/api/models");
        const list = document.getElementById("modelList");
        list.innerHTML = "";
        for (const [key, m] of Object.entries(models)) {
            const btn = document.createElement("button");
            btn.className = "model-btn" + (key === model ? " active" : "");
            btn.textContent = m.label;
            btn.title = m.desc || "";
            btn.addEventListener("click", () => {
                model = key;
                document.getElementById("modelLabel").textContent = m.label;
                list.querySelectorAll(".model-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            });
            list.appendChild(btn);
        }
    } catch {}
}

// ── Kişilik & Dil ──
document.querySelectorAll(".pers").forEach(btn => {
    btn.addEventListener("click", () => {
        personality = btn.dataset.p;
        document.querySelectorAll(".pers").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    });
});
document.querySelectorAll(".lang").forEach(btn => {
    btn.addEventListener("click", () => {
        lang = btn.dataset.lang;
        document.querySelectorAll(".lang").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    });
});

// ── Sidebar ──
const sidebar = document.getElementById("sidebar");
const sbOverlay = document.getElementById("sbOverlay");
document.getElementById("menuBtn").addEventListener("click", () => { sidebar.classList.add("open"); sbOverlay.classList.add("show"); });
document.getElementById("sbClose").addEventListener("click", closeSb);
sbOverlay.addEventListener("click", closeSb);
function closeSb() { sidebar.classList.remove("open"); sbOverlay.classList.remove("show"); }

// ── Stats ──
async function loadStats() {
    try { const d = await api("/api/stats"); document.getElementById("sbStats").textContent = `👥 ${d.totalVisitors} · 💬 ${d.totalMessages}`; } catch {}
}

// ── Sohbet listesi ──
async function loadChats() {
    if (!token) return;
    try { allChats = await api("/api/chats"); renderChats(allChats); } catch {}
}

function renderChats(chats) {
    const list = document.getElementById("chatList");
    if (!chats || !chats.length) { list.innerHTML = '<div style="padding:10px;font-size:.72rem;color:var(--t3);text-align:center">Henüz sohbet yok</div>'; return; }
    list.innerHTML = "";
    chats.forEach(c => {
        const item = document.createElement("div");
        item.className = "chat-item" + (c.id === currentChatId ? " active" : "");
        item.innerHTML = `<span class="chat-title">💬 ${c.title}</span><button class="chat-del" onclick="deleteChat(event,${c.id})">🗑</button>`;
        item.addEventListener("click", () => loadChat(c.id));
        list.appendChild(item);
    });
}

function filterChats() {
    const q = document.getElementById("chatSearch").value.toLowerCase();
    renderChats(allChats.filter(c => c.title.toLowerCase().includes(q)));
}

async function loadChat(chatId) {
    currentChatId = chatId; history = [];
    const msgs = document.getElementById("messages");
    msgs.innerHTML = "";
    try {
        const messages = await api(`/api/chats/${chatId}/messages`);
        messages.forEach(m => {
            addMsg(m.content, m.role === "user");
            history.push({ role: m.role === "assistant" ? "model" : m.role, content: m.content });
        });
    } catch {}
    renderChats(allChats); closeSb();
    document.getElementById("messages").scrollTop = 999999;
}

async function deleteChat(e, id) {
    e.stopPropagation();
    await api(`/api/chats/${id}`, "DELETE");
    allChats = allChats.filter(c => c.id !== id);
    if (currentChatId === id) { currentChatId = null; history = []; newChat(); }
    renderChats(allChats);
}

document.getElementById("newChatBtn").addEventListener("click", newChat);
function newChat() {
    history = []; currentChatId = null;
    const msgs = document.getElementById("messages");
    msgs.innerHTML = "";
    const w = document.createElement("div");
    w.className = "welcome"; w.id = "welcome";
    w.innerHTML = `<div class="w-orb">✦</div><h1>Kotanene AI</h1><p>GPT'den hızlı · Bedavadan iyi · 4 farklı model</p><div class="sugs"><button class="sug" onclick="useSug(this)">Python ile web scraper yaz</button><button class="sug" onclick="useSug(this)">Yapay zeka nasıl çalışır?</button><button class="sug" onclick="useSug(this)">Matematik ödevime yardım et</button><button class="sug" onclick="useSug(this)">Bir şiir yazar mısın?</button><button class="sug" onclick="useSug(this)">Motivasyon için ne yapmalıyım?</button><button class="sug" onclick="useSug(this)">React ile proje nasıl başlatılır?</button></div>`;
    msgs.appendChild(w);
    closeSb();
}

// ── Web arama ──
document.getElementById("webSearchToggle").addEventListener("click", () => {
    const bar = document.getElementById("webBar");
    bar.style.display = bar.style.display === "none" ? "flex" : "none";
    if (bar.style.display === "flex") document.getElementById("webQ").focus();
});
function closeWebBar() { document.getElementById("webBar").style.display = "none"; document.getElementById("webResults").style.display = "none"; }
document.getElementById("webQ").addEventListener("keydown", e => { if (e.key === "Enter") doWebSearch(); });
window._sr = [];
async function doWebSearch() {
    const q = document.getElementById("webQ").value.trim();
    const engine = document.getElementById("searchEngine").value;
    if (!q) return;
    const rd = document.getElementById("webResults");
    rd.style.display = "block"; rd.innerHTML = '<div style="color:var(--t2);font-size:.75rem;padding:6px">Aranıyor...</div>';
    try {
        const d = await api(`/api/search?q=${encodeURIComponent(q)}&engine=${engine}`);
        window._sr = d.results || [];
        window._se = d.engine || engine;
        rd.innerHTML = window._sr.length === 0 ? '<div style="color:var(--t3);font-size:.75rem;padding:6px">Sonuç yok.</div>' :
            window._sr.map((r,i) => `<div class="web-result" onclick="useWebResult(${i})"><div class="web-result-title">${r.title||""}</div><div class="web-result-snippet">${(r.snippet||"").slice(0,110)}...</div></div>`).join("");
    } catch { rd.innerHTML = '<div style="color:#ef4444;font-size:.75rem;padding:6px">Hata.</div>'; }
}
function useWebResult(i) {
    const r = window._sr[i];
    if (!r) return;
    document.getElementById("userInput").value = `"${r.title}" hakkında bilgi ver: ${r.snippet}`;
    updateSendBtn(); closeWebBar();
}

// ── Araç toggle ──
document.getElementById("toolOptBtn").addEventListener("click", () => {
    const opts = document.getElementById("toolOpts");
    opts.style.display = opts.style.display === "none" ? "flex" : "none";
});

// ── Mesaj arama ──
document.getElementById("msgSearchBtn").addEventListener("click", () => {
    const bar = document.getElementById("msgBar");
    bar.style.display = bar.style.display === "none" ? "flex" : "none";
    if (bar.style.display === "flex") document.getElementById("msgQ").focus();
});
function closeMsgBar() { document.getElementById("msgBar").style.display = "none"; document.querySelectorAll(".message.highlighted").forEach(m => m.classList.remove("highlighted")); }
function searchMsgs() {
    const q = document.getElementById("msgQ").value.toLowerCase().trim();
    document.querySelectorAll(".message").forEach(m => {
        const txt = m.querySelector(".bubble")?.textContent?.toLowerCase() || "";
        m.classList.toggle("highlighted", q.length > 0 && txt.includes(q));
    });
    const first = document.querySelector(".message.highlighted");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── Dışa aktar ──
document.getElementById("exportBtn").addEventListener("click", () => {
    if (!history.length) return;
    const lines = history.map(h => (h.role==="user"?"👤 Sen":"🤖 Kotanene AI")+":\n"+h.content).join("\n\n"+"─".repeat(40)+"\n\n");
    const blob = new Blob(["Kotanene AI v6\n"+new Date().toLocaleString("tr-TR")+"\n\n"+lines], {type:"text/plain;charset=utf-8"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "kotanene-"+Date.now()+".txt"; a.click();
});

// ── Dosya ──
document.getElementById("fileBtn").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change", e => {
    const file = e.target.files[0]; if (!file) return;
    pendingFile = file;
    const icon = file.type === "application/pdf" ? "📄" : file.type.startsWith("image/") ? "🖼" : "📎";
    document.getElementById("fileIcon").textContent = icon;
    document.getElementById("fileName").textContent = file.name;
    document.getElementById("filePrev").style.display = "flex";
    updateSendBtn();
});
function removeFile() { pendingFile = null; document.getElementById("fileInput").value = ""; document.getElementById("filePrev").style.display = "none"; updateSendBtn(); }

// ── Ses ──
document.getElementById("voiceBtn").addEventListener("click", async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return addMsg("Tarayıcın ses tanımayı desteklemiyor.", false);
    const r = new SR(); r.lang = lang === "tr" ? "tr-TR" : "en-US";
    document.getElementById("recBar").style.display = "flex";
    r.onresult = e => { document.getElementById("userInput").value = e.results[0][0].transcript; updateSendBtn(); };
    r.onend = () => document.getElementById("recBar").style.display = "none";
    r.start();
    document.getElementById("stopRec").onclick = () => r.stop();
});

// ── Öneri ──
function useSug(btn) { document.getElementById("userInput").value = btn.textContent.trim(); updateSendBtn(); sendMessage(); }

// ── Input ──
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
userInput.addEventListener("input", function() {
    this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 140) + "px";
    document.getElementById("charCount").textContent = this.value.length;
    updateSendBtn();
});
userInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
sendBtn.addEventListener("click", sendMessage);
function updateSendBtn() { sendBtn.disabled = (!userInput.value.trim() && !pendingFile) || isGenerating; }

// ── Mesaj ekleme ──
function addMsg(text, isUser, imgUrl = null) {
    const w = document.getElementById("welcome");
    if (w) w.style.display = "none";
    const msgDiv = document.createElement("div");
    msgDiv.className = "message " + (isUser ? "user" : "ai");
    const ava = document.createElement("div");
    ava.className = "ava";
    ava.textContent = isUser ? (currentUser?.username?.[0]?.toUpperCase() || "S") : "✦";
    const bwrap = document.createElement("div"); bwrap.className = "bwrap";
    if (imgUrl) { const img = document.createElement("img"); img.src = imgUrl; img.className = "msg-img"; bwrap.appendChild(img); }
    const bubble = document.createElement("div"); bubble.className = "bubble";
    if (isUser) bubble.textContent = text;
    else bubble.innerHTML = marked.parse(text || "");
    bwrap.appendChild(bubble);
    if (!isUser && text) {
        const acts = document.createElement("div"); acts.className = "bactions";
        const cb = document.createElement("button"); cb.className = "bact"; cb.textContent = "📋 Kopyala";
        cb.onclick = () => { navigator.clipboard.writeText(text.replace(/[*_`#>~]/g,"").trim()).then(() => { cb.textContent="✅"; cb.classList.add("ok"); setTimeout(()=>{cb.textContent="📋 Kopyala";cb.classList.remove("ok");},2000); }); };
        acts.appendChild(cb); bwrap.appendChild(acts);
    }
    msgDiv.appendChild(ava); msgDiv.appendChild(bwrap);
    document.getElementById("messages").appendChild(msgDiv);
    document.getElementById("messages").scrollTop = 999999;
    return { msgDiv, bubble, bwrap };
}

function showTyping() { const {msgDiv,bubble} = addMsg("",false); bubble.innerHTML='<div class="typing"><span></span><span></span><span></span></div>'; msgDiv.id="typing"; }
function hideTyping() { document.getElementById("typing")?.remove(); }

// ── GÖNDER ──
async function sendMessage() {
    const text = userInput.value.trim();
    if ((!text && !pendingFile) || isGenerating) return;
    isGenerating = true; sendBtn.disabled = true;
    const fileUrl = pendingFile?.type?.startsWith("image/") ? URL.createObjectURL(pendingFile) : null;
    addMsg(text || (pendingFile?.type === "application/pdf" ? "📄 PDF" : "📎 Dosya"), true, fileUrl);
    userInput.value = ""; userInput.style.height = "auto";
    document.getElementById("charCount").textContent = "0";
    showTyping();

    try {
        if (!currentChatId && token) {
            const c = await api("/api/chats", "POST", { title: text.slice(0,45) || "Yeni Sohbet" });
            currentChatId = c.id; allChats.unshift(c); renderChats(allChats);
        }

        const useWeb = document.getElementById("optWeb")?.checked || false;
        const searchEngine = document.getElementById("searchEngine")?.value || "duckduckgo";

        if (pendingFile) {
            const fd = new FormData();
            fd.append("file", pendingFile);
            fd.append("message", text || "Bu dosyayı analiz et.");
            fd.append("personality", personality); fd.append("username", currentUser?.username || "");
            fd.append("language", lang); fd.append("model", model);
            const r = await fetch("/api/chat-file", { method:"POST", headers: token ? {"Authorization":"Bearer "+token} : {}, body: fd });
            const d = await r.json();
            hideTyping(); addMsg(d.response || "Hata.", false);
            history.push({role:"user",content:text||"dosya"}); history.push({role:"model",content:d.response});
            pendingFile = null; document.getElementById("fileInput").value = "";
            document.getElementById("filePrev").style.display = "none";
        } else {
            const res = await fetch("/api/chat/stream", {
                method: "POST",
                headers: {"Content-Type":"application/json", ...(token?{"Authorization":"Bearer "+token}:{})},
                body: JSON.stringify({ message:text, history, personality, username:currentUser?.username||"", language:lang, model, chatId:currentChatId, useWebSearch:useWeb, searchEngine:searchEngine })
            });
            hideTyping();
            const {msgDiv, bubble, bwrap} = addMsg("", false);
            let full = "";
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                buf += dec.decode(value, {stream:true});
                const lines = buf.split("\n"); buf = lines.pop();
                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const j = JSON.parse(line.slice(6));
                            if (j.error) { bubble.innerHTML = "⚠️ " + j.error; if (j.error.includes("Premium")) openPremium(); break; }
                            if (j.done) break;
                            if (j.delta) { full += j.delta; bubble.innerHTML = marked.parse(full); document.getElementById("messages").scrollTop = 999999; }
                        } catch {}
                    }
                }
            }
            if (full) {
                const acts = document.createElement("div"); acts.className = "bactions";
                const cb = document.createElement("button"); cb.className = "bact"; cb.textContent = "📋 Kopyala";
                cb.onclick = () => { navigator.clipboard.writeText(full.replace(/[*_`#>~]/g,"").trim()).then(()=>{cb.textContent="✅";cb.classList.add("ok");setTimeout(()=>{cb.textContent="📋 Kopyala";cb.classList.remove("ok");},2000);}); };
                acts.appendChild(cb); bwrap.appendChild(acts);
            }
            history.push({role:"user",content:text}); history.push({role:"model",content:full});
        }
        if (history.length > 30) history = history.slice(-30);
        loadStats();
        if (token) { try { const me = await api("/api/auth/me"); if (me.user) { currentUser = me.user; updateUserUI(); } } catch {} }
    } catch (e) { hideTyping(); addMsg("⚠️ Hata: " + e.message, false); }
    finally { isGenerating = false; updateSendBtn(); userInput.focus(); }
}

// ── API helper ──
async function api(url, method="GET", body) {
    const opts = { method, headers: {"Content-Type":"application/json", ...(token?{"Authorization":"Bearer "+token}:{})} };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    return r.json();
}
