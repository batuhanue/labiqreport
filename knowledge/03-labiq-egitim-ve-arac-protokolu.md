# LabIQ / Diacore – AI Ajanı için Arayüz ve Veri Erişim Teknik Raporu & Sistem Talimatı

**Sürüm:** 1.0 (ekran kaydına dayalı tam eğitim)  
**İnceleme tarihi:** 12 Ekim 2026  
**Kaynak:** `Ekran Kaydı 2026-10-12 090410.mp4`  
**Kapsam:** LabIQ arayüzünün menü navigasyonu, stok ve ilişkili modüller, görsel kontroller, veri tabloları, alanlar, filtreler, örnek rapor akışları (R01-R12), ekran kataloğu ve ajan çalıştırma protokolü.

---

## 1. Yönetici özeti ve görev modeli

LabIQ, yalnızca depo defteri değildir. Sistemde **Stok, Cihaz, Personel, Verimlilik ve Maliyet** modülleri ile ana **Laboratuvar Paneli** yer alır. Operasyonel belge/kayıt sayfaları (stok hareketi, sipariş, talep, servis çağrısı) ile rapor/analiz sayfaları (stok yeterlilik, tüketim analizi, test verimliliği, maliyet) farklı işlev görür. Doğru ajan `rapor isteği → rapor ailesi → ilgili panel → filtreler → veri/sayfalama → dışa aktarım veya görünür tablodan okuma → kontrol → yorum ve kaynak` sırasını uygular.

**Ajanın ideal yetenek sınırı:** Yetkili oturumuyla *arayüz üzerinden okuma/rapor alma*; varsayılan **salt-okunur (READ_ONLY)**. Yeni kayıt, stok hareketi, tüketim iptali, onay, senkronizasyon, silme veya izleme ayarı değiştirme gibi işlemler için kullanıcı onayı gerekir.

---

## 2. Temel navigasyon anatomisi

### 2.1 Sol navigasyon alanı
- **Dar dikey ikon rayı:** Solda ana sayfa/ev, stok/küp, cihaz/mikroskop, personel/grup, iletişim/balon, verimlilik/grafik, maliyet/simgeler ve diğer modül ikonları. En altta bildirim zili, yardım, ayarlar ve kullanıcı avatarı görünür. `labIQ` markasının yanındaki ok/chevron geniş menüyü açıp kapatır.
- **Geniş menü:** Yaklaşık ilk 300 pikselde, `diacore` başlıklı, seçilen ana modülün ayrıntılı sayfalarını listeler. Seçili menü öğesi mor/vurgu renginde. Menü uzun olduğunda kendi alanında aşağı kaydırılır.
- **İçerik alanı:** Sol menünün sağı `Başlık + favori yıldızı ve bazı sayfalarda filtre simgesi` ile başlar. Sağ üstte `Dışa Aktar`, `Yazdır` veya `Paraşüt ile senkronize et` bulunur.

### 2.2 Ortak arama/filtre deseni
- **Kayıt listeleri:** Sağ üstte `Filtre` (huni simgesi + açılır ok) ve `Ara...` alanı bulunur.
- **Analitik raporlar:** `Tarih Aralığı` veya `Dönem`, `Laboratuvar`, `Laboratuvar Grubu`, `Tüketim Noktası`, `Depo`, `Ürün`, `Tedarikçi`, `Marka`, `Ürün Grubu`, `Ürün Alt Grubu`, `Test Grubu` vb. filtre formu bulunur. `Temizle` ve `Filtrele` butonları filtre setini uygular/sıfırlar. **Alan seçmek ile `Filtrele`'ye basmak aynı şey değildir.**
- **Açılır seçiciler:** `Lütfen seçiniz`, sağında aşağı ok; seçim sonrası `x` temizleme ikonu; açılan listeler kaydırılabilir ve içeride `Ara...` destekler.
- **Boş/askıda durum:** `Gösterilecek kayıt bulunamadı`, `Hiç kayıt bulunamadı`, `Ürün Seçilmedi`, `Grafik görmek için tablodan bir satır seçin`, dönen spinner ve gri/beyaz yükleme ekranları birbirinden farklıdır. Hiçbiri tek başına kesin 0 sonucunu kanıtlamaz.
- **Detay etkileşimi:** Turkuaz `işlem no`, `ürün adı`, `doküman numarası` veya `test` tıklanınca detay sayfasına veya modala gider.

---

## 3. Yapılandırılmış ekran kataloğu (56 Sayfa)

