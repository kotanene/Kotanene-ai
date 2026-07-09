# Kotanene AI v6 - Deployment Guide

Bu proje PM2 kullanarak sürekli çalışan bir sunucuya deploy edilebilir.

## Kurulum

### 1. Gerekli Dosyalar
- `.env` dosyasının olduğundan ve `GROQ_API_KEY` içerdiğinden emin olun
- `data/` klasörünün oluşturulduğundan emin olun (otomatik oluşturulur)

### 2. PM2 ile Başlatma

```bash
# PM2'yi başlat
npm run pm2:start

# Veya doğrudan
pm2 start ecosystem.config.js
```

### 3. PM2'yi Sistem Başlangıcına Ekle

Sunucu yeniden başlatıldığında uygulamanın otomatik başlaması için:

```bash
# PM2'yi sistem servisi olarak kaydet
pm2 startup

# Mevcut işlemleri kaydet
pm2 save
```

### 4. Tek Komut ile Deploy

```bash
npm run deploy
```

Bu komut:
1. Uygulamayı PM2 ile başlatır
2. Mevcut PM2 işlemlerini kaydeder
3. PM2'yi sistem başlangıcına ekler

## Yönetim Komutları

```bash
# Uygulamayı durdur
npm run pm2:stop

# Uygulamayı yeniden başlat
npm run pm2:restart

# Uygulamayı sil
npm run pm2:delete

# Logları görüntüle
npm run pm2:logs

# Canlı izleme
npm run pm2:monit
```

## Manuel PM2 Komutları

```bash
# Tüm işlemleri listele
pm2 list

# Belirli bir işlemin loglarını görüntüle
pm2 logs kotanene-ai

# Uygulama durumunu kontrol et
pm2 status

# Logları temizle
pm2 flush
```

## Sunucu Ayarları

### Port
Varsayılan port: `3000`
Değiştirmek için `.env` dosyasına ekleyin:
```
PORT=8080
```

### Environment
Production modda çalışır. Geliştirme için `ecosystem.config.js` dosyasını düzenleyin.

## Güvenlik

- Güvenlik duvarında 3000 portunu açmayı unutmayın
- SSL/TLS kullanmak için Nginx veya Apache reverse proxy önerilir
- `.env` dosyasını asla GitHub'a yüklemeyin

## Reverse Proxy (Nginx Örneği)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Sorun Giderme

### Uygulama başlamıyor
```bash
pm2 logs kotanene-ai
```

### Port zaten kullanımda
```bash
lsof -i :3000
# veya .env dosyasında PORT değiştirin
```

### Database hatası
`data/` klasörünün yazma izinlerini kontrol edin.

## Monitoring

PM2 ile gerçek zamanlı monitoring:
```bash
pm2 monit
```

Web tabanlı monitoring için PM2 Plus:
```bash
pm2 plus
```
