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
- **Yapay zekâ asistanı (Anthropic Claude Haiku 5.5):** Üst bardaki ✨ düğmesi ya da **J** / **Alt+J**. Her soruda
  `knowledge/*.md` dosyalarını (00 okuma kılavuzu · 01 iş tanımı ve iş süreci · 02 aylık kontrol iş akışı — uygulama içinden düzenlenebilir veya yeni .md
  yüklenebilir) ile canlı veriyi birlikte okur: 10 başlığın iki hastane için güncel durumu, madde notları / anomaliler,
  aksiyonlar, dönem notları (el yazısı notlar görüntü olarak gönderilir), kişisel görevler, terminler ve geçmiş dönem özeti.
  Yanıtlar akışla gelir; önerdiği görevler tek tuşla Görevler'e eklenir. Alan sayfasında "✨ Asistana sor" düğmesi var.
  Sohbetler veritabanında tutulur: her cihazdan aynı sohbete devam edilir (panel açılınca en son konuşulan sohbet gelir),
  🕘 düğmesiyle geçmiş sohbetler listelenir, aranır, açılır ya da silinir.
  **Bellek (`gelistirme.md`):** asistan sohbette öğrendiği kalıcı bilgiyi (süreç mantığı, şirket kuralı, tercih, karar) kendisi
  `remember` aracıyla bu dosyaya konu başlıkları altında yazar; "🧠 Belleğe ekle" düğmesi sohbetten öğrenilenleri elle yazdırır.
  Dosya Bilgi dosyaları panelinde görünür, düzenlenebilir ve her yeni sohbette okunur (ayrı önbellek bloğunda).
  Maliyet: sabit kurallar + bilgi dosyaları (~30k token) Claude istem önbelleğinde tutulur (`cache_control`); her soruda ve
  her arşiv araması turunda önbellekten (~%90 indirimli) okunur. Değişen canlı veri son kullanıcı mesajının başına eklenir,
  böylece önceki mesajlar da önbellekte kalır. Her yanıtın altında "Nk token · Mk önbellekten ⚡ · $" görünür; asistan
  panelindeki 📊 düğmesi günlük/haftalık/aylık token ve tahmini maliyeti gösterir. Aşırı yük (529) ve hız sınırında (429)
  SDK yeniden dener; yanıt ortada koparsa yarım metin silinip tur yeniden istenir.
  Kurulum: Vercel'e `ANTHROPIC_API_KEY` (console.anthropic.com → Settings → API keys) ekleyin; model `ANTHROPIC_MODEL`
  ile değiştirilebilir (varsayılan `claude-haiku-5-5`; ör. `claude-sonnet-5-5`, `claude-opus-5-5`).
- **Push bildirimleri:** Sağ üstteki zil → "Bildirimleri aç". Her sabah 09:00'da (Vercel Cron) aktif dönem için:
  yaklaşan/geçen rapor alanı terminleri, termini gelen/geciken aksiyonlar, Cuma 12:00 toplantı özeti ve ay başı
  hatırlatması. Zil menüsü aynı hatırlatmaları uygulama içinde de gösterir; hangi bildirimlerin geleceği oradan seçilir.
  iPhone/iPad'de önce Safari → Paylaş → **Ana Ekrana Ekle** (iOS 16.4+), sonra uygulamayı oradan açıp bildirimi aç.
