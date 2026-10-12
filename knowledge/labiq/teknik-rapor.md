# LabIQ / Diacore – AI Ajanı için Arayüz ve Veri Erişim Teknik Raporu

**Sürüm:** 1.0 (ekran kaydına dayalı ön eğitim)  
**İnceleme tarihi:** 12 Ekim 2026  
**Kaynak:** `Ekran Kaydı 2026-10-12 090410.mp4`  
**Süre:** 12 dakika 28,4 saniye | **Görüntü:** 1894 × 1198, 30 fps | **Toplam video karesi:** 22.452  
**Kapsam:** LabIQ arayüzünün menü navigasyonu, stok ve ilişkili modüller, görsel kontroller, veri tabloları, alanlar, filtreler, örnek rapor akışları ve ajan çalıştırma protokolü.

> **Önemli:** Bu belge yalnızca ekrandan kesin olarak okunabilen işlevleri doğrular. Video bütün kareleriyle sahne-değişim taramasından geçirilmiş, saniyelik örnekler ve seçilmiş okunabilir tam çözünürlüklü anlar gözden geçirilmiştir. 30 fps kaydın 22.452 karesinin her birinin elle tek tek tanımlandığı anlamına gelmez. Videonun bazı bölümleri **siyah blok, bozuk görüntü veya beyaz yükleme ekranları** içerir; bunlar üzerinden kesin UI sonucu türetilmemiştir. Özellikle export dosya formatları, gizli alt menüler, bir butonun işlemi kesin sonuçlandırıp sonuçlandırmadığı ve API uç noktaları hakkında kanıt yoksa `DOĞRULANMADI` denmiştir.

## 1. Yönetici özeti ve görev modeli

LabIQ, yalnızca depo defteri değildir. Kayıtta **Stok, Cihaz, Personel, Verimlilik ve Maliyet** modülleri ile ana **Laboratuvar Paneli** gözlenmektedir. Operasyonel belge/kayıt sayfaları (stok hareketi, sipariş, talep, servis çağrısı) ile rapor/analiz sayfaları (stok yeterlilik, tüketim analizi, test verimliliği, maliyet) farklı işlev görür. Doğru ajan `rapor isteği → rapor ailesi → ilgili panel → filtreler → veri/sayfalama → dışa aktarım veya görünür tablodan okuma → kontrol → yorum ve kaynak` sırasını uygular.

**Ajanın ideal yetenek sınırı:** Yetkili oturumuyla *arayüz üzerinden okuma/rapor alma*; varsayılan **salt-okunur**. Yeni kayıt, stok hareketi, tüketim iptali, onay, senkronizasyon, silme veya izleme ayarı değiştirme gibi işlemler için ayrıca kullanıcı onayı gerekir. Prompt ajana tarayıcı erişimi veya oturum sağlamaz: bunlar bağımsız olarak sağlanmalıdır.

## 2. Temel navigasyon anatomisi

**2.1 Sol navigasyon alanı**

- **Dar dikey ikon rayı:** Solda ana sayfa/ev, stok/küp, cihaz/mikroskop, personel/grup, iletişim/balon, verimlilik/grafik, maliyet/simgeler ve diğer modül ikonları. En altta bildirim zili, yardım, ayarlar ve kullanıcı avatarı görünür. `labIQ` markasının yanındaki **ok/chevron** geniş menüyü açıp kapatır.
- **Geniş menü:** Yaklaşık ilk 300 pikselde, `diacore` başlıklı, seçilen ana modülün ayrıntılı sayfalarını listeler. Seçili menü öğesi mor/vurgu renginde. Menü uzun olduğunda kendi alanında aşağı kaydırılması gerekebilir.
- **İçerik alanı:** Sol menünün sağı (dar görünümde yaklaşık x=104; geniş görünümde x=328 civarı) `Başlık + favori yıldızı ve bazı sayfalarda filtre simgesi` ile başlar. Bazı ekranlarda sağ üst `Dışa Aktar`, `Yazdır` veya `Paraşüt ile senkronize et` vardır.
- **Menü değiştirme:** Raydaki kategori ikonuna tıkla → metin menüsünde ilgili öğeyi seç → içerik başlığı beklenen ad mı doğrula. Menünün yalnızca açılmış olması sayfa yüklemesinin tamamlandığı anlamına gelmez.

**2.2 Ortak arama/filtre deseni**

- **Kayıt listeleri:** Sağ üstte `Filtre` (huni simgesi + açılır ok) ve `Ara...` alanı olabilir. Bazı ekranlarda `Filtre` yalnızca açılır paneldir; bazı raporlarda açık filtre alanları sürekli görünür.
- **Analitik raporlar:** `Tarih Aralığı` veya `Dönem`, `Laboratuvar`, `Laboratuvar Grubu`, `Tüketim Noktası`, `Depo`, `Ürün`, `Tedarikçi`, `Marka`, `Ürün Grubu`, `Ürün Alt Grubu`, `Test Grubu` vb. başlıklarla bir veya iki satırdan oluşan filtre formu bulunur. Aşağıdaki `Temizle` ve koyu `Filtrele` butonları filtre setini uygular/sıfırlar. **Alan seçmek ile `Filtrele`'ye basmak aynı şey değildir.**
- **Açılır seçiciler:** `Lütfen seçiniz`, sağında aşağı ok; kimi alanlarda seçim sonrası **x** temizleme ikonu; açılan listeler kaydırılabilir ve bazıları içeride `Ara...` destekler. Filtrelerde bağımlı seçimler olabilir; seçilen değerin etiketi görsel olarak yeniden doğrulanmalıdır.
- **Liste satırları:** `#` (sıra), başlık yanındaki çift oklar (sıralama), turkuaz/mavi altı çizili kimlikler (detay), tablo sonundaki `15 kayıt göster` seçicisi, sayfa numaraları ve önceki/sonraki oklu sayfalama. Varsayılan 15 her modülde garanti değildir: ekranda kontrol et.
- **Boş/askıda durum:** `Gösterilecek kayıt bulunamadı`, `Hiç kayıt bulunamadı`, `Ürün Seçilmedi`, `Grafik görmek için tablodan bir satır seçin`, dönen spinner ve gri/beyaz yükleme ekranları birbirinden farklıdır. Hiçbiri tek başına kesin `0` sonucunu kanıtlamaz.
- **Detay etkileşimi:** Turkuaz `işlem no`, `ürün adı`, `doküman numarası` veya `test` tıklanınca yeni sayfa/yan panel/modal açabilir; ilk önce başlığın ve filtre kapsamının değişip değişmediği doğrulanır.
- **Çıktı:** `Dışa Aktar` sağ üstte gözlenen rapor/listelerde kullanılır; basıldığında dosya inebilir ya da menü açılabilir. **XLSX/CSV/PDF biçimi kayıttan genel olarak doğrulanmadığı için varsayılmamalıdır.** `Yazdır` bulunan sayfada ayrı yazdırma akışı vardır.

**2.3 Tablo çıkarma standardı**

1. Toplam kayıt bilgisi ve sayfa sayısını tespit et. 2. Eğer dışa aktarma uygunsa onu kullan, indirilen dosyanın oluştuğunu ve o anki filtreleri kapsadığını kontrol et. 3. Değilse sayfa başına kayıt sayısını, sıralamayı ve sayfalamayı takip et; ilk sayfayı tüm veri sanma. 4. Başlıkları aynen al; yatay kaydırma ve içeride kaydırılan tablolara bak. 5. Tarih, saat, TL/€ ve ondalık virgülünü doğru ayrıştır. 6. İşlem no/ürün kodu gibi sıfırları başta kalan alanları **metin** sakla. 7. Her sonuca `(ekran, filtre, zaman aralığı, çekilme zamanı, satır sayısı, dosya)` köken bilgisi ekle.

## 3. Ana sayfa – Laboratuvar Paneli (00:00)

Üst sağda `Laboratuvar: Lütfen seçiniz` seçimi. **Anahtar Performans Göstergeleri:** `Stok Karşılama Oranı 30 Gün Altı`, `Stok Karşılama Oranı 6 Ay Üzeri`, `Yakında Süresi Dolan Ürünler`, `Kritik Stok`, `Ürün Talepleri`, `Destek Çağrıları`, `Cihaz Bakımı`. Alt bölüm `Laboratuvar Genel Bakış` altında `Cihaz Sayısı`, `Personel Sayısı`, `Ürün Sayısı`, `Test Hacmi`, `Eğitim Sayısı`, `Servis Formu Sayısı`, `Destek Talep Sayısı` kartları görünür. Kartlar özet/olası yönlendirme noktalarıdır; kart sayısı detay kaynağıyla doğrulanmadan detaylı rapor oluşturulmaz.

