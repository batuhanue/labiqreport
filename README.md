# LabIQ Kontrol — Aylık Kapanış Kontrol Listesi

Diacore aylık kapanışında **Bursa** ve **Başakşehir** için 10 rapor alanı / 48 kontrol maddesini
telefon, tablet veya bilgisayardan büyük işaretlerle tiklemek ve **orijinal Excel formunun birebir
çıktısını** almak için web uygulaması.

## Özellikler
- **Tamamlanma mantığı:** Bir madde ✓ (uygun) veya ✗ (bulgu var) işaretlendiyse **kontrol edilmiş = tamamlanmış** sayılır.
  N/A veya boş bırakılan madde eksiktir. Excel'deki `03_Durum_Panosu` formülleri de ☑ ile x'i birlikte sayar.
- **Animasyonlar:** [claudedesignskills](https://github.com/freshtechbro/claudedesignskills) (motion-framer, modern-web-design,
  react-spring-physics) ilkeleriyle: yay ön ayarları, kademeli girişler, kayan aktif göstergeler, ✓ çizilme + parçacık,
  ✗ sallanma, sayfa geçişleri, sayan sayılar, dalga efekti, tilt, dairesel tema geçişi. `prefers-reduced-motion` desteklenir.
- **Denetim (ana sayfa):** Açılışta aktif dönem kaldığı yerden açılır. Her madde iki hastane için
  ☑ Tamam / x Sorun / N/A işaretlenir, not (Excel'de DURUM kolonu) ve bulgu/aksiyon eklenir.
  Alan tamamlanınca kutlama ekranı. Termin (Ay bitiş + N gün) takibi.
- **Dönemler:** Yeni dönem seçilirse sıfırdan başlar ve aktif olur; geçmiş dönem seçilirse kayıtlı hali gösterilir.
- **Görevler (kişisel asistan):** Dönemden bağımsız kişisel iş listesi. Hızlı ekleme Türkçe doğal dili anlar:
  `yarın 14:00 Tuğrul'u ara #sayım !!`, `cumaya kadar R-05 fire raporu !acil`, `her cuma 11:00 toplantı hazırlığı`,
  `15.10 sunum @Hakan`, `3 gün sonra …`, `ay sonu …`. Akıllı listeler (Bugün/Yaklaşan/Gecikmiş/Tümü/Biten),
  odak yıldızı, alt görevler, tekrar eden görevler, sağa kaydır = tamamla / sola kaydır = sil (geri al), analiz
  (14 günlük grafik, zamanında tamamlama, seri). Asistan önerileri: termini yaklaşan/geçen rapor alanlarından ve
  açık aksiyonlardan görev oluşturur, gecikenleri bugüne taşır, tarihsizleri haftaya dağıtır, Cuma toplantısı
  hazırlığı hatırlatır. Sabah push bildirimine bugünkü/geciken görevler de eklenir. Kısayol: `A` hızlı ekleme.
- **Aksiyonlar:** `02_Aksiyon_Takip` sayfasının kolonları (bulgu, mali/operasyonel etki, öncelik, sorumlu, termin, durum).
- **Analiz:** Seçili dönem özeti, alan bazında hastane karşılaştırması, termin takvimi, sorunlu maddeler, dönemler arası trend.
- **Geçmiş:** Kayıtlı dönemler, Excel indirme, aktif yapma, silme; mevcut Excel formunu **içe aktarma**; form başlık/onay bilgileri.
- **Excel çıktısı:** `templates/kontrol-sablonu.xlsx` şablonu XML seviyesinde doldurulur; biçim, renkler,
  açılır listeler, `03_Durum_Panosu` formülleri ve grafikleri korunur (açılışta yeniden hesaplanır).

- **Tema:** Sağ üstteki düğme Sistem → Açık → Koyu arasında geçer (cihazda hatırlanır). Alt menü, üst bar, paneller ve bildirim baloncukları "liquid glass"; kartlar clay.
- **Notlar:** Üst bardaki kalem düğmesi (telefonda sol alttaki yüzen düğme) ya da **N** / **Alt+N** ile açılır.
  Her not hem klavyeyle yazılabilir hem de kalemle el yazısı alınabilir; notlar döneme kaydedilir ve bir rapor alanına bağlanabilir.
  El yazısı: kalem basıncına duyarlı, düşük gecikmeli (tahmini noktalar, ayrı çizim katmanı); kalem algılanınca avuç içi
  çizmez, parmak kaydırır; iki parmak her zaman kaydırır. Araçlar: kalem, fosforlu, silgi, 6 renk, 3 kalınlık, çizgili/kareli/boş kâğıt.
  Kısayollar: `N` yeni not · `T` yazı · `P` kalem · `H` fosforlu · `E` silgi · `1–6` renk · `⌘/Ctrl+Z` geri al · `⌘/Ctrl+Shift+Z` yinele · `Esc` kapat.
- **Yapay zekâ asistanı (Gemini 3.8 Flash):** Üst bardaki ✨ düğmesi ya da **J** / **Alt+J**. Her soruda
  `knowledge/asistan.md` (iş tanımı, önemi, ilkeler, yapılacaklar — uygulama içinden düzenlenebilir veya yeni .md
  yüklenebilir) ile canlı veriyi birlikte okur: 10 başlığın iki hastane için güncel durumu, madde notları / anomaliler,
  aksiyonlar, dönem notları (el yazısı notlar görüntü olarak gönderilir), kişisel görevler, terminler ve geçmiş dönem özeti.
  Yanıtlar akışla gelir; önerdiği görevler tek tuşla Görevler'e eklenir. Alan sayfasında "✨ Asistana sor" düğmesi var.
  Kurulum: Vercel'e `GEMINI_API_KEY` (Google AI Studio → API key) ekleyin; model `GEMINI_MODEL` ile değiştirilebilir.
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
