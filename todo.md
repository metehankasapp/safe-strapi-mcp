# Mevcut sayfada güvenli component düzenleme

Amaç: Sayfayı kopyalamadan, mevcut belgenin taslağındaki seçili component'i
düzenlemek; hedef dışındaki içerikleri, component kimliklerini ve sıralamayı korumak.
Mevcut clone-first ve owned-draft araçlarının davranışı değişmeyecek.

Branch: `feat/safe-in-place-component-editing` → `main`.
PR #2, varsayılan kapalı REST tabanlı doğrudan taslak düzenlemeyi içerir.
Atomik Strapi endpoint ve müşteri ortamında etkinleştirme aşağıdaki ayrı fazlardır.

## 1. Davranış ve kapsam

- [x] Proje bazında varsayılan kapalı `allowInPlaceEditing` ayarı ekle; otomatik
  keşif/CLI/config yollarında açıkça etkinleştirilebilsin.
- [x] İlk sürümü Draft & Publish açık collection type'lar ve seçili dynamic zone
  ile sınırla. Single type, yayınlama, kayıt silme ve üst düzey alan düzenleme yok.
- [x] İki ayrı işlem tanımla: `patch` ile seçili component'in alanlarını düzenleme;
  `insert` ile mevcut blokları koruyarak yeni component ekleme.
- [x] `remove`, `replace`, `move`, `duplicate` işlemlerini bu yeni araçlarda reddet.
  Component türünü değiştirme ayrı bir geliştirme olarak kalsın.
- [x] Alan güncellemesi ile veri kaldırmayı ayır: mevcut dolu değeri null/boş
  değere çevirme, nested component kaldırma, dizi küçültme veya relation/media
  bağlantısını koparma ilk sürümde reddedilsin. Metin değişikliği açık hedef alanda
  mümkün olsun; diğer alanlar korunmalı.

## 2. Kimlik ve içerik koruma

- [x] `src/schema-catalog.ts` içine update için ayrı normalizasyon ekle. Mevcut
  create normalizasyonu component ID'lerini kaldırıyor; doğrudan düzenlemede
  kullanılmamalı. Mevcut nested component ID'leri korunsun, yenilerine ID verilmesin.
- [x] ID ve `__component` patch'lerini reddet; hedef ID'nin okunan belgeye ait
  olduğunu kontrol et. Belirsiz aynı tür component seçiminde açık selector iste.
- [x] Sunucuda tam mevcut zone üzerinden plan oluştur; istemciden tam `blocks`
  replacement payload kabul etme.
- [x] Hedef dışındaki blokların kimliğini, içeriğini ve göreli sırasını kontrol et.
  Insert sırasında indeks değişmesi korunmuş blokları değişmiş saymamalı.
- [x] Hedef component içinde yalnızca açıkça belirtilen alan yolları değişsin.
  Nested diziler/relation'lar için kimliğe dayalı kontrol yap; koruma doğrulanamayan
  yapıları reddet. Aynı uzunlukta dizi gönderilmesi koruma kanıtı sayılmasın.
- [x] Okuma populate'ının gerekli nested component/media/relation alanlarını
  içerdiğini doğrula; eksik veya yetkisiz veriyle yazmayı reddet.
- [x] Hazırlanan zone'u component ve content-type şemasına göre doğrula;
  izin verilmeyen component türlerini reddet.

## 3. Önizleme ve yazma sözleşmesi

- [x] `preview_modify_page` ekle: project, documentId, locale ve operations alır;
  yazma yapmadan revision hash, operation hash ve alan bazında fark döndürür.
- [x] `modify_page` ekle: aynı hedef/operations, `expectedPageHash`, preview'daki
  `expectedOperationHash` ve kararlı `idempotencyKey` zorunlu olsun. Hash'leri
  sunucuda yeniden hesapla; önizlemeyle uyuşmayan işlemi reddet.
- [x] `src/service.ts` içinde yeni akışı owned-draft sahipliği gerektirmeden,
  ayrı opt-in kontrolü ve mevcut project/scope yetkilendirmesiyle uygula.
- [x] Önce planla ve korumayı doğrula; yazmadan hemen önce revision'ı tekrar
  kontrol et. Yalnızca seçili dynamic-zone alanını draft durumuna yaz.
