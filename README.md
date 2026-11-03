# Kotanene AI v6 - Ultimate Edition

Ömer Kaan Aydemir tarafından geliştirilmiş gelişmiş AI asistanı.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/kotanene/Kotanene-ai)

## Kurulum

```bash
npm install
```

## .env Dosyası
`.env.example` dosyasını `.env` olarak kopyala ve GROQ_API_KEY'ini yaz.

## Çalıştır
```bash
npm start
```

## Render ile Yayınlama (Ücretsiz)

1. Bu repoyu GitHub'a gönder.
2. Render Dashboard → **New** → **Blueprint** → repoyu seç.
3. `GROQ_API_KEY` değerini gir (Render diğer gizli değerleri otomatik üretir).
4. **Apply** de, deploy bitince verilen `onrender.com` adresini kullan.

> ⚠️ Render ücretsiz planında disk kalıcı değildir. Servis yeniden başlatıldığında SQLite kullanıcı/sohbet verileri sıfırlanır. Kalıcı veri için ücretli disk veya harici veritabanı gerekir.

## Özellikler
- 4 farklı AI modeli (GPT-OSS 120B, GPT-OSS 20B, Qwen, Allam)
- 7 kişilik modu
- Gerçek zamanlı streaming
- Kullanıcı sistemi (kayıt/giriş)
- Sohbet geçmişi (SQLite)
- Hafıza sistemi
- Görsel oluşturma (Pollinations AI)
- Dosya/PDF/Word analizi
- Web arama
- Matematik çözücü
- Metin özetleme
- Çeviri
- Kod analizi
- Sesli mesaj
- PWA desteği
- Karanlık/Aydınlık tema
- Premium üyelik sistemi
