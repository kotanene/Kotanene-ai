// ── State ──
let conversationHistory = [];
let currentLanguage = "tr";
let currentUsername = "";
let currentPersonality = "normal";
let currentModel = "llama-3.3-70b";
let pendingImage = null;
let mediaRecorder = null;
let isRecording = false;
let isGenerating = false;

// ── DOM ──
const messagesDiv   = document.getElementById("messages");
const userInput     = document.getElementById("userInput");
const sendBtn       = document.getElementById("sendBtn");
const welcomeScreen = document.getElementById("welcomeScreen");

// ── Marked ──
marked.setOptions({ breaks: true, gfm: true });

// ── Renderer (kod bloklarına kopyala butonu) ──
const renderer = new marked.Renderer();
renderer.code = (code, lang) => {
    const escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<div style="position:relative"><button class="code-copy-btn" onclick="copyCode(this)">Kopyala</button><pre><code class="lang-${lang||''}">${escaped}</code></pre></div>`;
};
marked.setOptions({ renderer });

function copyCode(btn) {
    const code = btn.nextElementSibling.querySelector("code").textContent;
    navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "✓ Kopyalandı"; btn.style.color = "#22c55e";
        setTimeout(() => { btn.textContent = "Kopyala"; btn.style.color = ""; }, 2000);
    });
}

// ── Tema ──
function initTheme() {
    const saved = localStorage.getItem("k_theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    updateThemeBtn(saved);
}

function toggleTheme() {
    const c = document.documentElement.getAttribute("data-theme");
    const n = c === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    localStorage.setItem("k_theme", n);
    updateThemeBtn(n);
}

function updateThemeBtn(t) {
    const icon = t === "dark" ? "☀️" : "🌙";
    document.getElementById("themeToggleSide").textContent = icon + " Tema";
    document.getElementById("themeToggleTop").textContent = icon;
}

document.getElementById("themeToggleSide").addEventListener("click", toggleTheme);
document.getElementById("themeToggleTop").addEventListener("click", toggleTheme);

// ── Sidebar ──
const sidebar  = document.getElementById("sidebar");
const overlay  = document.getElementById("sidebarOverlay");

document.getElementById("menuBtn").addEventListener("click", () => {
    sidebar.classList.add("open");
    overlay.classList.add("show");
});

document.getElementById("sidebarClose").addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
}

// ── Modeller ──
async function loadModels() {
    try {
        const res = await fetch("/api/models");
        const models = await res.json();
        const list = document.getElementById("modelList");
        list.innerHTML = "";
        for (const [key, m] of Object.entries(models)) {
            const btn = document.createElement("button");
            btn.className = "model-btn" + (key === currentModel ? " active" : "");
            btn.innerHTML = `<span class="model-icon">${m.icon}</span>${m.label}`;
            btn.addEventListener("click", () => {
                currentModel = key;
                document.getElementById("currentModelLabel").textContent = m.label;
                list.querySelectorAll(".model-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            });
            list.appendChild(btn);
        }
    } catch (e) {}
}

// ── Kişilik ──
document.querySelectorAll(".pers-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        currentPersonality = btn.dataset.p;
        document.querySelectorAll(".pers-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    });
});

// ── Dil ──
document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        currentLanguage = btn.dataset.lang;
        document.querySelectorAll(".lang-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    });
});

// ── Kullanıcı adı modal ──
const modal = document.getElementById("usernameModal");

function startChat() {
    const name = document.getElementById("usernameInput").value.trim();
    currentUsername = name || "Misafir";
    modal.style.display = "none";
    localStorage.setItem("k_username", currentUsername);
}

document.getElementById("usernameBtn").addEventListener("click", startChat);
document.getElementById("usernameInput").addEventListener("keydown", e => { if (e.key === "Enter") startChat(); });

// ── Init ──
window.addEventListener("DOMContentLoaded", () => {
    initTheme();
    loadModels();
    loadStats();

    const saved = localStorage.getItem("k_username");
    if (saved) { currentUsername = saved; modal.style.display = "none"; }
    else setTimeout(() => document.getElementById("usernameInput").focus(), 200);
});

// ── İstatistikler ──
async function loadStats() {
    try {
        const res = await fetch("/api/stats");
        const d = await res.json();
        document.getElementById("sideStatVisitors").textContent = "👥 " + d.totalVisitors + " ziyaretçi";
        document.getElementById("sideStatMessages").textContent = "💬 " + d.totalMessages + " mesaj";
    } catch (e) {}
}

// ── Web arama ──
document.getElementById("searchToggle").addEventListener("click", () => {
    const bar = document.getElementById("searchBar");
    bar.style.display = bar.style.display === "none" ? "flex" : "none";
    if (bar.style.display === "flex") document.getElementById("webSearchInput").focus();
});

document.getElementById("searchClose").addEventListener("click", () => {
    document.getElementById("searchBar").style.display = "none";
    document.getElementById("searchResults").style.display = "none";
});

document.getElementById("webSearchBtn").addEventListener("click", doWebSearch);
document.getElementById("webSearchInput").addEventListener("keydown", e => { if (e.key === "Enter") doWebSearch(); });

async function doWebSearch() {
    const q = document.getElementById("webSearchInput").value.trim();
    if (!q) return;
    const resultsDiv = document.getElementById("searchResults");
    resultsDiv.style.display = "block";
    resultsDiv.innerHTML = "<div style='color:var(--text3);font-size:0.8rem;padding:6px'>Aranıyor...</div>";

    try {
        const res = await fetch("/api/search?q=" + encodeURIComponent(q));
        const data = await res.json();
        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = "<div style='color:var(--text3);font-size:0.8rem;padding:6px'>Sonuç bulunamadı.</div>";
            return;
        }
        resultsDiv.innerHTML = data.results.map((r, i) => `
            <div class="search-result-item" onclick="useSearchResult(${i})">
                <div class="result-title">${escapeHtml(r.title || "")}</div>
                <div class="result-snippet">${escapeHtml((r.snippet || "").slice(0, 120))}...</div>
            </div>
        `).join("");

        // Sonuçları sakla
        window._searchResults = data.results;
    } catch (e) {
        resultsDiv.innerHTML = "<div style='color:#ef4444;font-size:0.8rem;padding:6px'>Arama hatası.</div>";
    }
}

function useSearchResult(i) {
    const r = window._searchResults[i];
    if (!r) return;
    userInput.value = `"${r.title}" hakkında bana bilgi ver: ${r.snippet}`;
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + "px";
    updateSendBtn();
    document.getElementById("searchBar").style.display = "none";
    document.getElementById("searchResults").style.display = "none";
}

function escapeHtml(t) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Öneri kullan ──
function useSuggestion(btn) {
    userInput.value = btn.textContent.trim();
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + "px";
    updateSendBtn();
    sendMessage();
}

// ── Yeni sohbet ──
document.getElementById("newChatBtn").addEventListener("click", () => {
    conversationHistory = [];
    messagesDiv.innerHTML = "";
    messagesDiv.appendChild(welcomeScreen);
    welcomeScreen.style.display = "flex";
    closeSidebar();
});

// ── Temizle ──
document.getElementById("clearBtnSide").addEventListener("click", () => {
    conversationHistory = [];
    messagesDiv.innerHTML = "";
    messagesDiv.appendChild(welcomeScreen);
    welcomeScreen.style.display = "flex";
    closeSidebar();
});

// ── Dışa aktar ──
document.getElementById("exportBtnSide").addEventListener("click", () => {
    if (conversationHistory.length === 0) return alert("Kaydedilecek mesaj yok!");
    const lines = conversationHistory.map(h =>
        (h.role === "user" ? "👤 " + currentUsername : "🤖 Kotanene AI") + ":\n" + h.content
    ).join("\n\n" + "─".repeat(50) + "\n\n");
    const blob = new Blob(["Kotanene AI Sohbet\n" + new Date().toLocaleString("tr-TR") + "\n\n" + lines], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = "kotanene-" + Date.now() + ".txt"; a.click();
    URL.revokeObjectURL(url);
});

// ── Mesaj ekleme ──
function addMessage(text, isUser, imageUrl = null) {
    if (welcomeScreen.parentNode === messagesDiv) welcomeScreen.style.display = "none";

    const msgDiv = document.createElement("div");
    msgDiv.className = "message " + (isUser ? "user" : "ai");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = isUser ? (currentUsername ? currentUsername[0].toUpperCase() : "S") : "✦";

    const bubbleWrap = document.createElement("div");
    bubbleWrap.className = "bubble-wrap";

    if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl; img.className = "msg-image";
        bubbleWrap.appendChild(img);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (isUser) {
        bubble.textContent = text;
    } else {
        bubble.innerHTML = marked.parse(text || "");
    }

    bubbleWrap.appendChild(bubble);

    if (!isUser) {
        const actions = document.createElement("div");
        actions.className = "bubble-actions";
        const copyBtn = document.createElement("button");
        copyBtn.className = "bub-action-btn";
        copyBtn.textContent = "📋 Kopyala";
        copyBtn.onclick = () => {
            const clean = text.replace(/[*_`#>]/g, "").trim();
            navigator.clipboard.writeText(clean).then(() => {
                copyBtn.textContent = "✅ Kopyalandı"; copyBtn.classList.add("ok");
                setTimeout(() => { copyBtn.textContent = "📋 Kopyala"; copyBtn.classList.remove("ok"); }, 2000);
            });
        };
        actions.appendChild(copyBtn);
        bubbleWrap.appendChild(actions);
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubbleWrap);
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return { msgDiv, bubble };
}

