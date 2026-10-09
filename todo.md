# Mevcut sayfada güvenli component düzenleme

Amaç: Sayfayı kopyalamadan, mevcut belgenin taslağındaki seçili component'i
düzenlemek; hedef dışındaki içerikleri, component kimliklerini ve sıralamayı korumak.
Mevcut clone-first ve owned-draft araçlarının davranışı değişmeyecek.

Branch: `feat/safe-in-place-component-editing` → `main`.
Bu ilk PR geliştirme planını içerir; uygulama tamamlanana kadar draft kalır.

## 1. Davranış ve kapsam

- [ ] Proje bazında varsayılan kapalı `allowInPlaceEditing` ayarı ekle; otomatik
  keşif/CLI/config yollarında açıkça etkinleştirilebilsin.
- [ ] İlk sürümü Draft & Publish açık collection type'lar ve seçili dynamic zone
  ile sınırla. Single type, yayınlama, kayıt silme ve üst düzey alan düzenleme yok.
- [ ] İki ayrı işlem tanımla: `patch` ile seçili component'in alanlarını düzenleme;
  `insert` ile mevcut blokları koruyarak yeni component ekleme.
- [ ] `remove`, `replace`, `move`, `duplicate` işlemlerini bu yeni araçlarda reddet.
  Component türünü değiştirme ayrı bir geliştirme olarak kalsın.
- [ ] Alan güncellemesi ile veri kaldırmayı ayır: mevcut dolu değeri null/boş
  değere çevirme, nested component kaldırma, dizi küçültme veya relation/media
  bağlantısını koparma ilk sürümde reddedilsin. Metin değişikliği açık hedef alanda
  mümkün olsun; diğer alanlar korunmalı.

## 2. Kimlik ve içerik koruma

- [ ] `src/schema-catalog.ts` içine update için ayrı normalizasyon ekle. Mevcut
  create normalizasyonu component ID'lerini kaldırıyor; doğrudan düzenlemede
  kullanılmamalı. Mevcut nested component ID'leri korunsun, yenilerine ID verilmesin.
- [ ] ID ve `__component` patch'lerini reddet; hedef ID'nin okunan belgeye ait
  olduğunu kontrol et. Belirsiz aynı tür component seçiminde açık selector iste.
- [ ] Sunucuda tam mevcut zone üzerinden plan oluştur; istemciden tam `blocks`
  replacement payload kabul etme.
- [ ] Hedef dışındaki blokların kimliğini, içeriğini ve göreli sırasını kontrol et.
  Insert sırasında indeks değişmesi korunmuş blokları değişmiş saymamalı.
- [ ] Hedef component içinde yalnızca açıkça belirtilen alan yolları değişsin.
  Nested diziler/relation'lar için kimliğe dayalı kontrol yap; koruma doğrulanamayan
  yapıları reddet. Aynı uzunlukta dizi gönderilmesi koruma kanıtı sayılmasın.
- [ ] Okuma populate'ının gerekli nested component/media/relation alanlarını
  içerdiğini doğrula; eksik veya yetkisiz veriyle yazmayı reddet.
- [ ] Hazırlanan zone'u component ve content-type şemasına göre doğrula;
  izin verilmeyen component türlerini reddet.

## 3. Önizleme ve yazma sözleşmesi

- [ ] `preview_modify_page` ekle: project, documentId, locale ve operations alır;
  yazma yapmadan revision hash, operation hash ve alan bazında fark döndürür.
- [ ] `modify_page` ekle: aynı hedef/operations, `expectedPageHash`, preview'daki
  `expectedOperationHash` ve kararlı `idempotencyKey` zorunlu olsun. Hash'leri
  sunucuda yeniden hesapla; önizlemeyle uyuşmayan işlemi reddet.
- [ ] `src/service.ts` içinde yeni akışı owned-draft sahipliği gerektirmeden,
  ayrı opt-in kontrolü ve mevcut project/scope yetkilendirmesiyle uygula.
- [ ] Önce planla ve korumayı doğrula; yazmadan hemen önce revision'ı tekrar
  kontrol et. Yalnızca seçili dynamic-zone alanını draft durumuna yaz.
- [ ] Slug, route, title, diğer zone'lar ve locale değişmesin; yeni belge veya
  localization oluşturulmasın. Mevcut draft yoksa ilk sürümde yazmayı reddet.
- [ ] Mevcut audit/idempotency altyapısını ayrı action ile kullan. Aynı key ve
  farklı işlem conflict olsun; kayıp update yanıtında yeniden oku ve intended
  içerikle eşleşiyorsa sonucu kurtar, belirsiz sonucu körlemesine tekrar yazma.
