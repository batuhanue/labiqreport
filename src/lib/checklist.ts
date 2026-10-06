// Aylık Kontrol Formu — 10 rapor alanı, 48 kontrol maddesi.
// Metinler Excel formundaki (01_Aylık_Kontrol_Rapor) ifadelerle birebir aynıdır.
// `row`: maddenin Excel'deki satır numarası (dışa aktarımda kullanılır).

export type Hospital = "bursa" | "basaksehir";
export const HOSPITALS: { id: Hospital; label: string; short: string; excelCol: "C" | "D" }[] = [
  { id: "bursa", label: "Bursa", short: "BRS", excelCol: "C" },
  { id: "basaksehir", label: "Başakşehir", short: "BŞK", excelCol: "D" },
];

export interface CheckItem {
  id: string; // "R-01-1"
  row: number;
  text: string;
  hint?: string;
}

export interface Area {
  code: string; // "R-01"
  title: string;
  emoji: string;
  color: string; // ana renk (clay)
  tint: string; // açık arka plan
  priority: boolean; // Hakan Bey'in kırmızı alanları
  deadlineLabel: string;
  /** Ay sonundan sonra kaç gün; null = ayda iki kez (R-04) */
  deadlineDays: number | null;
  content: string;
  preparer: string;
  control: string;
  preApproval: string;
  finalApproval: string;
  people: string[];
  items: CheckItem[];
}

const mk = (code: string, startRow: number, rows: [string, string?][]): CheckItem[] =>
  rows.map(([text, hint], i) => ({ id: `${code}-${i + 1}`, row: startRow + i, text, hint }));