// ── Typing ──
function showTyping() {
    const { msgDiv, bubble } = addMessage("", false);
    bubble.innerHTML = '<div class="typing-dot"><span></span><span></span><span></span></div>';
    msgDiv.id = "typing-msg";
}

function hideTyping() {
    const el = document.getElementById("typing-msg");
    if (el) el.remove();
}

// ── Resim ──
document.getElementById("imageBtn").addEventListener("click", () => document.getElementById("imageInput").click());
document.getElementById("imageInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImage = file;
    const reader = new FileReader();
    reader.onload = ev => {
        document.getElementById("previewImg").src = ev.target.result;
        document.getElementById("previewName").textContent = file.name;
        document.getElementById("imagePreview").style.display = "flex";
    };
    reader.readAsDataURL(file);
    updateSendBtn();
});

document.getElementById("removeImage").addEventListener("click", () => {
    pendingImage = null;
    document.getElementById("imageInput").value = "";
    document.getElementById("imagePreview").style.display = "none";
    updateSendBtn();
});

// ── Ses ──
document.getElementById("voiceBtn").addEventListener("click", async () => {
    if (isRecording) return;
    try {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SR();
            recognition.lang = currentLanguage === "tr" ? "tr-TR" : "en-US";
            recognition.continuous = false;
            recognition.interimResults = false;

            document.getElementById("recordingBar").style.display = "flex";
            isRecording = true;

            recognition.onresult = e => {
                userInput.value = e.results[0][0].transcript;
                userInput.style.height = "auto";
                userInput.style.height = Math.min(userInput.scrollHeight, 150) + "px";
                updateSendBtn();
            };

            recognition.onend = () => {
                document.getElementById("recordingBar").style.display = "none";
                isRecording = false;
            };

            recognition.onerror = () => {
                document.getElementById("recordingBar").style.display = "none";
                isRecording = false;
                addMessage("Ses tanıma başarısız. Chrome'da dene!", false);
            };

            recognition.start();

            document.getElementById("stopRecording").onclick = () => recognition.stop();
        } else {
            addMessage("Tarayıcın ses tanımayı desteklemiyor.", false);
        }
    } catch (err) {
        addMessage("Mikrofon erişimi reddedildi.", false);
    }
});