## 4. Stok modülü: eksiksiz görünen navigasyon

Geniş menüden okunabilen sıralama:

**Operasyonlar:** `Stok Hareketleri`, `Ürün Talep` (sayfa başlığı `Ürün Talepleri`), `Ürün Transfer`, `Şirketler Arası Transfer`, `Emanet Takibi`, `Stok Gözlem`, `Depo Gözlem`.  
**Tüketim:** `Ürün Kullanım`, `Tüketim Takibi`, `Kalibrasyon / Kontrol Takibi`, `Tüketim Analiz Raporu`, `Miadı Yaklaşan Ürünler`.  
**Sipariş ve risk:** `Sipariş Formları`, `Açık Sipariş Yönetimi`, `İhtiyaç Planlama`, `Stok Yeterlilik Analizi`, `Kritik Stok Raporu`, `Fazla Stok Analizi`, `Riskli Stok Raporu`, `Stok Hareket Raporu`, `Depolar Arası Transfer Raporu`.  
**Temel veriler:** `Stok Sayım`, `Ürünler`, `Depo`, `Raf Adresleme`, `Test Etiketi`; menünün devamında diğer kart/ayar sayfaları ve `Marka` gibi alanlar görünür. `Tüketim Takibi Değişikliği` ayrıca ayrı ekranda görülmektedir.

### 4.1 Stok Hareketleri (00:13–00:16)

**Yol:** Stok ikonu → `Stok Hareketleri`. **Butonlar:** sol üst `+ Stok Hareketi`; sağ üst `Dışa Aktar`; tablonun üzerinde `Paraşüt İrsaliyesi Aktar`, `Filtre`, `Ara...`. **Görünen kolonlar:** `#`, `İşlem No`, `İrsaliye No`, `Tarih`, `İşlem Tipi`, `Hedef Depo`, `Tedarikçi`, `Ürün Sayısı`, satır sağında işlem ikonları. `İşlem No` turkuaz bağlantılıdır. `İşlem Tipi` için `Giriş` gibi rozetler görülür. **Ajan:** dönem/işlem türü/depo/tedarikçi üzerinden listeyi filtrele; ilgili işlem no detayına in; irsaliye ve ürün sayısı arasındaki ilişkiyi kontrol et; genel listeyi dışa aktar. `Stok Hareketi` oluşturma ve Paraşüt'e aktarma **salt-okunur kapsam dışında**.

### 4.2 Ürün Talepleri (00:17–00:22)

**Yol:** Stok → `Ürün Talep`. **Butonlar:** `+ Yeni Talep`, sekmeler `Açık Talepler`, `Tamamlanan Talepler`, `Bekleyen Kısmi Transferler`; `Filtre`, `Ara...`. **Kolonlar:** `Talep No`, `Talep Tarihi`, `Talep Eden Depo`, `Tedarik Eden Depo`, `Talep Eden`, `Durum`; sağda işlemsel simge. Örnek durum `Onay Bekliyor`. **Ajan:** açık/bekleyen ve tamamlanan talepleri farklı sekmelerde topla; kimlik bazında takip et; toplam açık talepleri karşılaştır. Talep oluşturma/iptal etme otomatik yapılmaz.

### 4.3 Ürün Transfer (00:23–00:35 civarı)

**Yol:** Stok → `Ürün Transfer`. Görüntüde transferin türlerine göre üst kontrol/sekme ve sağda filtre denetimi görünür. Bazı kareler bozuk olduğu için alt kolonların tamamı doğrulanamadı. **Ajan:** kendi gördüğü sekme başlığı ve sayfa adını teyit et, kaynak/hedef depo ve durum gibi **sadece ekranda gerçekten görünen** filtreleri kullan; `İşlem No` ile satır detaylarını bağla. Belge olmadan transfer oluşturmaz/onaylamaz.

### 4.4 Şirketler Arası Transfer (00:35–00:39)

**Butonlar:** `+ Yeni Transfer`, `Kabul Bekleyenler`, `Tamamlananlar`, `Filtre`, `Ara...`. **Kolonlar:** `Transfer No`, `Transfer Tarihi`, `Gönderen Depo`, `Alıcı Şirket`, `Alıcı Depo`. Boş tablo görülüyor; bu `tüm dönemlerde transfer yok` sonucuna eşit değil, aktif sekme ve filtre koşuludur.

### 4.5 Emanet Takibi (00:40–00:47)

**Butonlar:** `+ Emanet`, ekrandaki ikinci işlem butonu/sekme ve filtre. Liste temelli ekran görülür; bazı yazılar 30 fps kayıt artefaktı nedeniyle güvenilir okunmaz. **Ajan:** mevcut emanet hareketlerinin envanterden nasıl ayrıldığını önce UI üzerinden doğrular; emanet kayıtları normal stok girişine otomatik eklenmez.

### 4.6 Stok Gözlem (00:48–00:56)

**Yol:** Stok → `Stok Gözlem`. **Üst sağ:** `Paraşüt ile senkronize et` ve `Dışa Aktar`. **Açık filtre alanları:** `Tedarikçi`, `Marka`, `Ürün Grubu`, `Ürün Alt Grubu`, `Test Grubu`, `Depo`, `Arama (Ürün Ara...)`, `Stok miktarı olmayanları gizle` anahtarı, `Temizle`, `Filtrele`. **Tablo:** `Ürün Kodu`, `Ürün Adı`, `Tedarikçi`, `Ürün Kategori`, `Stok Miktarı`, `Birim`, `Toplam Miktar`, `Ortalama Tüketim (30...)` ve yatay devamı. **Kritik fark:** `Stok Miktarı` paket/kutu adedi, `Toplam Miktar` paket içeriğiyle çarpılmış başka birim olabilir. Birim dönüşümünü ayırmadan stok karşılaştırması yapma. Ürün adından tıklayarak `Stok Ekstresi`ne gidilebilir. `Paraşüt ile senkronize et` veri değiştirebileceği için izinsiz kullanılmaz.

### 4.7 Ürün Stok Ekstresi (00:56–01:03)

**Yol:** Stok Gözlem → `Ürün Adı` bağlantısı (veya uygun `Ekstre` ikonu). **Başlık:** `ürün kodu - ürün adı Stok Ekstresi`. Sağ üst `Geri`, `Yazdır`, `Dışa Aktar`. Başlık altındaki meta alanlar kategori/tedarikçi/test grubu/tüketim takip durumu. Sol `Toplam Stok Miktarı`, altında depo sayısı bağlantısı. **Filtreler:** `Tarih Aralığı`, `Hareket Tipi`, `Depo`, `Arama`, `Temizle`, `Filtrele`. **Kolonlar:** `Tarih`, `İşlem No`, `Belge No`, `Kaynak Depo`, `Hareket Tipi`, `Hedef Depo`, `LOT`, `Miat`, `Miktar`, `Birim`, `Toplam Stok`. Türler arasında `Giriş`, `Çıkış`, `Kullanım` gözlendi. **Ajan:** kronoloji ve birim üzerinden hareketleri tutarlı sırala; `Giriş/Çıkış/Kullanım` semantiğini ayır; `Toplam Stok` son stok snapshot'ıyla aynı mı kontrol et. Tarihi bir hareketin etkisinin depo transferlerinde iki taraflı kayda yol açabileceğini gözet.

### 4.8 Depo Gözlem (01:04–01:12)

**Butonlar:** `Dışa Aktar`, `Yazdır`. **Filtreler:** `Depo`, `Tedarikçi`, `Marka`, `Ürün Grubu`, `Ürün Alt Grubu`, `Test Grubu`, `Arama (Ürün Ara...)`; `Temizle`, `Filtrele`. **Kolonlar:** `Ürün Kodu`, `Ürün Adı`, `Marka`, `Raf Adresleme`, `LOT`, `Miat`, `Stok Miktarı`, `Birim`. Filtre sonrası boş liste örneği görülüyor. **Ajan:** lot/miat ayrımını koruyarak depo bazında ham kayıt çıkar; stok düzeyi sıfır ise mutlaka tablo/filtre kapsamıyla birlikte raporla.

### 4.9 Ürün Kullanım (01:13–01:23)