export const AREAS: Area[] = [
  {
    code: "R-01",
    title: "Hakediş Analiz",
    emoji: "🧾",
    color: "#5B7CFF",
    tint: "#E8EDFF",
    priority: true,
    deadlineLabel: "Ay bitiş + 3 gün",
    deadlineDays: 3,
    content: "Ay kapanışına esas veri bütünlüğü, eksik veya hatalı kayıt listesi ve kapanış uygunluğu.",
    preparer: "Bütçe & Raporlama Sorumlusu",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Bumin Salkın", "Hakedişi hazırlayan"],
    items: mk("R-01", 11, [
      ["Hakediş verileri makro kontrol ile HBYS çekildi mi?", "Dönemin tamamı geldi mi, dosya hangi tarihte kesildi? İki hastane ayrı."],
      ["Birleştirilmiş Excel oluşturma", "Farklı formatlar tek yapıya; başlık satırını adla bul, SUT kodunu normalize et."],
      ["Test bazında hakediş firma dağılımının kontrolü", "Her test hangi firmaya/tedarikçiye hakediş yazılmış?"],
      ["Test ID'ler tamam mı? Eksikler tamamlandı mı?", "Test grubu atanmamış sonuçlar, test ID'si eksik satırlar."],
      ["LABIQ Süreç Analitiği ile random kontroller", "Hakediş adedi ↔ LabIQ dönem sonuç sayısı örneklem karşılaştırması."],
    ]),
  },
  {
    code: "R-02",
    title: "Stok Sayım Analizleri",
    emoji: "📦",
    color: "#FF9F43",
    tint: "#FFF1E3",
    priority: false,
    deadlineLabel: "Ay bitiş + 2 gün",
    deadlineDays: 2,
    content: "Sistem stok ile fiziksel stok karşılaştırması; miktar, oran ve parasal etki bazında fark analizi.",
    preparer: "Lojistik Sorumlusu",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Tuğrul Adalı", "Abdülkadir Yıldırım", "Savaş Günevir"],
    items: mk("R-02", 16, [
      ["Ana Depo fiziksel sayım tamamlandı mı?", "Lot bazlı sayım: lot–adet eşleşmesi kontrol edilir."],
      ["Tüketim Noktaları eksiksiz sayıldı mı?", "Tüketimi olan her nokta listelenir; sayım kaydı olmayan = bulgu."],
      ["Birim tanımları makro hatalar kontrol edildi mi?", "Kutu/adet çarpanı, iptal kartlar, adında paket büyüklüğü olup çarpanı 1 olanlar."],
      ["Sayım farkı ayın son günü için yapıldı mı?", "Ay ortası sayım ay sonu bakiyesini temsil etmez."],
      ["Büyük farkların gerekçesi açıklandı mı?", "Sayım hızı, ortak hesap, mükerrer sayım, belge no atlaması."],
    ]),
  },
  {
    code: "R-03",
    title: "Stok Analiz Raporları",
    emoji: "📊",
    color: "#2EC4B6",
    tint: "#E0F7F4",
    priority: false,
    deadlineLabel: "Ay bitiş + 3 gün",
    deadlineDays: 3,
    content: "Tüm bu stok raporları bir bütünlük içerisinde alınacak ve analiz sonuçları ile raporlanacaktır.",
    preparer: "Lojistik Sorumlusu",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Savaş Günevir", "Bumin Salkın", "Tuğrul Adalı"],
    items: mk("R-03", 21, [
      ["Hareketsiz Stok Analizi ve Pasif İşlemleri", "Duran kalemi yeni başlayan kodla eşleştir (ürün kodu değişimi)."],
      ["İmha Raporu ve Tutar Raporu"],
      ["Fazla Stok Analiz ve Açıklamaları"],
      ["Riskli Stok (Miad) Analizi", "Tüketim tarihi > miat tarihi olan kayıtlar."],
      ["Kritik Stok Analizi ve Açıklamaları", "İptal/deaktif kodlara hareket girilmiş mi?"],
    ]),
  },
  {
    code: "R-04",
    title: "İhtiyaç & Sipariş Planlama",
    emoji: "🛒",
    color: "#A66CFF",
    tint: "#F1E8FF",
    priority: false,
    deadlineLabel: "Ayın 2. ve 4. haftası (2 kez)",
    deadlineDays: null,
    content: "Gelecek dönem için ürün bazında ihtiyaç tahmini ve sipariş önerisi; kritik ve fazla stok önleme planı.",
    preparer: "Lojistik Sorumlusu / Laboratuvar Sorumluları / Proje Temsilcileri",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Savaş Günevir", "Neşe Kırman", "Elif Güngördü"],
    items: mk("R-04", 26, [
      ["Tüketim Analiz Raporu - Trend Yüksek Ürün Analizi", "Önce R-03'teki kod eşleştirmesi; nokta yeniden yapılanmasında toplam al."],
      ["İhtiyaç Planlama - Firma veya Lab bazında"],
      ["Sipariş Onayları ve Süreçleri"],
      ["Açık Sipariş Kontrol ve Düzenleme"],
    ]),
  },
  {
    code: "R-05",
    title: "Tüketim, Verimlilik & Fire",
    emoji: "🧪",
    color: "#FF5E7E",
    tint: "#FFE6EC",
    priority: true,
    deadlineLabel: "Ay bitiş + 7 gün",
    deadlineDays: 7,
    content: "Üretilen sonuç hacmine karşı tüketim verimliliği; hedef/standart kullanımdan sapma ve fire analizi.",
    preparer: "Bütçe & Raporlama Sorumlusu + Proje Temsilcisi + Laboratuvar Sorumluları",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Bumin Salkın", "Tuğrul Adalı", "Neşe Kırman", "Sinem Yiğit", "Elif Güngördü", "Serkan Aksay"],
    items: mk("R-05", 30, [
      ["Dönem Tüketim Verilerinin çalıştırma ve kontrolü"],
      ["Dönem Sonuç Verilerinin Yüklenmesi"],
      ["Cihaz üstü sayım ve kayıp verilerinin yüklenmesi"],
      ["Verim Analizi Verilerinin incelenmesi ", "Üç kaynaklı sağlama: verimlilik ↔ sonuç ↔ tüketim. Devreden/dönem sonu stok alanlarını kontrol et."],
      ["Test Bazında Verimlilik ve Fire Analizleri , aksiyon planı", "Dört kategori: >%100 · <%60 · yüksek tüketim+fire · maliyeti yüksek. Önce ürün↔test eşleştirmesine bak."],
    ]),
  },
  {
    code: "R-06",
    title: "Cihaz Servis & Bakım Performansı",
    emoji: "🛠️",
    color: "#3DB2FF",
    tint: "#E3F4FF",
    priority: false,
    deadlineLabel: "Ay bitiş + 10 gün",
    deadlineDays: 10,
    content: "Cihaz ve servis sağlayıcı bazında arıza sıklığı, müdahale/çözüm süresi, açık çağrı ve SLA performansı. Bakım uyumluluğu",
    preparer: "Proje Temsilcisi / Teknik Servis",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Serkan Aksay", "Yusuf Topal", "İzzet Muammer Ulaş", "Elif Güngördü"],
    items: mk("R-06", 35, [
      ["Açık Servis Çağrılarının süre açısından kontrol ve kapanışı", "Hedef 48 saat; aşan çağrılar ve cihaz kritikliği."],
      ["Hatalı çok yüksek sapma yaratan çağrıların kontrolü", "Arıza tarihi > bildirim · teknik kontrol > çözüm · çözüm 0:00."],
      ["Bakım Planı Kontrolü ve Süresi Geçen Bakım Raporu", "Planlanan / yapılan / geciken; paralel kayıt da bulgudur."],
      ["Servis Performans Raporu  ", "Marka ortalamasını çağrı sayısıyla birlikte değerlendir."],
    ]),
  },
  {
    code: "R-07",
    title: "Personel & IK Analiz",
    emoji: "👥",
    color: "#FFC93C",
    tint: "#FFF7DD",
    priority: false,
    deadlineLabel: "Ay bitiş + 15 gün",
    deadlineDays: 15,
    content: "Personel ile ilgili aya ait tüm verilerin analizi ve değerlendirilmesi, aynı kapsamda son 6 ay veya 12 ay için kümülatif analiz yapılmalıdır",
    preparer: "Proje Yöneticisi / Proje Temsilcisi",
    control: "IK Direktörü",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Hikmet Balbay"],
    items: mk("R-07", 39, [
      ["Aktif personel listesi güncel mi?", "opIQ aktif + pasif toplamı listeyle tutuyor mu?"],
      ["Vardiya planları ve fiili vardiyalar uyumlu mu?"],
      ["İzin, rapor, fazla mesai ve tüm kayıtlar tamam mı?"],
      ["Fazla Mesai Raporu"],
      ["Personel Analiz Raporu"],
    ]),
  },
  {
    code: "R-08",
    title: "Gider Girişleri & Maliyet Kontrol",
    emoji: "💳",
    color: "#7BD389",
    tint: "#E7F7EA",
    priority: true,
    deadlineLabel: "Ay bitiş + 15 gün",
    deadlineDays: 15,
    content: "Gider , Tüketim ve Sonuç Maliyetlerinin kontrol edilmesi ve olası hata ve eksiklerin düzeltilmesi",
    preparer: "Bütçe & Raporlama Sorumlusu",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Proje Yöneticisi",
    finalApproval: "Genel Müdür",
    people: ["Tuğrul Adalı", "Bumin Salkın", "Gülay Demir", "Fatma Özkara", "İlter Baykam"],
    items: mk("R-08", 44, [
      ["Projelere ilişkin tüm giderler girildi mi?", "Odoo → LabIQ, hastane bazında; hesap eşleştirme tablosu."],
      ["Personel maliyetleri laboratuvar bazında detaylandırıldı mı?"],
      ["Eksik maliyetli ürünler var mı?", "Tüketimi olup birim fiyatı olmayan ürünler."],
      ["Tedarikçi Hakedişlerinin yüklenmesi ve maliyetlendirilmesi"],
      ["Tüketim Maliyet Analizi ile genel makro bazda kontrol ", "Ürün toplamı = kategori = genel toplam; medyanın 3 katı sapma = fiyat hatası şüphesi."],
    ]),
  },
  {
    code: "R-09",
    title: "Aylık Proje Maliyet Analizi",
    emoji: "💰",
    color: "#FF7A59",
    tint: "#FFEBE4",
    priority: true,
    deadlineLabel: "Ay bitiş + 15 gün",
    deadlineDays: 15,
    content: "Projenin aylık toplam maliyeti, ana maliyet grupları, birim maliyet ve önceki dönem/bütçe karşılaştırması. Gider, ürün ve hakediş bazında detaylandırılması. Anormal değişimlerin veya verilerin tespiti.",
    preparer: "Bütçe & Raporlama Sorumlusu + Proje Yöneticisi",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Genel Müdür",
    finalApproval: "Yönetim Grubu",
    people: ["Neşe Kırman", "Elif Güngördü", "Tuğrul Adalı", "Bumin Salkın"],
    items: mk("R-09", 49, [
      ["Maliyet Gösterge Paneli Kontrolü ve Onayı"],
      ["Gider Analiz Raporu ve Dağılımı ", "Pivot filtresi doğru mu? Her çıktı için bilinen bir doğrulama toplamı tut."],
      ["Maliyet Analiz Raporu ve Dağılımı"],
      ["Sonuç Başı Maliyet Hesaplama ve Kontrol", "Yoğunlaşan maliyet israf değildir; test bazında bak."],
      ["Maliyet Anamoli Raporu inceleme ve Tespitler", "Yüzdeye göre değil mutlak etkiye göre sırala; miktar/fiyat ayrıştır."],
      ["Depo Stok Maliyet Analizi (Ay sonu ve Güncel)"],
    ]),
  },
  {
    code: "R-10",
    title: "Bütçe & Gelir Analiz",
    emoji: "📈",
    color: "#4ECDC4",
    tint: "#E2F8F6",
    priority: false,
    deadlineLabel: "Ay bitiş + 20 gün",
    deadlineDays: 20,
    content: "Bütçeye karşı gerçekleşen giderler ve ana sapma nedenleri; gelecek ay etkisi ve düzeltici aksiyon.",
    preparer: "Bütçe & Raporlama Sorumlusu + Proje Yöneticisi",
    control: "Bütçe & Raporlama Sorumlusu",
    preApproval: "Genel Müdür",
    finalApproval: "Yönetim Grubu",
    people: ["Neşe Kırman", "Gülay Demir", "Ömer Kafadar"],
    items: mk("R-10", 55, [
      ["Dönemsel Satış Verileri Yüklendi mi?"],
      ["Satış Tutarı Kontrol Edildi mi?", "Gelir = hakediş puanı × puan birim fiyatı; kesintiler ayrı."],
      ["Eksik Test vb kontrolleri yapıldı mı?", "R-01'deki eksik test ID'leri gelir eksikliği olarak yansır."],
      ["Müşteri Bazında Analiz"],
    ]),
  },
];

export const ALL_ITEMS = AREAS.flatMap((a) => a.items.map((it) => ({ ...it, area: a })));
export const TOTAL_ITEMS = ALL_ITEMS.length; // 48

export const PEOPLE = [
  "Hakan Karaboğa",
  "Ercan Sönmez",
  "Kutay Canpolat",
  "Tuğrul Adalı",
  "Bumin Salkın",
  "Savaş Günevir",
  "Abdülkadir Yıldırım",
  "Neşe Kırman",
  "Elif Güngördü",
  "Sinem Yiğit",
  "Serkan Aksay",
  "Yusuf Topal",
  "İzzet Muammer Ulaş",
  "Gülay Demir",
  "Fatma Özkara",
  "Ömer Kafadar",
  "Hikmet Balbay",
  "İlter Baykam",
];

export const areaByCode = (code: string) => AREAS.find((a) => a.code === code);

/** Temaya duyarlı açık zemin: alan rengini kart rengiyle karıştırır. */
export const tintOf = (color: string, pct = 16) => `color-mix(in srgb, ${color} ${pct}%, var(--color-card))`;