- [x] Slug, route, title, diğer zone'lar ve locale değişmesin; yeni belge veya
  localization oluşturulmasın. Mevcut draft yoksa ilk sürümde yazmayı reddet.
- [x] Mevcut audit/idempotency altyapısını ayrı action ile kullan. Aynı key ve
  farklı işlem conflict olsun; kayıp update yanıtında yeniden oku ve intended
  içerikle eşleşiyorsa sonucu kurtar, belirsiz sonucu körlemesine tekrar yazma.
- [x] Yazma sonrası belgeyi tekrar oku; hedef değişikliği, diğer alanlar ve
  korunmuş component ID'leri doğrulansın. Doğrulama hatasında başarı bildirme
  veya yeni insan değişikliklerini ezebilecek otomatik rollback yapma.

## 4. Eşzamanlılık ve Strapi tarafı

- [x] Aynı audit DB'yi kullanan MCP yazmalarında mevcut kilidi kullan; harici
  editör/resmi MCP yazmalarının bu kilide dahil olmadığını belgeleyin.
- [x] REST son GET/PUT aralığı dokümana ve regresyon testine açık sınırlama olarak eklendi.
- [ ] Ayrı faz: tam eşzamanlılık garantisi için Strapi tarafında atomik revision
  karşılaştırması ve güncellemesi yapan endpoint tasarla; transaction ve document-level
  kilit/revision mekanizmasını gerçek Strapi üzerinde doğrulamadan garanti verme.
- [ ] Strapi sunucu modülü opsiyonel ayrı faz olsun; yalnızca `registerTool`
  eklemenin atomik yazma sağlamadığını belgele. Strict koruma modu bu endpoint
  bulunmuyorsa işlemi reddetsin. Bu PR'da atomik mod veya Strapi plugin bulunmuyor.

## 5. Resmi MCP ile birlikte kullanım

- [x] Bizim araçlar API Token + REST, resmi MCP Admin Token + `/mcp` kullanır;
  iki bağlantının credential ve permission ayarlarını ayrı tut.
- [x] Genel okuma, yeni kayıt ve desteklenen medya işleri resmi MCP'den;
  korunması gereken mevcut zone düzenlemeleri bizim araçlardan yürüsün.
- [x] Korunan zone alanına resmi MCP update erişimini mümkün olan izinlerle
  kısıtla. Prompt yönlendirmesi tek başına zorunlu koruma sağlamaz.
- [x] Mevcut clone-first cookbook'a dokunmadan doğrudan düzenleme için yeni
  kullanım örnekleri ve MCP tool açıklamaları ekle.

## 6. Regresyon ve entegrasyon doğrulaması

- [x] Ortadaki component patch senaryosu: Hero → Özellikler → Galeri → Form;
  yalnızca Özellikler değişsin, diğer içerikler/ID'ler/sıra korunsun.
- [x] Araya insert, aynı türden birden fazla component, nested/repeatable
  component, media/relation ve 100 bloklu sayfa senaryolarını test et.
- [x] Remove/replace, kimlik değişimi, dolu alanı boşaltma, nested öğe veya
  relation kaybı, eksik populate ve izinsiz component senaryolarında sıfır yazma.
- [x] Opt-in kapalı, proje yetkisi yok, stale revision, preview hash uyuşmazlığı,
  idempotency conflict/replay ve kayıp yanıt recovery testlerini ekle.
- [x] Paylaşılan DB ile eşzamanlı yazma ve harici editör conflict senaryolarını
  test et; REST yarış sınırını test sonucunda gizleme.
- [x] Gerçek lokal Strapi'de component ID koruma ve nested update davranışını,
  draft değişirken published içeriğin korunmasını doğrula. Gerçek müşteri verisi
  veya production üzerinde otomatik yazma testi yapma.
- [x] MCP stdio üzerinden yeni araçların keşfi ve uçtan uca akışını test et;
  mevcut clone-first/owned-draft testleri geçmeye devam etsin.
- [x] `npm run typecheck`, `npm test`, `npm run build`, `npm pack --dry-run` çalıştır.

## 7. Dokümantasyon ve PR