**Butonlar:** `+ Yeni Ürün Kullanımı`, `Verimlilik Aktarım`, `Tara`, durum sekmeleri `Kullanımlar`, `İptal Edilen Kullanımlar`, sağ `Dışa Aktar`, `Filtre`, `Ara...`. **Kolonlar:** `İşlem No`, `Tarih`, `Oluşturma Tarihi`, `Tüketim Noktası`, `Ürün`, `Cihaz`, `LOT`, `Miat`, `Miktar`, `Birim`, `Açıklama`; iptal sekmesinde `İptal Tarihi`, `İptal Nedeni`, `İptal Eden`. **Ajan:** brüt hareket, iptal edilen hareket ve net geçerli hareketi ayrı tanımla; verimlilik aktarımı otomatik çalıştırılmaz.

### 4.10 Tüketim Takibi (01:24–01:40)

**Filtreler:** `Tarih Aralığı`, `Marka`, `Ürün Grubu`, `Ürün Alt Grubu`, `Tedarikçi`, `Cihaz`, `Tüketim Cinsi`, `Laboratuvar`, `Tüketim Noktası`, `Arama`. **Kolonlar:** `İşlem No`, `Tarih`, `Hareket Tipi`, `Tüketim Noktası`, `Cihaz`, `Ürün Kodu`, `Ürün Adı`, `LOT`, `Miat` ve sağda miktar alanları. **Ajan:** hangi satırların gerçek `Kullanım`, hangilerinin `Çıkış` olduğuna göre sınıflandırma yap; iptalleri veya aynı ürünün farklı hareketlerini mükerrer sayma.

### 4.11 Kalibrasyon / Kontrol Takibi (01:40–01:51 civarı)

Ayrı filtreli liste ekranı görülür. İlgili ürünlerin kullanımını tüketim/kullanımdan ayrı değerlendirmek önemlidir. **Kolon ve filtrelerin tümü doğrulanmadı**; kullanıcı isteğinde bu kırılım varsa ilgili sayfanın canlı arayüzü açılarak alanlar yeniden keşfedilir.

### 4.12 Tüketim Analiz Raporu (01:48–01:52)

**Filtreler:** `Tarih Aralığı`, `Laboratuvar`, `Tüketim Noktası`, `Ürün`, `Marka`, `Tedarikçi`, `Ürün Grubu`, `Ürün Alt Grubu`, `Test Grubu`, `Laboratuvar Grubu`. **Tablo:** `Ürün Kodu`, `Ürün Adı`, `Marka`, `Ürün Kategori`, `Tüketim Miktarı`, `Birim`, `Tüketilen Adet/Test`, `Seçilen Tarih Aralığında Ortalama Aylık Tüketim`, `Son 3 Aydaki Ortalama Aylık Tüketim`, `Fark Yüzdesi`. **Ajan:** raporun talep edilen dönemini ve baz/karşılaştırma dönemini metinde açıkla; oranları yön ve payda sıfır kontrolüyle yorumla. Sonuç boşsa sayıyı sıfır yazma.

### 4.13 Miadı Yaklaşan Ürünler (01:52–02:04 civarı)

Miat/son kullanma tarihi bazında ürün ekranı görülür. Aralık, depo/lot ve tarih alanlarının tümü güvenilir okunmuyor. **Ajan:** ürün kimliği + depo + LOT + miat + miktarı zorunlu rapor alanı olarak iste; yalnızca kullanıcı yetkili canlı ekranda alanları doğruladıysa filtre uygula.

### 4.14 Sipariş Formları (02:05–02:15)

**Buton:** `+ Yeni Sipariş`; `Filtre`, `Ara...`. **Kolonlar:** `Tarih`, `Sipariş No`, `Depo`, `Tedarikçi`, `Sipariş Kaynağı`, `Durum`. `Onay Bekliyor` görülür. Sipariş numarası tıklanınca `Sipariş Formu` modalı açılır: üstte durum, numara, tarih, depo, tedarikçi, notlar; içeride `Ürün`, `Miktar`, `Birim`, `Birim Fiyat`, `Toplam Fiyat`. Sağ üst modalda `İşlemler` ve `Kapat`. **Ajan:** sipariş satırlarını modal detayından al; teklif/fiyat/currency ayrımını koru; `İşlemler` altındaki onay/değiştirme faaliyetlerine onaysız tıklama.

### 4.15 Açık Sipariş Yönetimi (02:15–02:24 civarı)

Liste/filtre ekranı görünür; sipariş takibiyle bağlantılıdır. Detay kolonların tamamı okunamadı. **Ajan:** devam eden siparişlerle sipariş formları ve ihtiyaç planlama kimliklerini bağla, kesin eşleşme yoksa olası ilişki diye işaretle.

### 4.16 İhtiyaç Planlama (02:24–02:36)

**Buton:** `+ Yeni İhtiyaç Planlama`, `Filtre`, `Ara...`. **Kolonlar:** `Doküman Numarası`, `Tarih`, `Laboratuvar`, `Tedarikçi Firma`, `Test Grubu`, `Stok Grubu`, `İstatistik Süre (Ay)`, `Stok Yeterlilik (Ay)`. Doküman numarası turkuaz bağlantıdır. **Ajan:** planlanan miktarı fiili stokla karıştırma; istatistik süresi, stok yeterlilik hedefi ve test grubu parametrelerini başlıkta açıkça ver.

### 4.17 Stok Yeterlilik Analizi (02:36–02:50)

**Filtreler:** `Laboratuvar`, `Tüketim Noktası`, `Ürün`, `Ürün Grubu`, `Tedarikçi`, `Marka`, `Test Grubu`, `Hedef Karşılama Süresi (Gün)`, `N/A Ürünleri Hariç Tut`; `Temizle`, `Filtrele`. **Sekmeler:** `Hedefin Altındaki Ürünler`, `Tüm Ürünler`, `Hedefin Üzerindeki Ürünler`. **Kolonlar:** `Ürün Kodu`, `Ürün Adı`, `Test Adı`, `Mevcut Stok`, `Birim`, `Ort. Aylık Tüketim`, `Min. Stok Süresi (Gün)`, `Karşılama Süresi (Gün)`. **Ajan:** hedef gün açıkça verilmediyse zorunlu parametre olarak iste veya mevcut UI varsayılanını göster; birim uyumsuzluklarını işaretle; hedef altında/üstünde sekme farkını açıklığa kavuştur.

### 4.18 Kritik Stok Raporu (02:50–03:00 civarı)

Ayrı stok risk ekranı. Kaynakta sayfa adı gözlenir; tüm kontrol alanları tam okunmadığından `Stok Yeterlilik Analizi` ile **aynı ekran diye kabul edilmez**. Ajan özgül kritik eşik mantığının canlı ekrandaki tanımını teyit eder.

### 4.19 Fazla Stok Analizi (03:00–03:26)

**Filtreler:** `Laboratuvar`, `Tüketim Noktası`, `Ürün Grubu`, `Ürün Alt Grubu`, `Tedarikçi`, `Marka`, `Test Grubu`, `Laboratuvar Grubu`. **İki katman:** `Ürün Bazında Fazla Stok Analizi` tablosu (ürün kodu, adı, marka, kategori, stok fazlası, birim), altında `Ürün Detayları`. Alt bölüm başlangıçta `Ürün Seçilmedi` yazar ve **üst tablodan satır seçilmesini** ister. **Ajan:** tabloya satır gelmedikçe detay bölümü boş kalır; kaydı `0 stok fazlası` diye yorumlama; ürün ayrıntısı gerektiğinde satır tıklayıp ikinci karttaki hesaplamayı kaydet.

### 4.20 Riskli Stok Raporu (03:26–03:43)

**Filtreler:** `Laboratuvar`, `Tüketim Noktası`, `Ürün Grubu`, `Ürün Alt Grubu`, `Tedarikçi`, `Marka`, `Test Grubu`, `Laboratuvar Grubu`. **Tablo:** `Ürün Kodu`, `Ürün Adı`, `Marka`, `Ürün Kategori`, `Stok Fazlası`, `Birim`, `Aktarılabilir Stok Önerisi`, `Ort. Aylık Tüketim`, `İmha Tehlikesi`. Alt `Ürün Detayları` üst satır seçimiyle açılır. **Ajan:** `riskli`/`fazla`/`kritik` birbirinden farklı rapor aileleridir; otomatik eşitleme yapma. Öneri alanını gerçekleşmiş transfer sanma.

### 4.21 Stok Hareket Raporu (03:45–04:05)