- [ ] Yazma sonrası belgeyi tekrar oku; hedef değişikliği, diğer alanlar ve
  korunmuş component ID'leri doğrulansın. Doğrulama hatasında başarı bildirme
  veya yeni insan değişikliklerini ezebilecek otomatik rollback yapma.

## 4. Eşzamanlılık ve Strapi tarafı

- [ ] Aynı audit DB'yi kullanan MCP yazmalarında mevcut kilidi kullan; harici
  editör/resmi MCP yazmalarının bu kilide dahil olmadığını belgeleyin.
- [ ] REST'teki son GET/PUT aralığını açık sınırlama olarak bırak. Tam eşzamanlılık
  garantisi gerekiyorsa Strapi tarafında atomik revision karşılaştırması ve
  güncellemesi yapan endpoint tasarla; transaction ve document-level kilit/revision
  mekanizmasını gerçek Strapi üzerinde doğrulamadan garanti verme.
- [ ] Strapi sunucu modülü opsiyonel ayrı faz olsun; yalnızca `registerTool`
  eklemenin atomik yazma sağlamadığını belgele. Strict koruma modu bu endpoint
  bulunmuyorsa işlemi reddetsin.

## 5. Resmi MCP ile birlikte kullanım

- [ ] Bizim araçlar API Token + REST, resmi MCP Admin Token + `/mcp` kullanır;
  iki bağlantının credential ve permission ayarlarını ayrı tut.
- [ ] Genel okuma, yeni kayıt ve desteklenen medya işleri resmi MCP'den;
  korunması gereken mevcut zone düzenlemeleri bizim araçlardan yürüsün.
- [ ] Korunan zone alanına resmi MCP update erişimini mümkün olan izinlerle
  kısıtla. Prompt yönlendirmesi tek başına zorunlu koruma sağlamaz.
- [ ] Mevcut clone-first cookbook'a dokunmadan doğrudan düzenleme için yeni
  kullanım örnekleri ve MCP tool açıklamaları ekle.

## 6. Regresyon ve entegrasyon doğrulaması

- [ ] Ortadaki component patch senaryosu: Hero → Özellikler → Galeri → Form;
  yalnızca Özellikler değişsin, diğer içerikler/ID'ler/sıra korunsun.
- [ ] Araya insert, aynı türden birden fazla component, nested/repeatable
  component, media/relation ve 100 bloklu sayfa senaryolarını test et.
- [ ] Remove/replace, kimlik değişimi, dolu alanı boşaltma, nested öğe veya
  relation kaybı, eksik populate ve izinsiz component senaryolarında sıfır yazma.
- [ ] Opt-in kapalı, proje yetkisi yok, stale revision, preview hash uyuşmazlığı,
  idempotency conflict/replay ve kayıp yanıt recovery testlerini ekle.
- [ ] Paylaşılan DB ile eşzamanlı yazma ve harici editör conflict senaryolarını
  test et; REST yarış sınırını test sonucunda gizleme.
- [ ] Gerçek lokal Strapi'de component ID koruma ve nested update davranışını,
  draft değişirken published içeriğin korunmasını doğrula. Gerçek müşteri verisi
  veya production üzerinde otomatik yazma testi yapma.
- [ ] MCP stdio üzerinden yeni araçların keşfi ve uçtan uca akışını test et;
  mevcut clone-first/owned-draft testleri geçmeye devam etsin.
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm pack --dry-run` çalıştır.

## 7. Dokümantasyon ve PR

- [ ] README, CHANGELOG ve ilgili güvenlik/kullanım belgelerini güncelle;
  clone-first ile opt-in doğrudan düzenlemenin farkını açıkla.
- [ ] ALJ için tek test projesinde read-only keşif yap; frontend'de zaten render
  edilen component türleriyle içerik önizlemesini doğrula. Yeni schema/frontend
  component geliştirmesini bu değişiklikle karıştırma.
- [ ] Uygulama ve testler tamamlandıkça bu checklist'i güncelle; branch'e push et.
- [ ] Draft PR açıklamasını gerçekleşen davranış ve gerçek doğrulama sonuçlarıyla
  güncelle. CI geçip kapsam tamamlanınca review'a hazır hale getir.
- [ ] Merge, npm release ve müşteri ortamında etkinleştirme ayrı adımlar olsun.

## Kabul ölçütü

Mevcut documentId/slug korunarak seçili component düzenlenebilir veya araya yeni
component eklenebilir. Önizleme zorunludur; hedef dışındaki içerikler ve mevcut
component kimlikleri korunur. Silme, kopyalama ve yayınlama gerçekleşmez. REST
modunda harici eşzamanlı yazmalara karşı atomik garanti iddia edilmez.