// ── Input ──
userInput.addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 150) + "px";
    document.getElementById("charCount").textContent = this.value.length;
    updateSendBtn();
});

userInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

sendBtn.addEventListener("click", sendMessage);

function updateSendBtn() {
    const hasText = userInput.value.trim().length > 0;
    const hasImage = !!pendingImage;
    sendBtn.disabled = (!hasText && !hasImage) || isGenerating;
}

// ── Ana gönderme (STREAMING) ──
async function sendMessage() {
    const text = userInput.value.trim();
    if ((!text && !pendingImage) || isGenerating) return;

    isGenerating = true;
    sendBtn.disabled = true;

    const displayText = text || "📷 Resim gönderildi";
    const imageUrl = pendingImage ? URL.createObjectURL(pendingImage) : null;

    addMessage(displayText, true, imageUrl);
    userInput.value = ""; userInput.style.height = "auto";
    document.getElementById("charCount").textContent = "0";

    showTyping();

    try {
        if (pendingImage) {
            // Resim: streaming yok, normal fetch
            const formData = new FormData();
            formData.append("image", pendingImage);
            formData.append("message", text || "Bu resmi analiz et.");
            formData.append("personality", currentPersonality);
            formData.append("username", currentUsername);
            formData.append("language", currentLanguage);

            const res = await fetch("/api/chat-image", { method: "POST", body: formData });
            const data = await res.json();
            hideTyping();
            addMessage(data.response, false);

            conversationHistory.push({ role: "user", content: displayText });
            conversationHistory.push({ role: "model", content: data.response });

            pendingImage = null;
            document.getElementById("imageInput").value = "";
            document.getElementById("imagePreview").style.display = "none";

        } else {
            // Normal mesaj: STREAMING
            const res = await fetch("/api/chat/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    history: conversationHistory,
                    personality: currentPersonality,
                    username: currentUsername,
                    language: currentLanguage,
                    model: currentModel
                })
            });

            hideTyping();

            // Streaming mesaj oluştur
            const { msgDiv, bubble } = addMessage("", false);
            let fullText = "";

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6).trim();
                        try {
                            const json = JSON.parse(data);
                            if (json.error) { bubble.innerHTML = "⚠️ " + json.error; break; }
                            if (json.done) break;
                            if (json.delta) {
                                fullText += json.delta;
                                bubble.innerHTML = marked.parse(fullText);
                                messagesDiv.scrollTop = messagesDiv.scrollHeight;
                            }
                        } catch (e) {}
                    }
                }
            }

            // Kopyala butonu ekle (streaming bitti)
            const actions = document.createElement("div");
            actions.className = "bubble-actions";
            const copyBtn = document.createElement("button");
            copyBtn.className = "bub-action-btn";
            copyBtn.textContent = "📋 Kopyala";
            copyBtn.onclick = () => {
                const clean = fullText.replace(/[*_`#>]/g, "").trim();
                navigator.clipboard.writeText(clean).then(() => {
                    copyBtn.textContent = "✅ Kopyalandı"; copyBtn.classList.add("ok");
                    setTimeout(() => { copyBtn.textContent = "📋 Kopyala"; copyBtn.classList.remove("ok"); }, 2000);
                });
            };
            actions.appendChild(copyBtn);
            msgDiv.querySelector(".bubble-wrap").appendChild(actions);

            conversationHistory.push({ role: "user", content: text });
            conversationHistory.push({ role: "model", content: fullText });
        }

        if (conversationHistory.length > 30) conversationHistory = conversationHistory.slice(-30);
        loadStats();

    } catch (err) {
        hideTyping();
        addMessage("⚠️ Bağlantı hatası: " + err.message, false);
    } finally {
        isGenerating = false;
        updateSendBtn();
        userInput.focus();
    }
}