**Filtreler:** `Tarih Aralığı`, `Depo`, `Tedarikçi`, `Ürün`, `Marka`, `Ürün Grubu`, `Ürün Alt Grubu`, `Test Grubu`, `Laboratuvar Grubu` (bir filtre dropdown'u açılarak arama davranışı görülüyor). **Tablo:** `Ürün Kodu`, `Ürün Adı`, `Marka`, `Ürün Kategori`, `Giriş`, `İade`, `İmha`, `Net Fark` ve sağa uzanabilen diğer hareket sütunları. **Ajan:** grup bazında net hareket görmek için bu sayfayı kullan, fakat anlık envanteri `Stok Gözlem` ile teyit et; dönem sınırı ve depo çok önemlidir.

### 4.22 Depolar Arası Transfer Raporu (04:05–04:18)

**Filtreler:** `Tarih Aralığı`, `İşlem Tipi`, `Kaynak Depo`, `Hedef Depo`, `Tedarikçi`, `Marka`, `Test Grubu`, `Ürün Grubu`, `Ürün Alt Grubu`, `Arama (Ürün Ara...)`. **Tablo:** `İşlem No`, `Tarih`, `Ürün Kodu`, `Ürün Adı`, `Marka`, `Kaynak Depo`, `Hedef Depo`, `LOT`, `Miat`, `Miktar`, `Birim`. **Ajan:** depo çiftleri ve dönem bazında transferi say; transferi kuruluş genelinde nihai tüketim sanma. Kaynak/hedef ayrımı zorunludur.

### 4.23 Stok Sayım (04:18–04:27)

`Yeni Sayım` gibi operasyon butonlarının bulunduğu liste sayfası. **Ajan:** sayım fişleri/gerçekleşen sayım farklarını salt-okunur alabilir; sayım başlatma veya farkı stoklara işleme kullanıcı onayına tabidir. Bütün alt kolonlar doğrulanmadı.

### 4.24 Ürünler (04:27–04:39)

**Butonlar:** `+ Yeni Ürün`, `+ Yeni Paket Ürün`, `Depo Tanımla`, `Paraşüt ile senkronize et`, `Dışa Aktar`, `Filtre`, `Ara...`. **Sekmeler:** `Aktif Ürünler`, `Pasif Ürünler`, `Hareketsiz Ürünler`. **Kolonlar:** `Ekstre` ikon sütunu, `Ürün Kodu`, `Ürün Adı`, `Alt Ürünler`, `Tedarikçi`, `Marka`, `Ürün Kategori`, `Ürün Alt Kategori`, `Test`, `Test Grup`, `Laboratuvar Grup`, `Saklama Koşulu`. **Ajan:** tekil ürün ana kartında doğru ürün koduyla eşleştir; aktif/pasif durumu raporda belirt; satırdaki `Ekstre` bağlantısını detay geçmişi için kullan. Ürün oluşturma/depoya bağlama/senkronizasyon yapma.

### 4.25 Depo (04:39–04:49)

**Sekmeler:** `Aktif Depolar`, `Pasif Depolar`; `Filtre`, `Ara...` ve kullanıcı yönetimine ilişkin kontrol. **Kolonlar:** `Laboratuvar`, `Depo`, `Tüketim Yeri`, `Depo Tipi`, `Depo Kullanıcısı`, `Tüketim Takibi`, `Transfer Kabulü`. Rozetler `Açık / Kapalı`, `Otomatik` vb. **Ajan:** depo tipine göre ayrı işlem kuralları olabilir, `Transfer Kabulü: Otomatik` bilgisini transfere ilişkin yanıt verirken görünür özellik olarak sakla; ayar değiştirme.

### 4.26 Raf Adresleme / Test Etiketi / Marka (04:49–05:00 civarı)

Raf ve etiketler sol menüde; `Marka` sayfası 04:57 civarında görüldü: `+ Yeni Marka`, `İsim` tablosu, satırda düzenle (kalem) / sil (çöp) ikonları. **Ajan:** master data listesini rapora referans veri olarak alabilir; markaları düzenle/silme yasağı.

### 4.27 Tüketim Takibi Değişikliği (05:00–05:14)

**Seçimler:** `Değişiklik Türü: Depo Bazında / Ürün Bazında`; sağda `Tüketim Takibi` seçicisi, `Durum: Kapalı/Açık`, `Takibi Aç` eylem butonu. Sayfa açıklaması: takip açıldığında ürünler otomatik takip edilir. **Ajan:** bu ekran rapor kaynağı değil, **ayar değişiklik panelidir**; açık/kapalı durumunu okuyabilir, onay olmadan `Takibi Aç/Kapat` yapamaz.

## 5. Cihaz modülü

Sol menüde **Cihaz**, **Cihaz Yaş Raporu**, **Bakım/Kalibrasyon Raporu**, **Bakım Planları**, **Servis Çağrıları**, **Servis Formları**, **Cihaz Teknisyenleri**, **Cihaz Giderleri**, **Servis Performans Raporu**, **Cihaz Test Kapasite Planlaması**, **EQA Üyelikleri**, **EQA Numune Giriş**, **Numune Çalışma Takibi**, **Cihaz Kategorisi**, **Cihaz Arıza Tipi** görünür. Bir `Finans Denetçisi` ekranında onay akışı tanımlama alanı görülür; modül bağlamı kayıt sırasında net ayrışmadığından tek başına stok raporuna bağlanmamalıdır.

**5.1 Cihaz listesi (05:15 sonrası):** Cihaz/seri, marka, model, laboratuvar/tüketim noktası, durum gibi alanları içeren liste; erişim ve kolon doğrulaması canlı ekranda yapılmalıdır.

**5.2 Cihaz Yaş Raporu:** cihaz yaşı, model/marka/laboratuvar kırılımları için ayrı sayfa; filtre ayrıntıları net okunmadı.

**5.3 Bakım/Kalibrasyon Raporu (05:45):** `Marka`, `Laboratuvar`, `Laboratuvar Grubu`, `Test Grubu` filtreleri, `Temizle/Filtrele`; özet KPI'lar `Bakım/Kalibrasyon Planına Dahil Cihaz Sayısı`, `Kalibrasyon Planına Dahil Cihaz Sayısı`, `Bakım/Kalibrasyonu Yaklaşan Cihaz Sayısı`, `Zamanında Bakım Yüzdesi`, `Bakım/Kalibrasyonu Geçen Cihaz Sayısı`, `Plana Dahil Olmayan Cihaz Sayısı`; `Marka Bazlı Zamanında Bakım Yüzdesi` grafiği, `Bakım/Kalibrasyonu Geçen Cihaz Sayısı` grafiği, `Bakımları Yaklaşan / Geçen Cihaz Listesi` detay tablosu. **Ajan:** filtrelenmiş tabloyu grafik toplamıyla çapraz kontrol et.

**5.4 Servis Çağrıları (06:00–06:15):** `+ Yeni Servis Çağrısı`, `Açık Çağrılar` / `Kapalı Çağrılar` sekmeleri, `Filtre`, `Ara...`, `Dışa Aktar`; `Çağrı No`, `Bildirim Tarihi`, `Laboratuvar`, `Tedarikçi`, `Sorumlu`, `Cihaz`, `Tüketim Noktası`, `Marka`, `Model`, `Arıza Tarihi`, `Öncelik`, `Bildiren` sütunları. **Ajan:** çağrı sayısını açık-kapalı ayrımıyla ve öncelik/seviye bazında üret; hiçbir çağrıyı kapatma.

**5.5 Servis Formları (06:12 civarı):** tablo ve açılan detay modalı gözlendi; modalda farklı alanlar yer alır. Liste başlıklarının tamamı okunamadı, kayıt bazlı detay modalını açmak gerekir.

**5.6 Cihaz Teknisyenleri (06:24–06:36):** `+ Yeni Cihaz Teknisyeni`, `Filtre`, `Ara...`, `Dışa Aktar`; `Cihaz Kodu`, `Cihaz Adı`, `Marka`, `Model`, `Seri Numarası`, `Kullanıcı`, `Başlama Tarihi`, `Bitiş Tarihi`. **Ajan:** kullanıcı/personel atamasını kişi adı ve cihaz kodu ile, tarih geçerliliğine dikkat ederek raporla.

**5.7 Cihaz Giderleri:** gider belgesi ve cihaz eşleştirmesi için liste; tüm alanlar doğrulanmadı. `Maliyet` modülündeki giderlerle otomatik aynı veri seti sanılmamalı.

**5.8 Servis Performans Raporu (06:40–07:05):** `Dönem`, `Marka`, `Laboratuvar Grubu`, `Test Grubu`, `Servis Tipi`, `Sorumlu` filtreleri. KPI'lar `Toplam çağrı`, `Hedef süreyi aşan çağrı`, `Hedef süreyi aşan çağrı oranı`, `Ortalama çözüm süresi (dakika)`, `Ortalama teknik kontrol süresi (dakika)`; `Arıza Durumuna Göre Dağılım`, `Arıza Grubuna Göre Dağılım`, `Servis Tipine Göre Dağılım`, `Aylık Trend` grafikleri. **Ajan:** `dakika`yı saat/gün dönüşümünden önce kaynak birimi olarak sakla; raporun dönemini başlıkta belirt.

**5.9 EQA Üyelikleri (07:10 civarı):** `+ Yeni EQA Üyelik`, `Filtre`, `Ara...`; `Sözleşme No`, `Laboratuvar`, `Dönem`, `EQA Programı`, `Üyelik Adedi`, `Tedarikçi`, `Birim Fiyat`, `Durum`. Para birimi karışık olabilir (€, ₺); otomatik toplam veya dönüşüm yapılmaz.

**5.10 EQA Numune Giriş / Numune Çalışma Takibi / Cihaz Kategorisi:** sayfaların varlığı gözlendi; tam kontroller doğrulanmadı. **5.11 Cihaz Arıza Tipi (07:30 civarı):** `+ Yeni Cihaz Arıza Tipi`; `İsim`, `Arıza & Hata Grubu`, `Oluşturulma Tarihi` tablo kolonları; boş kayıt örneği.

## 6. Personel modülü

`Personeller` liste görünümü ve `Personel Analizi` raporu gözlendi. **Personel Analizi (07:45–08:06):** `Dönem` (`Son 3 Ay` örnek), `Laboratuvar`, `Laboratuvar Grubu`, `Personel Grubu`, `Temizle/Filtrele`; KPI'lar `Aktif Personel Sayısı`, `Başlayan / Ayrılan`, `Personel Dönüşüm Oranı`, `Tamamlanan / Planlanan Eğitim`. Grafikler `İzin Kullanım Dağılımı`, `Eğitim Dağılımı`, `Aylık Personel Maliyeti`, `CPR Personel Maliyeti Oranı`. **Ajan:** kişisel verileri en az düzeyde kullan; kullanıcı yalnızca toplulaştırılmış rapor istediyse isim/tekil kayıt çekme.

## 7. Verimlilik modülü

Gözlenen menü: `Test Kataloğu`, `Dönemsel Tüketim`, `Dönemsel Sonuçlar`, `Verimlilik Analizi`, `Test Verimlilik Raporu`, `Fire Analizi`, `Odaklı Verimlilik Raporu`, `Laboratuvar Verimlilik Karşılaştırması`, `Verimlilik Eşleştirmeleri`.

**7.1 Test Kataloğu (08:08–08:24):** ana listeden test detayına gidilir. Detay kartında `Test ID`, `Test Adı`, `Geri Ödeme Kodu`, `LOINC Kodu`, `Test Etiketleri`, `Paket Testler`, `Laboratuvar Grubu`, `Test Grubu`, `CPR Faktörü`, `Hedef Verimlilik Oranı`, `Özel Test`; sağ `Bağlı Testler` ve `+ Yeni Bağlı Test`, üst sağ `Geri`, `Düzenle`. **Ajan:** kodları string koru, bir testin başka teste bağlı olabileceğini ayırt et; `Düzenle` kullanılmaz.

**7.2 Dönemsel Tüketim (08:20–08:44):** aralık/laboratuvar/test kırılımlı hesap/kayıt sayfası; tablo yatay kaydırılabilir, satır sayfalaması vardır. Bir örnekte sağ üst `Veriler Güncellendi` başarı bildirimi göründü; birinin veri güncellemiş olması ajana otomatik güncelleme yetkisi vermez. Özellikle bu kaynak kit tüketimi için ayrıdır.

**7.3 Dönemsel Sonuçlar (08:44–09:00):** Laboratuvar, test ve dönem bazında sonuç hacmi görüntülenir; test adları, grup ve sayısal sonuçlar içeren tablo. Detay kolonları değişkendir. **Ajan:** kit tüketimiyle sonuç sayısını test kimliği/test grubu üzerinden eşleştir; test bazlı oranlarda farklı paydaları karıştırma.

**7.4 Verimlilik Analizi (09:00–09:12):** özet göstergeli analitik sayfa; laboratuvar/test bazında tüketim-sonuç ilişkilendirmesi. **Ajan:** hesaplama formülü görünmüyorsa platformun metrik etiketini koru, kendiliğinden formül uydurma.

**7.5 Test Verimlilik Raporu (09:12–09:36):** `Tarih Aralığı`, `Laboratuvar`, `Test Grubu`, `Laboratuvar Grubu`, `Test`, `Özel Test`, `Test Etiketi` filtreleri; KPI `Toplam Tüketim`, `Toplam Sonuç`, `Ortalama Verimlilik %`, `Verimlilik Sapan Test Sayısı`, `Verimlilik Sapan Test %`. `Test Verimlilik Tablosu` kolonları `Test Adı`, `Tüketim`, `Üretilen Sonuç Sayısı`, `Verimlilik`, `Verimlilik Hedefi`, `Hedef Realizasyonu`. Tablo içinde ayrı dikey scrollbar; alt grafikte seçili test verimliliği ve dönemsel değişim gösterilebilir. **Ajan:** toplam tüketim ile sonuç farkını verimlilik raporundan al, sıra/filtre/tablo içi tüm satırların alındığını doğrula.

**7.6 Fire Analizi (09:36–09:54):** `Test Grubu`, `Laboratuvar`, `Laboratuvar Grubu`, `Test`, `Ürün` vb. filtrelerden oluşan grafik/kart ekranı; metrikler `Fire`, `Fire Oranı`, `İptal`/kayıp ayrımlarını barındırabilir. Görünen panel isimleriyle raporla, net hesaplama formülü kaynakta okunmuyorsa uydurma.

**7.7 Odaklı Verimlilik Raporu (09:55–10:08):** tablo ve detay grafik etkileşimi; ilgili test/ürün seçildikten sonra birden çok görselleştirme. **7.8 Laboratuvar Verimlilik Karşılaştırması / Verimlilik Eşleştirmeleri:** adlar sol menüde görünür; tüm parametreler için ek canlı keşif gerekli.

## 8. Maliyet modülü

Görünen menü: `Maliyet Gösterge Paneli`, `Maliyet Analiz Raporu`, `Gider Pivot Analizi`, `Tedarikçi Sözleşme Raporu`, `Sonuç Başı Maliyet`, `Test Maliyet Analizi`, `Test Maliyet Karşılaştırma`, `CPR Anomali Raporu`, `Maliyet Anomali Raporu`, `Ürün Birim Maliyet Raporu`, `Depo Stok Maliyet Analizi`, `Aylık Depo Stok Maliyet Analizi`, `Stok Maliyet Raporu`, `İmha Raporu`, `Giderler`, `Tedarikçi Sözleşmeleri`, `Tedarikçi Hakedişleri`, `Döviz Kuru`, `Gider Tipi`.

**8.1 Maliyet Gösterge Paneli (10:08–10:27):** `Dönem`, `Laboratuvar`, `Laboratuvar Grubu`, `Test Grubu` filtreleri; KPI'lar `Toplam Maliyet`, `Sonuç Başı Ortalama Maliyet`, `En Yüksek Maliyetli Test Grubu`, `En Yüksek Maliyetli Tedarikçi`, `En Yüksek Maliyetli Marka`. `Toplam Maliyet Trendi`, `Laboratuvar Grubu Bazlı Maliyet`, `Ürün Kategorisi ve Gider Grubu Bazında Maliyet Dağılımı`, `Test Grubu Hacmi Maliyet Dağılımı` gibi grafikler. **Ajan:** para birimini başlığa koy; toplulaştırmaları filtrelerden sonra yeniden al; `sonuç maliyeti` ile `toplam maliyet`in matematiksel bağını payda üzerinden denetle.

**8.2 Maliyet Analiz Raporu (10:28–10:39):** tarih ve laboratuvar/test grubu odaklı tablo; tüm filtre/kolonların görüntüsü kısmen bozuk. **Ajan:** gösterge paneli özetine kaynak olabilecek ayrıntılı maliyet kırılımını bu sayfada arar ama özeti tablolarla mutabakat yapmadan kesinleştirmez.

**8.3 Gider Pivot Analizi / Tedarikçi Sözleşme Raporu (10:40–10:48 civarı):** menü/sayfa gözlemi mevcut, tam alan keşfi gerekli. Farklı para birimleri ve gider grupları ayrı tutulmalıdır.

**8.4 Sonuç Başı Maliyet / Test Maliyet Analizi / Test Maliyet Karşılaştırma (10:48–11:01):** test/sonuç ve maliyet ilişkisine odaklı sayfalar; bazıları grafik bazlı, bazıları tablo bazlı. Ajan aynı dönem ve lab kesitinde iki ayrı sayfayı eşleştirir.

**8.5 CPR Anomali Raporu (11:01–11:12 civarı):** `CPR Aylık Laboratuvar ve Cihaz Markası Bazlı Sapma Analizi` tablo kolonları `Laboratuvar`, `Cihaz Markası`, `Dönem`, `Test`, `Test Grubu`, `CPR`, `Ort. CPR`, `Sapma Oranı`; sağ `Aylık CPR` grafiği tablo satırı seçilince gelir. Alt bölüm `CPR Aylık Cihaz Markası ve Maliyet Grubu Odaklı Sapmalar` ile `Aylık Maliyet Grubu CPR`; boş tabloda `Grafik görmek için tablodan bir satır seçin` mesajı. **Ajan:** tablodan satır seçilmeden grafikte seri yoksa sıfır değildir.

**8.6 Maliyet Anomali Raporu / Ürün Birim Maliyet Raporu (11:12–11:28 civarı):** ürün bazlı anomali ve birim maliyet değerlendirme ekranları; tüm parametreler kayıttan tek tek doğrulanamadı. Ajan yüzdesel anomali ile mutlak TL sapmasını ayırmalıdır.

**8.7 Depo Stok Maliyet Analizi / Aylık Depo Stok Maliyet Analizi / Stok Maliyet Raporu (11:28–11:56):** depo, ürün ve dönem odaklı rapor ailesi. Ürün stok/maliyet detayı tablosunda `Stok Giriş Tarihi`, `İşlem No`, `Depo`, `Miktar`, `Birim`, `Sözleşme Birim Fiyatı`, `Birim Maliyet`, `Toplam Maliyet`, `Değişim` görülür; ayrıca `Toplam Stok Miktarı` ve `Toplam Stok Maliyeti`, ilgili kartın `Dışa Aktar`ı bulunur. **Ajan:** maliyetsiz/0 TL kartlarını ayrı sınıflandır; `0` kayıtla `henüz sözleşme birim fiyatı yok` olasılığı karıştırılmamalıdır.

**8.8 İmha Raporu (11:56–12:05):** `Tarih Aralığı`, `Depo`, `Tedarikçi`, `Ürünler`, `Marka`, `Ürün Grubu`, `Ürün Alt Grubu`; `Temizle`, `Filtrele`; `Ürün Bazında İmha Raporu` tablosu `Ürün Kodu`, `Ürün Adı`, `Marka`, `Ürün Kategori`, `İmha Miktarı`, `Birim`, `Toplam Maliyet`; `Ürün Detayları` ancak tablodan ürün seçimiyle açılır. Boş sayfada `Sonuçları görmek için lütfen arama veya filtre seçeneklerini kullanın` uyarısı gösterilir: varsayılan boşluk 0 imha değildir.

**8.9 Tedarikçi Sözleşmeleri (12:05–12:20):** `+ Yeni Tedarikçi Sözleşmesi`, `Filtre`, `Ara...`; kolonlar `Sözleşme Numarası`, `Sözleşme Tipi`, `Tedarikçi`, `Laboratuvar`, `Sözleşme Başlangıç`, `Sözleşme Bitiş`, `Durum` ve sağ düzenle/sil ikonları. Sözleşme numarası turkuaz bağlantıdır. **Ajan:** maliyet birim fiyatına dayanak sözleşmenin geçerli olduğu tarih aralığını ve para birimini kaydet; süresi bitmiş ve aktif kartı ayır.

**8.10 Tedarikçi Hakedişleri (12:20 civarı):** menüde görünür; video sonunda geçiş olsa da tablo alanları eksik gözlendi. **Ajan:** kullanıcı hakediş sorarsa önce bu sayfayı canlı açıp kapsam ve kolonları keşfeder; hakediş bedelini stok maliyetiyle özdeşleştirme.

**8.11 Giderler / Döviz Kuru / Gider Tipi:** temel/muhasebe referans sayfaları. En az maliyet raporu anındaki kur tarihi ve gider tipi için eşleştirme bilgisi tutulmalıdır; değişiklik yapılmaz.

## 9. Yapılandırılmış ekran kataloğu ve öğrenme düzeyleri

`A = okunabilir ekran/filtre/tablo kanıtı`, `B = sayfa adı ve kısmi yapı`, `C = yalnızca menü/bağlantı, tam işlem bilinmiyor`.

| Modül | Sayfa | Düzey | Veri erişim tipi | Kanıt zamanı |
|---|---|---|---|---|
| Stok | Stok Hareketleri | A | kayıt listesi / detay / export | 00:13–00:16 |
| Stok | Ürün Talepleri | A | durum sekmeli liste | 00:17–00:22 |
| Stok | Ürün Transfer | B | transfer sekmeleri / liste | 00:23–00:35 |
| Stok | Şirketler Arası Transfer | A | sekmeli liste | 00:35–00:39 |
| Stok | Emanet Takibi | B | operasyon/liste | 00:40–00:47 |
| Stok | Stok Gözlem | A | filtreli stok tablosu / export | 00:48–00:56 |
| Stok | Ürün Stok Ekstresi | A | hareket detay tablosu / yazdır/export | 00:56–01:03 |
| Stok | Depo Gözlem | A | lot bazlı stok / export | 01:04–01:12 |
| Stok | Ürün Kullanım | A | sekmeli operasyon listesi / export | 01:13–01:23 |
| Stok | Tüketim Takibi | A | filtreli hareketler | 01:24–01:40 |
| Stok | Kalibrasyon/Kontrol Takibi | B | takip/filtre | 01:40–01:51 |
| Stok | Tüketim Analiz Raporu | A | karşılaştırmalı tablo | 01:48–01:52 |
| Stok | Miadı Yaklaşan Ürünler | B | tarih/LOT bazlı liste | 01:52–02:04 |
| Stok | Sipariş Formları | A | liste + satırlı modal | 02:05–02:15 |
| Stok | Açık Sipariş Yönetimi | B | sipariş takip listesi | 02:15–02:24 |
| Stok | İhtiyaç Planlama | A | parametreli ihtiyaç planları | 02:24–02:36 |
| Stok | Stok Yeterlilik Analizi | A | hedef gün / durum sekmeleri | 02:36–02:50 |
| Stok | Kritik Stok Raporu | B | risk tablosu | 02:50–03:00 |
| Stok | Fazla Stok Analizi | A | özet + satır detayı | 03:00–03:26 |
| Stok | Riskli Stok Raporu | A | özet + satır detayı | 03:26–03:43 |
| Stok | Stok Hareket Raporu | A | dönem/ürün hareket | 03:45–04:05 |
| Stok | Depolar Arası Transfer Raporu | A | kaynak/hedef transfer | 04:05–04:18 |
| Stok | Stok Sayım | B | operasyonel liste | 04:18–04:27 |
| Stok | Ürünler | A | master veri / ekstre | 04:27–04:39 |
| Stok | Depo | A | master veri / durum | 04:39–04:49 |
| Stok | Raf Adresleme, Test Etiketi | C | tanım sayfaları | 04:49–04:58 |
| Stok | Marka | A | yönetim listesi | 04:57–05:00 |
| Stok | Tüketim Takibi Değişikliği | A | ayar – salt okunur | 05:00–05:14 |
| Cihaz | Cihaz, Cihaz Yaş Raporu | B | envanter/rapor | 05:15–05:45 |
| Cihaz | Bakım/Kalibrasyon Raporu | A | KPI/grafik/tablo | 05:45–06:00 |
| Cihaz | Servis Çağrıları | A | açık/kapalı kayıt listesi | 06:00–06:15 |
| Cihaz | Servis Formları | B | liste/detay modalı | 06:12–06:24 |
| Cihaz | Cihaz Teknisyenleri | A | atama tarihçesi | 06:24–06:36 |
| Cihaz | Cihaz Giderleri | B | gider listesi | 06:36–06:43 |
| Cihaz | Servis Performans Raporu | A | KPI/grafik | 06:40–07:05 |
| Cihaz | EQA Üyelikleri | A | sözleşme liste | 07:10–07:20 |
| Cihaz | EQA Numune Giriş, Numune Çalışma Takibi | B | numune yönetimi | 07:20–07:30 |
| Cihaz | Cihaz Arıza Tipi | A | yönetim listesi | 07:30–07:34 |
| Personel | Personeller | A | kayıt listesi | 07:35–07:45 |
| Personel | Personel Analizi | A | KPI/grafik | 07:45–08:06 |
| Verimlilik | Test Kataloğu | A | test detay kartı | 08:08–08:24 |
| Verimlilik | Dönemsel Tüketim, Dönemsel Sonuçlar | B | geniş veri tabloları | 08:20–09:00 |
| Verimlilik | Verimlilik Analizi | A | özet/analiz | 09:00–09:12 |
| Verimlilik | Test Verimlilik Raporu | A | KPI + tablo + grafik | 09:12–09:36 |
| Verimlilik | Fire Analizi | A | KPI/grafik | 09:36–09:54 |
| Verimlilik | Odaklı Verimlilik Raporu | B | seçime bağlı detay | 09:55–10:08 |
| Maliyet | Maliyet Gösterge Paneli | A | KPI/grafik | 10:08–10:27 |
| Maliyet | Maliyet Analiz Raporu | B | çok boyutlu tablo | 10:28–10:39 |
| Maliyet | Gider Pivot / Tedarikçi Sözleşme Raporu | B | maliyet kırılımı | 10:40–10:48 |
| Maliyet | Sonuç Başı Maliyet, Test Maliyet Analizi | B | test/sonuç maliyet | 10:48–11:01 |
| Maliyet | CPR Anomali Raporu | A | seçilebilir tablo + grafik | 11:01–11:12 |
| Maliyet | Maliyet Anomali, Birim Maliyet | B | sapma analizleri | 11:12–11:28 |
| Maliyet | Depo / Aylık Depo / Stok Maliyet | A/B | stok maliyet ve detay | 11:28–11:56 |
| Maliyet | İmha Raporu | A | filtreli tablo + satır detayı | 11:56–12:05 |
| Maliyet | Tedarikçi Sözleşmeleri | A | sözleşme listesi | 12:05–12:20 |
| Maliyet | Tedarikçi Hakedişleri | C | menü kaydı | 12:20–12:28 |

## 10. Rapor isteğinden operasyon planına: pratik tarifler

### R01 — “X laboratuvarının Y tarih aralığındaki tüm stok giriş ve çıkış raporu”

1. Parametreler: `laboratuvar` veya kullanıcıya karşılık gelen `depo`, `başlangıç`, `bitiş`, `ürün/kategori` (opsiyonel), ayrıntı seviyesi.
2. Önce `Stok → Stok Hareket Raporu`: tarih aralığı, depo ve gerekiyorsa tedarikçi/ürün/marka seç; `Filtrele`; kolonların sağ devamını ve toplam kayıt/sayfalama durumunu yakala; `Dışa Aktar` varsa kullan.
3. İşlem belgeleri/irsaliyeler talep edildiyse `Stok Hareketleri` üzerinden `İşlem No` detayına git; satırları tarih ve belgeyle bağla.
4. Stok hareket toplamını dönem sonu stokla eşitlemeye çalışma: dönem başlangıç stoku, transferler, tüketim, iadeler ve farklı birimler etki eder.
5. Çıktı: dönem, depo, ürün kodu, giriş/çıkış/iade/imha/net hareket, işlemler ve veri kaynakları.

### R02 — “X ürününün şu an kaç adet stokta olduğunu ve geçmişini göster”

`Stok → Stok Gözlem` → `Arama (Ürün Ara...)` veya kod → `Filtrele` → ürün ve stok birimleri kaydet → turkuaz `Ürün Adı` → `Stok Ekstresi` → tarih/depo/hareket tipi gerekliyse filtrele → hareket kayıtları ve son toplam stoğu al. Ekstre ile `Ürünler → Ekstre` ikonu da alternatif. LOT/miat ve paket/içerik adetini ayrı sütunda raporla. Tekil ürün adı çoklu eşleşirse koda göre ayırt et.

### R03 — “X deposundaki miadı yaklaşan ürünler”

`Stok → Miadı Yaklaşan Ürünler` temel kaynak; bu ekranın parametreleri tam doğrulanmadığından canlı filtre keşfi yap. Ayrıca `Depo Gözlem`de `Depo`, ürün/tarih ve `LOT`, `Miat`, `Stok Miktarı`, `Birim` ile çapraz doğrula. Son kullanma tarihi eşiğini kullanıcı belirtmediyse sor veya raporda seçilmiş pencereyi açıkça yaz. Her LOT'u ayrı satırda tut.

### R04 — “X laboratuvarının son üç aydaki tüketim raporu / önceki döneme göre fark”

`Stok → Tüketim Analiz Raporu`: `Tarih Aralığı`, `Laboratuvar`, opsiyonel `Tüketim Noktası`, `Ürün`, `Test Grubu` vb. → `Filtrele` → `Tüketim Miktarı`, `Tüketilen Adet/Test`, `Seçilen Tarih Aralığında Ortalama Aylık Tüketim`, `Son 3 Aydaki Ortalama Aylık Tüketim`, `Fark Yüzdesi`. Gerekirse `Tüketim Takibi`/`Ürün Kullanım`dan olay düzeyine in. İptalleri ayır.

### R05 — “X hastanesinde kritik stok, kaç gün yeter?”

`Stok → Stok Yeterlilik Analizi`: `Laboratuvar`, `Hedef Karşılama Süresi (Gün)`, ürün/test grubu, `N/A` ayarı → `Filtrele` → `Hedefin Altındaki Ürünler`; `Mevcut Stok`, `Ort. Aylık Tüketim`, `Min. Stok Süresi (Gün)`, `Karşılama Süresi (Gün)`. Gerekirse `Kritik Stok Raporu` ile karşılaştır. Her `hedef altında` kaydı gerçek imha/eksik sayım değil; stok tükenme riskinin rapor metrikidir.

### R06 — “X’te fazla veya riskli stok, transfer önerisi”

`Fazla Stok Analizi` + `Riskli Stok Raporu` aynı `Laboratuvar/Tüketim Noktası` kırılımı. `Filtrele` → ürün satırına tıkla → `Ürün Detayları` aç → risk, tüketim, `Aktarılabilir Stok Önerisi`, imha tehlikesi. Diğer depoların ihtiyacı için `Depo Gözlem`/`Stok Yeterlilik` karşılaştırması; öneri *uygulanmış transfer* değildir.

### R07 — “X cihazının bakım ve arıza performansı”

`Cihaz → Bakım/Kalibrasyon Raporu` dönem/kategori/marka/hastane → tablo + gecikme KPI; `Servis Çağrıları`nda cihaz/seri → açık/kapalı çağrılar, öncelik; `Servis Performans Raporu`nda çağrı/çözüm süresi. Her sayfanın kapsamını ayrı açıklayarak ortak bir cihaz kimliğiyle birleştir.

### R08 — “X laboratuvarında verimlilik: tüketim, sonuç, düşük performanslı testler”

`Verimlilik → Test Verimlilik Raporu`: `Tarih Aralığı`, `Laboratuvar`, `Test Grubu` → `Filtrele` → KPI'lar, `Test Verimlilik Tablosu`, `Hedef Realizasyonu`; sorunlu testler için `Dönemsel Tüketim`, `Dönemsel Sonuçlar` ve `Test Kataloğu`na in. Test ID/eşleşme yoksa isim benzerliğiyle kesin birleştirme yapma. `Toplam Sonuç` ve `Toplam Tüketim`in aynı kapsamda olup olmadığını teyit et.

### R09 — “X laboratuvarının maliyetlerinin detaylı analizi”

`Maliyet → Maliyet Gösterge Paneli`: dönem + lab + test grubu → `Filtrele` → KPI ve trendleri al; `Maliyet Analiz Raporu`, `Sonuç Başı Maliyet`, `Test Maliyet Analizi` ile birim/test kırılımına in; sözleşme fiyatı gereksiniminde `Tedarikçi Sözleşmeleri`, depo/ürün maliyetinde `Stok Maliyet Raporu`/`Depo Stok Maliyet Analizi`ne git. ₺ cinsinden ham değer, tarih, kur, gider grubu ve veri kapsamını ayrı belirt. Para birimi dönüşümünü belgesiz yapma.

### R10 — “X ürününün stok maliyeti hangi girişten oluştu?”

`Ürünler`de kimliği doğrula; `Stok Gözlem/Stok Ekstresi`nden hareket belgelerini al; `Maliyet → Stok Maliyet Raporu` veya `Depo Stok Maliyet Analizi`nde ürün/depo/tarihi filtrele; `Stok Giriş Tarihi`, `İşlem No`, `Sözleşme Birim Fiyatı`, `Birim Maliyet`, `Toplam Maliyet`i kaydet. Aynı `İşlem No` ve birim uyumluysa eşleştir; farklıysa uyuşmazlığı raporla.

### R11 — “X ürünlerinin imha maliyeti”

`Maliyet → İmha Raporu`: dönem, depo, ürün, tedarikçi, kategori → `Filtrele` → ürün bazında imha miktarı, birim, toplam maliyet → satır detayları. Önce `Sonuçları görmek için ... filtre` mesajı varsa henüz sorgu yapılmadığını söyle; filtre sonrası gerçekten boşsa dönemi ve koşulları raporda belirt.

### R12 — “X tedarikçisi ile sözleşme fiyatlarını ve siparişleri karşılaştır”

`Maliyet → Tedarikçi Sözleşmeleri` sözleşme numarası, geçerli tarih, tedarikçi, tip; `Stok → Sipariş Formları` tarih/sipariş/tedarikçi, sipariş modalından birim ve fiyat; stok giriş belgesi üzerinden fiili teslimatı doğrula. Fiyat kıyasının aynı ürün, birim, döviz ve tarih temelinde olduğuna bak. Tedarikçi hakedişi ayrı kaynaktır ve ayrıntısı yeniden keşif gerektirir.

## 11. Detay seviyesi standardı ve çıktı şeması

| İstek | En az içerik | Ek kontrol |
|---|---|---|
| `özet` | Kapsam, 3–6 KPI, dönem, kaynak, kısa yorum | filtre/kaynak görünür |
| `standart` | Özet + grup kırılımı + en yüksek/düşük 10 + trend | tam sayfalama |
| `detaylı` | Standart + tüm doğrulanmış satırlar, hareket/LOT/miat, neden/riske dair yorum, karşılaştırma | tablo-export satır mutabakatı |
| `çok detaylı / denetim` | Detaylı + işlem no, tedarikçi/depo/test eşleşmesi, ham veri dosyası, hesap formülü, veri sözlüğü, belirsizlikler, izlenebilirlik | iki kaynaklı çapraz doğrulama |

**Ajanın zorunlu cevap alanları:** `rapor_basligi`, `istenen_kapsam`, `varsayimlar`, `uygulanan_filtreler`, `veri_kaynaklari`, `kayit_sayisi`, `bulgular`, `tablo`, `anomali`, `guven_duzeyi`, `sinirlamalar`, `indirilen_dosyalar`, `çekilme_zamanı`.

**Metrik ve veri güvenliği kuralları:** `Giriş ≠ Kullanım ≠ Transfer ≠ İade ≠ İmha`, `Sipariş ≠ Mal kabul ≠ Fiili tüketim`, `Stok miktarı paket ≠ Toplam miktar test/adet`, `Kritik stok ≠ Fazla stok ≠ Riskli stok`, `Bekleyen onay ≠ tamamlanan`, `Boş sorgu ≠ 0`, `Maliyet ≠ Hakediş`. TL ve Euro değerleri ancak kaynakta görünen kur/tarih bilgisiyle çevrilir. Eksi stok veya maliyetsiz ürün yorumları için kaynak güvenilirliği açıklanır. PII bilgilerini minimuma indir.

## 12. Ajan çalıştırma (durum makinesi)

```
REQUEST_RECEIVED
  → PARSE_INTENT (rapor, X=lab/ürün/depo/cihaz, Y=dönem/detay, kapsam)
  → RESOLVE_IDENTITY (aynı isimli kayıt varsa kod/ID ile ayır)
  → CHOOSE_PAGES (ekran kataloğundan öncelik)
  → VERIFY_AUTH (yetkili UI oturumu; eksikse kullanıcıdan bağlanmasını iste)
  → NAVIGATE (modül ikonu → alt menü → görünür başlık)
  → DISCOVER_UI (gerçek filtre, sekme, export ve sayfa alanlarını gözle)
  → APPLY_FILTERS (filtre seçimleri → Filtrele → yükleme tamamlanması)
  → ACQUIRE (tercihen dışa aktar; değilse DOM/görünür tablo ve sayfalama)
  → VERIFY (sayfa-satır sayısı, toplam, birim, tarihler, boş sonuç)
  → ENRICH (yalnız gerektiğinde ilişkili kaynaklara in)
  → REPORT (bulgular, ham kaynaklar, belirsizlik, öneri)
  → STOP
```

**Durma ve toparlama:** 10–20 sn civarı bekledikten sonra spinner sürüyorsa açıkça `yükleniyor`; sahte sıfır üretme. Beklenmedik sayfa/oturum düşmesi/403: oturumu yeniden bağlat, kimlik bilgisi isteme/derleme. Filtre sonrası sonuç yoksa bir kez alan/sekme/tarih uyumunu kontrol et, yine boşsa `bu filtrelerle kayıt bulunamadı`. İndirilemiyorsa açıkça `dışa aktarım doğrulanamadı`, görünür UI tablosunu kullan veya engeli bildir. Uygulama üzerinde otomatik onay/sil/ekleme yapma.

## 13. Kanıt atlası ve eksikler

Yanındaki `LabIQ_Ekran_Atlası` klasörü, zaman damgalı **38 okunabilir referans ekran görüntüsü** içerir. `Ekran_Atlasi.html` üzerinden başlık ve zaman araması yapılabilir. **Atlas örneklemedir; tamamı görüntülenmiş bir UI spesifikasyonu veya geliştirme dokümantasyonu değildir.** Ajanın canlı tarayıcı incelemesiyle tüm menüler, HTML erişilebilirlik etiketleri, filtre seçenekleri, export dosya formatı ve doğrudan işlem sonrası durum testleri doğrulanmalıdır.

### Ürünleştirme için doğrulanması gereken kritik boşluklar

1. Oturum açma yöntemi, rol bazlı görünürlük, erişim denetimi, oturum zaman aşımı.
2. `Dışa Aktar` tıklanınca oluşan gerçek dosya biçimi, kolon kapsamı ve tüm sayfaları içerip içermediği.
3. `Filtre` popover'larının her sayfadaki alanları ve açık filtre ile gizli filtre arasındaki fark.
4. Ürün/kod/işlem bağlantılarının URL örüntüleri ve modal kapanış/geri davranışı.
5. Kurumsal veri erişim politikası ve rapor saklama/maskeleme gereksinimleri.
6. Bazı sayfalarda yüklemenin uzun sürmesinin nedeninin bağlantı mı, veri hacmi mi, uygulama hatası mı olduğu.
7. Özellikle `Kritik Stok`, `Miadı Yaklaşan`, `Tedarikçi Hakedişleri`, `Açık Sipariş Yönetimi`, `Stok Sayım` ayrıntılarının ikinci videoyla veya canlı gözlemle belgelenmesi.
8. **Salt-okunur export** eyleminin yan etkisizliği; `Paraşüt ... Aktar`, `Verimlilik Aktarım`, `Takibi Aç` gibi yazma eylemleriyle karıştırılmaması.

## 14. Ajan eğitimi için örnek test senaryoları

- **T1:** X ürün kodu ile `Stok Gözlem` ve `Stok Ekstresi`ne ulaş; mevcut stoku ve son beş hareketi doğrula. Beklenen: paket/adet birimlerini ayırır.
- **T2:** Aynı isimli birden çok ürün bulursa kodla ayrıştırır, ilk sonucu varsaymaz.
- **T3:** İstekte Y tarih aralığı yoksa rapor için kritik olup olmadığına göre açıkça sorar; keyfî dönem seçmez.
- **T4:** Boş/filtre uygulanmamış `İmha Raporu` ile filtrelenmiş boş raporu ayırır.
- **T5:** `Riskli Stok` tablosunda satıra tıklamadan alt detay görünmediğinde `0` sonucu vermez.
- **T6:** `Stok Hareket` sonuçlarının 15 kaydı aşması durumunda tüm sayfaları veya tam exportu kapsar.
- **T7:** Servis performansında süreler dakika, yüzdeler yüzde, miktarlar birimleriyle raporlanır.
- **T8:** Kullanıcı `X tedarikçisine ait hakediş` derse menüye yönelir ama doğrulanmamış kolon/formül uydurmaz.
- **T9:** `Yeni`, `Onayla`, `Senkronize Et`, `İşlemler`, `Sil`, `Takibi Aç` yan etkili butonlarını kullanıcı açıkça izin vermedikçe çalıştırmaz.
- **T10:** Export menüsü açıldığında önce mevcut formatları ekrandan keşfeder; önceden `.xlsx` beklemez.

---

**Dosyalar:** Bu belgenin yanındaki `LabIQ_AI_Ajan_Egitim_Promptu.md` doğrudan ajanın sistem talimatına uyarlanabilir; `Ekran_Atlasi.html` ve `LabIQ_Ekran_Atlası/` görsel referans sağlar. Metin, kullanıcının verdiği ekran kaydı üzerine hazırlanmıştır; canlı üretim ortamına izinsiz bağlanılıp işlem yapılmamıştır.