- **Beyin (Görevler sayfası):** İşini anlayan merkez ve ona bağlı yan ajanlar — asıl çalışma ekibi. Tablet/masaüstünde
  **Beyin ofisi** (3B, Agents Office düzeni): ortada not ağıyla Beyin, çevresinde her ajan bir departman pod'u; masalarda
  lider (★) ve alt görevler oturur, ajan çalışırken çalışanlar ve ekranlar hareketlenir. Pod kartlarında açık iş, iki
  departman göstergesi (fareyle) ve YAP · SIRA · BİTTİ; üstte bağlı servisler ve departmanlara kablolar (çalışan
  departmanınki ışır); sağda görev çubuğu (departman seç, Hemen yap, Ekip), Beyin kartı + Bugün odak ve yüzdeli GÖREV
  DURUMU. Departmana tıklayınca kamera uçar, masa adları görünür, panel o ajanın talimatı/kuralları/kurulum görüşmesi ve
  işlerine döner. "Ofis / Liste" ile 2B görünüme geçilir; telefonda liste. Beyin seni bilgi dosyalarından ve
  `gelistirme.md` belleğinden tanır; ajanlar kendi kaynaklarını okur: 📨 Posta (yeni e-postalar), 💬 Sohbet (sana
  yazılanlar), 📅 Takvim (7 günlük toplantı hazırlıkları, yanıt bekleyen davetler), 🎥 Toplantı (transkriptlerden
  kararlar/aksiyonlar), ✅ Denetim (termin baskısı, aksiyonu açılmamış ✗ bulgular), 📁 Dosya (her işe arşivden/Drive'dan
  ilgili dosyaları ekler), 🗂️ Görev ("Beyne yaz" notlarını işe çevirir). Her düşünmede yalnızca yeni sinyaller işlenir;
  ajanlar Claude'un şemalı (structured output) yanıtıyla iş açar ya da var olanı günceller (tekrar açmaz), sonra beyin
  bütün açık işleri ve görevlerini rolüne göre sıralayıp "Bugün odak" brifingini yazar. Ajan önerileri **Öneriler**
  sütununa düşer; onaylayınca Yapılacak'a geçer, "Gerek yok" dediğin bir daha önerilmez. Kanban: Öneriler → Yapılacak →
  Devam → Bekliyor → Bitti; her iş adımlar, bulunan dosyalar ve kaynak bağlantılarıyla açılır, tek tuşla görev listesine
  aktarılır (görev bitince iş de biter). Tetikleme: "Şimdi düşün", uygulama açıkken Google senkronundan sonra (en fazla
  30 dk'da bir) ve her sabah cron. Kişisel görev listesi "Görevlerim" sekmesinde aynen duruyor.
  **Ajanlar iş yapar:** bir işi ajana verince ("🤖 … bu işi yapsın" ya da görev çubuğunda "⚡ Hemen yapsın") ajan
  kaynakların tam metnini, bulunan dosyaları ve arşivi araçlarla okuyup teslimatı yazar: yanıt taslağı, toplantı hazırlık
  notu, karar/aksiyon listesi, kontrol planı. Kural: okumak serbest; dışarıya bir şey gidecekse (e-posta, mesaj) yalnızca
  taslak hazırlar ve **onayını bekler** (gönderim şimdilik sende: kopyala → Gmail'de aç → "Gönderdim, onayla").
  **Düzeltmelerden öğrenir:** teslimatı "Düzelt: …" ile geri gönder; Claude düzeltmenin bu işe özel mi kalıcı tercih mi
  olduğuna karar verir, kalıcıysa `ajan-kurallari.md` bilgi dosyasında o ajanın başlığı altına yazar ve ajan her işte uyar
  (dosyadan silersen unutur). Görev çubuğunda ajanı kendin seçebilir ya da "Beyin seçsin" diyebilirsin.
  **Kurulum görüşmesi:** ajan grafiğinde bir ajana tıkla → "🎤 Kurulum görüşmesi". Ajan 5 kısa soru sorar (burada iş
  nasıl yürüyor, en sık iş, iyi sonuç neye benzer, kırmızı çizgiler, kişiler/araçlar; "Atla" ve "Bitti, yaz" var), sonra
  kendi çalışma talimatını ve en sık iş için bir becerisini (adım adım) `ajan-talimatlari.md`'ye yazar ve denemen için bir
  görev önerir. Ajan kartı talimatını ve düzeltmelerden öğrendiği kuralları gösterir.
  **Ekip olarak yap:** işin sahibi ajan lider olur; işi 2-4 bağımsız parçaya böler ve her parçayı uygun ajana verir,
  parçalar aynı anda çalışır (birbirine/lidere "NOT @…" bırakabilir), lider hepsini tek teslimatta birleştirir ve kim ne
  yaptı satırını ekler. Düzeltme ekibi yeniden çalıştırmaz, lider teslimatı düzeltir.
- **Google Workspace (Takvim, Gmail, Chat, Meet, Drive):** "Google" sayfasından şirket hesabı tek tıkla bağlanır (salt okunur).
  Takvim (sıradaki toplantı + Meet'e katıl), gelen kutusu (okunmamış/önemli), Chat alanları ve DM'ler, Meet toplantı
  kayıtları (katılımcılar, transkript/kayıt bağlantıları) görünür; her öğeden tek tuşla görev oluşturulur.
  Senkron: uygulama açıkken 5 dakikada bir, elle yenileme ve her sabah cron. Asistan bu verileri (ve son toplantı
  transkriptlerini) okur; asistan panelindeki "📬 Google" düğmesiyle kapatılabilir. Sabah bildirimine bugünkü toplantılar eklenir.
  **Hafıza (arşiv):** geçmiş tüm e-postalar, Chat mesajları, Meet transkriptleri ve takvim `google_archive` tablosunda
  kalıcı birikir. İlk bağlantıdan sonra geçmiş, uygulama açıkken arka planda parça parça indirilir (kaldığı yerden devam
  eder); sonra yeni gelenler otomatik eklenir. Asistan geçmişe dönük sorularda arşivde arar (Claude araç kullanımı).
  Google sayfası → Arşiv sekmesinden ilerleme görülür ve doğrudan aranabilir. Bağlantı sunucuda saklandığından tüm
  cihazlarda tek seferlik giriş yeterlidir.
  **Drive:** Google sayfası → Drive sekmesi: son değişenler, benimle paylaşılanlar, yıldızlılar, klasör gezinme ve
  ad/içerik araması (ortak drive'lar dahil). Dosyalar uygulama içinde okunur: Google Dokümanlar/Slaytlar metin,
  E-Tablolar tablo olarak; Word/Excel/PowerPoint dosyalarının metni de çıkarılır; PDF ve görseller Drive önizlemesiyle
  açılır. Dosya içerikleri arşive de yazılır, asistan "şu tablodaki…/prosedürde ne yazıyor" sorularında Drive'da arar.
  Önceden bağlanmış hesapta Drive için bir kez **yeniden bağlanıp** Drive iznini vermek gerekir.
  **Sanal ofis (tablet/masaüstü):** Google sayfası varsayılan olarak 3B ofis olarak açılır ("Ofis / Liste" ile eski
  görünüme dönülür, tercih hatırlanır). Her kaynak ayrı bir oda ve kendi iş mantığıyla çalışır: Planlama (duvar
  panosunda 7 günlük notlar), Posta odası (masalarda okunmamış zarf yığınları, önemliler kırmızı), İletişim (her aktif
  sohbet bir masa, yeni mesajda parlayan konuşma balonu), Toplantı salonu (toplantı sürerken ekran kırmızı yanıp söner,
  transkript kâğıtları), Dosya arşivi (rafta türüne göre renkli klasörler), Hafıza (her kaynak için sunucu dolabı;
  LED'ler indirme durumunu gösterir). Rozetler odanın durumunu (çalışıyor / iş bekliyor / sakin / sorun) gösterir;
  odaya tıklayınca kamera oraya uçar ve sağ panelde o kaynağın içeriği açılır. Görsel olarak cam bölmeli tek kat ofis
  (koridorda ajan masası, beyin çalışırken yanıp söner) — Beyin sekmesindeki pod düzeninden ayrıdır; her oda kartında açık iş sayısı ve YAP · SIRA · BİTTİ (beyin
  ajanlarının işleri); üstte bağlı servisler şeridi ve odalara giden kablolar (ajan çalışırken hızlanır); sağda tüm
  ofisin GÖREV DURUMU listesi (ilerleme yüzdeli).

- **Kampüs görünümü (tablet + masaüstü):** Denetim sayfası 3B, "cozy" bir kampüs olarak açılır (React Three Fiber).
  10 rapor alanı = 10 depo binası, her kontrol maddesi = binanın önündeki yükleme rampası. Rampanın önünde iki palet
  yeri vardır (sol Bursa, sağ Başakşehir): ✓ koli yığını, ✗ kırmızı sandık + uyarı iğnesi, N/A brandalı palet, boş = sarı
  çizgili boş yer. İki hastane de kontrol edilince kepenk iner. Bekleyen işlerin önünde forkliftler çalışır, yollarda
  kamyonlar dolaşır. Binaya tıklayınca kamera oraya uçar; sağ cam panelden maddeler işaretlenir, "Detay" ile not/aksiyon
  eklenir. Üstte göstergeler, altta kapanış akışı ve iş kuyruğu, ortadaki Diacore Merkez binası genel özettir.
  "☰ Liste" ile klasik görünüme dönülür (tercih cihazda hatırlanır). Mobilde klasik görünüm kalır; 3B kod indirilmez.

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
5. Google Workspace bağlantısı (bir kerelik):
   - console.cloud.google.com → şirket hesabıyla yeni proje
   - **APIs & Services → Library**: Gmail API, Google Calendar API, Google Chat API, Google Meet REST API, People API, Google Drive API → Enable
   - **OAuth consent screen**: User type **Internal** (yalnızca şirket hesapları; Google doğrulaması gerekmez)
   - **Credentials → Create credentials → OAuth client ID → Web application**;
     Authorized redirect URI: `https://<vercel-alan-adın>/api/google/callback`
   - **Google Chat API → Configuration**: uygulama adı, simge URL'si ve açıklama gir, kaydet (Chat okumak için zorunlu)
   - Vercel'e `GOOGLE_CLIENT_ID` ve `GOOGLE_CLIENT_SECRET` ekle (farklı alan adı kullanıyorsan `GOOGLE_REDIRECT_URI`)
   - Uygulamada **Google → Google ile bağlan**
6. Yeniden dağıt (Redeploy).

## Yerel geliştirme
```bash
npm install
npm run dev   # DATABASE_URL yoksa veriler .data/ klasörüne yazılır
```
