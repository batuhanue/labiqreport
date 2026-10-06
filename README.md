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

## Vercel'e kurulum
1. Repo'yu Vercel'e import et (Framework: Next.js).
2. **Storage → Create Database → Neon (Postgres)** ekle ve projeye bağla (`DATABASE_URL` otomatik gelir).
   Tablolar ilk istekte otomatik oluşturulur.
3. İsteğe bağlı: **Settings → Environment Variables** altında `APP_PASSWORD` tanımla — uygulama şifreyle korunur.
4. Yeniden dağıt (Redeploy).

## Yerel geliştirme
```bash
npm install
npm run dev   # DATABASE_URL yoksa veriler .data/ klasörüne yazılır
```