- [x] README, CHANGELOG ve ilgili güvenlik/kullanım belgelerini güncelle;
  clone-first ile opt-in doğrudan düzenlemenin farkını açıkla.
- [x] Entegrasyon için özel bir test projesinde read-only keşif yap; frontend'de zaten render
  edilen component türleriyle içerik önizlemesini doğrula. Yeni schema/frontend
  component geliştirmesini bu değişiklikle karıştırma.
- [x] Uygulama ve testler tamamlandıkça bu checklist'i güncelle; branch'e push et.
- [x] Draft PR açıklamasını gerçekleşen davranış ve gerçek doğrulama sonuçlarıyla
  güncelle. CI geçip kapsam tamamlanınca review'a hazır hale getir.
- [ ] Merge, npm release ve müşteri ortamında etkinleştirme ayrı adımlar olsun.

## Kabul ölçütü

Mevcut documentId/slug korunarak seçili component düzenlenebilir veya araya yeni
component eklenebilir. Önizleme zorunludur; hedef dışındaki içerikler ve mevcut
component kimlikleri korunur. Silme, kopyalama ve yayınlama gerçekleşmez. REST
modunda harici eşzamanlı yazmalara karşı atomik garanti iddia edilmez.

## Doğrulama kaydı — 2026-10-09

- İzole Strapi 5.54.0, geçici SQLite ve geçici API Token üzerinde orta blok patch,
  nested ID koruma, medya/ilişkiler ve gerçek MCP stdio ile insert geçti.
- Published sürüm işlem öncesi/sonrası hash ile aynı kaldı.
- Müşteri repo config/env dosyaları ve müşteri verileri testte kullanılmadı.
- Mevcut dizilerde öğe güncelleme, component türü değiştirme, private/custom field
  desteği ve atomik sunucu endpoint sonraki geliştirmelerdir.

- 2026-10-09: Özel entegrasyon, ayrı veritabanı kopyası ve gerçek frontend
  ile yerel olarak doğrulandı. Public dokümanlarda proje adı/yolu bulunmuyor;
  projeye özel test kodu git dışında tutuluyor.

## 8. Standart önizleme ve kontrollü geri alma

Branch: `feat/structured-preview-and-rollback` → `main`.

- [x] Clone, doğrudan düzenleme ve geri alma önizlemeleri için sürümlü, sabit
  JSON alanları ve MCP output schema ekle; mevcut hash alanlarını koru.
- [x] AI yanıtları için sabit etiketler tanımla: Hedef, İşlem, Değişiklikler,
  Koruma, Yayınlama, Geri alma, Onay. Alanların eski/yeni değerlerini göster.
- [x] İşlem sonucuna operationId ve geri alma uygunluğu ekle; private audit
  snapshot'larını kullan ve geçmiş listesinden içerik snapshot'larını çıkar.
- [x] list_page_operations, preview_rollback_page ve rollback_page araçlarını ekle.
- [x] Yalnızca tamamlanmış ve doğrulanmış patch-only işlemleri geri al; insert
  içeren işlemlerde component kaldırmayı reddet. Sonradan yapılan düzenlemeleri
  ezme; önceki boş/null scalar değerlerini yalnızca kayıtlı geri almada geri getir.
- [x] Önizleme/hash, schema, component ID ve media/relation koruma kontrollerini
  geri almada uygula; aynı key ile kayıp yanıtı yeniden yazmadan uzlaştır.
- [x] Restart, stale revision, tenant/locale izolasyonu, insert/uncertain işlem
  reddi ve nested ID doğrulama testleri ekle.
- [x] İzole Strapi 5.54.0 üzerinde gerçek MCP stdio ile patch → rollback →
  insert akışını ve published sürümün değişmediğini doğrula.
- [x] README, CHANGELOG, kurulum ve AI prompt belgelerini genel örneklerle güncelle.
- [x] Ayrı branch üzerinde değişiklikleri ve doğrulama sonuçlarını PR için hazırla.
- [ ] Merge, deploy ve npm release ayrı adımlar olarak yapılacak.

- Standart önizleme/geri alma doğrulaması: 49 test; package/web/worker typecheck,
  build ve npm pack --dry-run başarılı. Public kaynak/site gizlilik taraması temiz.