| Modül | Sayfa | URL Örüntüsü | Açıklama |
|---|---|---|---|
| Stok | Stok Hareketleri | `/companies/226/inventory_movements` | Giriş/çıkış fişleri, irsaliyeler, işlem no detayları |
| Stok | Ürün Talepleri | `/companies/226/product_requests` | Açık, tamamlanan ve bekleyen transfer talepleri |
| Stok | Ürün Transfer | `/companies/226/product_transfers` | Depo transferleri |
| Stok | Şirketler Arası Transfer | `/companies/226/client_transfers` | Bursa PPP ↔ Başakşehir PPP vb. şirket transferleri |
| Stok | Emanet Takibi | `/companies/226/stock_loans` | Emanet hareketleri |
| Stok | Stok Gözlem | `/inventory_statuses` | Anlık stok miktarı, birim, toplam miktar, ort. tüketim |
| Stok | Ürün Stok Ekstresi | `/inventory_statuses/.../stock_extract` | Ürün hareket ekstresi (LOT, Miat, İşlem no, Toplam stok) |
| Stok | Depo Gözlem | `/warehouse_statuses` | LOT ve miat bazlı depo stokları |
| Stok | Ürün Kullanım | `/product_consumptions` | Kullanımlar ve iptal edilen kullanımlar, export_excel |
| Stok | Tüketim Takibi | `/product_consumptions/consumption_trackings` | Detaylı tüketim hareketleri ve export |
| Stok | Kalibrasyon/Kontrol | `/calibration_control_trackings` | Kalibrasyon ve kontrol amaçlı sarflar |
| Stok | Tüketim Analiz Raporu | `/companies/226/consumption_analysis_reports` | Dönem karşılaştırmalı tüketim analizi, fark yüzdesi |
| Stok | Miadı Yaklaşan Ürünler | `/near_expiry_products` | Miat ve son kullanma tarihli stok listesi |
| Stok | Sipariş Formları | `/companies/226/order_forms` | Sipariş no, depo, tedarikçi, birim fiyat modalı |
| Stok | Açık Sipariş Yönetimi | `/manage_open_orders/new` | Devam eden sipariş takipleri |
| Stok | İhtiyaç Planlama | `/companies/226/demand_plannings` | İhtiyaç planları, stok yeterlilik hedefi |
| Stok | Stok Yeterlilik Analizi | `/companies/226/inventory_coverage_analyses` | Hedefin altındaki/üstündeki ürünler, karşılama günü |
| Stok | Kritik Stok Raporu | `/companies/226/critical_inventory_reports` | Kritik stok altındaki ürünler |
| Stok | Fazla Stok Analizi | `/companies/226/excess_inventory_analyses` | Fazla stok ve ürün detayları |
| Stok | Riskli Stok Raporu | `/companies/226/at_risk_inventory_reports` | İmha riski, aktarılabilir stok önerisi |
| Stok | Stok Hareket Raporu | `/companies/226/inventory_movement_reports` | Dönemsel giriş, iade, imha ve net fark dökümü |
| Stok | Depolar Arası Transfer | `/inter_warehouse_transfer_reports` | Depo çiftleri arası transfer raporu |
| Stok | Stok Sayım | `/inventory_counts` | Sayım fişleri ve gerçekleşen farklar |
| Stok | Ürünler | `/companies/226/products` | Ürün ana kartları, saklama koşulları, ekstre bağlantısı |
| Stok | Depo | `/companies/226/warehouses` | Depo tanımları, tüketim yeri, transfer kabulü |
| Cihaz | Bakım/Kalibrasyon Raporu| `/instruments/maintenance_report` | KPI, geciken bakımlar, marka bazlı başarı |
| Cihaz | Servis Çağrıları | `/service_requests` | Açık/kapalı çağrılar, öncelik, çözüm süresi |
| Cihaz | Servis Performans Raporu| `/service_requests/service_performance_overviews` | Çözüm süresi (dk), hedefi aşan çağrılar, arıza trendi |
| Cihaz | Cihaz Teknisyenleri | `/companies/226/instrument_operators` | Cihaz-kullanıcı zimmet ve çalışma aralığı |
| Cihaz | EQA Üyelikleri | `/eqa_subscriptions` | Dış kalite kontrol üyelik ve sözleşmeleri |
| Personel | Personel Analizi | `/workforce/employee_analysis` | Aktif personel, eğitimler, izin dağılımı |
| Verimlilik| Test Kataloğu | `/companies/226/test_catalogs` | Test ID, LOINC, CPR faktörü, hedef verimlilik |
| Verimlilik| Test Verimlilik Raporu| `/efficiency_analysis/test_efficiency_report` | Tüketim vs üretilen sonuç, verimlilik realizasyonu |
| Verimlilik| Fire Analizi | `/efficiency_analysis/operational_loss_analyses` | Test grubu ve ürün bazında fire ve kayıp analizi |
| Maliyet | Maliyet Gösterge Paneli| `/cost_dashboard` | Toplam maliyet, test grubu maliyetleri, trendler |
| Maliyet | CPR Anomali Raporu | `/cpr_analyses/cpr_anomaly_reports` | Test ve cihaz bazlı sonuç başı maliyet sapmaları |
| Maliyet | İmha Raporu | `/companies/226/disposal_reports` | İmha miktarı ve toplam imha maliyeti |
| Maliyet | Tedarikçi Sözleşmeleri| `/supplier_agreements` | Sözleşme birim fiyatları, geçerlilik tarihleri |

