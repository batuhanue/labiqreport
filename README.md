# LabIQ Kontrol — Aylık Kapanış Kontrol Listesi

Diacore aylık kapanışında **Bursa** ve **Başakşehir** için 10 rapor alanı / 48 kontrol maddesini
telefon, tablet veya bilgisayardan büyük işaretlerle tiklemek ve **orijinal Excel formunun birebir
çıktısını** almak için web uygulaması.

## Özellikler
- **Denetim (ana sayfa):** Açılışta aktif dönem kaldığı yerden açılır. Her madde iki hastane için
  ☑ Tamam / x Sorun / N/A işaretlenir, not (Excel'de DURUM kolonu) ve bulgu/aksiyon eklenir.
  Alan tamamlanınca kutlama ekranı. Termin (Ay bitiş + N gün) takibi.
- **Dönemler:** Yeni dönem seçilirse sıfırdan başlar ve aktif olur; geçmiş dönem seçilirse kayıtlı hali gösterilir.
- **Aksiyonlar:** `02_Aksiyon_Takip` sayfasının kolonları (bulgu, mali/operasyonel etki, öncelik, sorumlu, termin, durum).
- **Analiz:** Seçili dönem özeti, alan bazında hastane karşılaştırması, termin takvimi, sorunlu maddeler, dönemler arası trend.
- **Geçmiş:** Kayıtlı dönemler, Excel indirme, aktif yapma, silme; mevcut Excel formunu **içe aktarma**; form başlık/onay bilgileri.
- **Excel çıktısı:** `templates/kontrol-sablonu.xlsx` şablonu XML seviyesinde doldurulur; biçim, renkler,
  açılır listeler, `03_Durum_Panosu` formülleri ve grafikleri korunur (açılışta yeniden hesaplanır).

- **Push bildirimleri:** Sağ üstteki zil → "Bildirimleri aç". Her sabah 09:00'da (Vercel Cron) aktif dönem için:
  yaklaşan/geçen rapor alanı terminleri, termini gelen/geciken aksiyonlar, Cuma 12:00 toplantı özeti ve ay başı
  hatırlatması. Zil menüsü aynı hatırlatmaları uygulama içinde de gösterir; hangi bildirimlerin geleceği oradan seçilir.
  iPhone/iPad'de önce Safari → Paylaş → **Ana Ekrana Ekle** (iOS 16.4+), sonra uygulamayı oradan açıp bildirimi aç.

## Vercel'e kurulum
1. Repo'yu Vercel'e import et (Framework: Next.js).
2. **Storage → Create Database → Neon (Postgres)** ekle ve projeye bağla (`DATABASE_URL` otomatik gelir).
   Tablolar ilk istekte otomatik oluşturulur.
3. İsteğe bağlı: **Settings → Environment Variables** altında `APP_PASSWORD` tanımla — uygulama şifreyle korunur.
4. Push bildirimleri için ortam değişkenleri:
   - `npm run vapid` çalıştır → çıkan anahtarları `VAPID_PUBLIC_KEY` ve `VAPID_PRIVATE_KEY` olarak ekle
   - `VAPID_SUBJECT=mailto:eposta@adresin`
   - `CRON_SECRET` = rastgele uzun bir değer (Vercel Cron bunu otomatik `Authorization` başlığıyla gönderir)
   - Zamanlama `vercel.json` içinde: `0 6 * * *` (UTC) = her gün 09:00 İstanbul
5. Yeniden dağıt (Redeploy).

## Yerel geliştirme
```bash
npm install
npm run dev   # DATABASE_URL yoksa veriler .data/ klasörüne yazılır
```