---

## 4. Pratik Rapor ve Görev Tarifleri (R01 – R12)

- **R01 (Stok Giriş-Çıkış):** `Stok Hareket Raporu`ndan tarih ve depo seç, giriş/çıkış/iade/imha farklarını al. Belge gerekirse `Stok Hareketleri` işlem no detayına git.
- **R02 (Anlık Stok & Geçmiş):** `Stok Gözlem` üzerinden ürünü bul, stok miktarını oku, ürün adına tıklayarak `Stok Ekstresi`ne geç ve kronolojik hareketleri doğrula.
- **R03 (Miadı Yaklaşanlar):** `Miadı Yaklaşan Ürünler` ve `Depo Gözlem` sayfalarını LOT ve Miat bazında karşılaştır.
- **R04 (Tüketim Analizi):** `Tüketim Analiz Raporu` üzerinden seçilen tarih aralığı, son 3 ay ortalaması ve fark yüzdesini dök.
- **R05 (Kritik Stok & Karşılama):** `Stok Yeterlilik Analizi` ile hedef gün belirle, `Hedefin Altındaki Ürünler` sekmesinden karşılama süresini (gün) al.
- **R06 (Fazla & Riskli Stok):** `Fazla Stok Analizi` ve `Riskli Stok Raporu`ndan satır seçip alt ürün detaylarından aktarılabilir transfer önerilerini derle.
- **R07 (Cihaz Performansı):** `Bakım/Kalibrasyon Raporu`, `Servis Çağrıları` ve `Servis Performans Raporu`nu birleştirerek cihaz bazlı döküm oluştur.
- **R08 (Test Verimliliği):** `Test Verimlilik Raporu`ndan üretilen sonuç sayısı ile tüketimi karşılaştır, hedef realizasyonunu hesapla.
- **R09 (Maliyet Analizi):** `Maliyet Gösterge Paneli` ve `CPR Anomali Raporu`ndan sonuç başı maliyet ve birim sapmalarını derle.
- **R10 (Stok Giriş Maliyeti):** `Stok Ekstresi`nden işlem no al, `Stok Maliyet Raporu`ndan giriş tarihi, sözleşme birim fiyatı ve toplam maliyetle eşleştir.
- **R11 (İmha Maliyeti):** `İmha Raporu`ndan filtrelenmiş imha miktarı ve maliyetini al.
- **R12 (Sözleşme & Sipariş Karşılaştırma):** `Tedarikçi Sözleşmeleri` fiyatları ile `Sipariş Formları` birim fiyatlarını aynı birim ve para biriminde karşılaştır.

---

## 5. Ajan Çalıştırma ve Güvenlik Protokolü

1. **Yetkili Oturum:** LabIQ oturumu (`batuhanb@diacore.com.tr`) üzerinden güvenli cookie ve CSRF yönetimi kullanılır.
2. **Hastane Ayrımı:** Bursa PPP (`226`) ve Başakşehir PPP (`259`) iki ayrı hastanedir. Kullanıcının talebine göre doğru hastane seçilmeli veya geçiş yapılmalıdır.
3. **READ_ONLY İlkesi:** Otomatik onay, silme, stok hareketi ekleme veya ayar değişikliği yapılmaz. Sadece raporlama, veri okuma ve Excel dışa aktarımı yapılır.
4. **Metrik Güvenliği:** 
   - `Giriş ≠ Kullanım ≠ Transfer ≠ İade ≠ İmha`
   - `Sipariş ≠ Mal kabul ≠ Fiili tüketim`
   - `Stok miktarı (kutu/paket) ≠ Toplam miktar (test/adet)`
   - `Kritik stok ≠ Fazla stok ≠ Riskli stok`
   - Boş ekran veya filtre uygulanmamış ekran sıfır (0) kabul edilmez.
