# Review Team untuk Paseo

Plugin Paseo yang membuka **ruang tim multi-agen** di setiap workspace dengan dua mode:

- **Review** — satu agen **lead** memimpin beberapa **reviewer** paralel (read-only), menggabungkan temuan, dan menyusun satu laporan akhir.
- **Terjemahan** — lead memimpin **penerjemah** per bab yang menulis naskah Indonesia ke folder hasil, lalu **peninjau QA** read-only membandingkan sumber dan hasil sebelum lead mengonsolidasikan laporan.

Tersedia preset bawaan **Code Review**, **Review Novel**, dan **Terjemahan Novel** (English → Indonesian), plus preset custom lewat file JSON. Panel workspace menampilkan status lead, progres unit terjemahan, coverage QA, temuan terstruktur, event, dan laporan konsolidasi.

Plugin ini mengikuti model koordinasi native Paseo: lead membuat agen anak dengan alat `create_agent`, anak melapor hanya kepada lead, dan lead menjadi hub yang meneruskan konteks antarlensa. Tidak ada pesan peer-to-peer yang dibuat-buat.

## Fitur

- **Dua mode** — review read-only dan terjemahan naskah yang menulis hasil ke folder workspace. Mode ditentukan preset; protokol laporan review tetap sama.
- **Preset bawaan & custom** — Code Review, Review Novel, dan Terjemahan Novel; ganti preset di form setup untuk mengganti lensa, kedalaman, copy UI, dan gaya laporan. Preset custom dibaca dari `presets.json`.
- **Lead + reviewer paralel** — satu reviewer per lensa yang dipilih. Preset Code Review memakai correctness, security, tests, architecture, dan performance; preset Review Novel memakai alur, tokoh, dunia, gaya, dan pacing.
- **Penerjemah per bab + QA** — preset terjemahan membuat satu penerjemah per unit (maks. 20 unit dan 5 penerjemah paralel per sesi), memverifikasi path hasil, lalu menjalankan lensa QA read-only setelah semua unit terminal.
- **Coverage dari agen nyata** — dihitung dari reviewer yang benar-benar ditemukan lewat label sesi dan `paseo.parent-agent-id`, bukan dari klaim lead.
- **Laporan terstruktur** — JSON `review-findings` per reviewer dan `review-final` dari lead; parser toleran dengan fallback teks mentah.
- **Visibilitas izin** — permintaan izin yang menunggu terlihat di panel; plugin **tidak pernah** menyetujui izin otomatis.
- **Kontrol operator** — kirim arahan ke lead, minta laporan ulang, hentikan sesi, dan opsional arsipkan semua agen.
- **Persistence lokal** — snapshot sesi, default setup, dan event feed disimpan di data plugin dengan penulisan atomic. File preset milik operator tidak pernah ditulis plugin.
- **Panel mobile** — React Native primitives, warna tema Paseo, dan layout compact.

## Persyaratan

- Paseo **>= 0.12.0** (daemon dan app).
- Provider/model yang mendukung tool use. Pilihan **Mode** dan **Thinking level** muncul bila provider/model mengeksposnya. Mode terjemahan membutuhkan model yang dapat menulis file di workspace.
- **Agent tools** Paseo aktif (`mcp.injectIntoAgents`). Lead membutuhkan `create_agent` dan alat agen native lainnya.
  - Panel menampilkan consent gate. Plugin tidak mengaktifkan setelan ini tanpa klik eksplisit.
  - Setelan ini bersifat global di daemon dan hanya berlaku untuk agen yang dimulai setelah diaktifkan.
- Izin agen tetap ditinjau manual. Plugin tidak mengubah kebijakan izin.

## Instalasi

Dari checkout lokal:

```bash
paseo plugin add /absolute/path/to/paseo-review-team
```

Dari GitHub (setelah repo dipublikasikan):

```bash
paseo plugin add git:mieburungdara/paseo-review-team
```

Muat ulang plugin dari **Settings → Plugins** jika daemon belum mendeteksinya.

## Pemakaian

1. Buka sebuah workspace di Paseo.
2. Buka tab **Review Team** di panel workspace, atau jalankan **Buka Review Team** dari Command Center.
3. Pilih preset: **Code Review**, **Review Novel**, **Terjemahan Novel**, atau preset custom yang terdeteksi. Label target, daftar lensa, dan pilihan kedalaman mengikuti preset.
4. Isi target. Untuk kode, misalnya `diff vs main`, `src/auth/login`, atau `PR #42`; untuk novel, misalnya `manuscript/bab-03.md` atau `bab 3–5`; untuk terjemahan, sumber dan rentangnya, misalnya `manuscript/en/bab-01.md` atau `manuscript/en/ (bab 1–20)`.
5. Untuk preset terjemahan, isi juga **Folder hasil** relatif terhadap workspace, misalnya `translated/id`. Folder ini tidak dibuat oleh plugin.
6. Pilih lensa, kedalaman, provider, dan model. Bila tersedia, pilih juga **Mode** dan **Thinking level**; keduanya diterapkan ke lead dan semua agen anak, lalu disimpan sebagai default setup. Mengganti preset mengembalikan lensa, kedalaman, dan folder hasil ke default preset tersebut.
7. Jika agent tools belum aktif, tinjau penjelasannya lalu aktifkan lewat tombol consent.
8. Mulai sesi. Untuk review, lead membuat satu reviewer per lensa. Untuk terjemahan, lead membuat penerjemah per bab, lalu peninjau QA setelah semua unit terminal.
9. Pantau coverage/progres, status lead, kartu reviewer/translator, dan event. Pesan lead bila perlu mengarahkan ulang.
10. Setelah semua lensa memberi hasil, plugin mengingatkan lead untuk berkonsolidasi dan mengirim laporan akhir.
11. Hentikan sesi kapan saja; opsional arsipkan lead dan semua agen anak setelah dihentikan. File hasil terjemahan tidak dihapus.

Sesi yang sudah `complete`, `stopped`, atau `failed` dapat digantikan dengan sesi baru di workspace yang sama. Hanya satu sesi aktif diperbolehkan per workspace.

## Cara kerja

```
Operator
   │  setup / pesan / stop
   ▼
Plugin review-team ── membuat ──► Lead agent
   │                               │ create_agent (satu per lensa)
   │                               ├──► Reviewer: correctness
   │  lifecycle hooks + polling    ├──► Reviewer: security
   │  mem-parse timeline           └──► Reviewer: tests
   │                                     │ laporan ke lead
   ▼                                     ▼
Panel workspace ◄── laporan akhir ◄── Lead (konsolidasi)
```

- Plugin hanya membuat **lead**. Lead yang membuat reviewer atau penerjemah memakai alat agen Paseo, sehingga hierarki dan notifikasi tetap native.
- Mode dan thinking level yang dipilih dipakai saat membuat lead, lalu diteruskan ke setiap agen anak lewat `settings` pada `create_agent` agar seluruh tim berjalan dengan konfigurasi yang sama.
- Observer memakai `agent.created`, `turn_started`, `turn_ended`, `permission_requested`, `permission_resolved`, `archived`, dan `closed`, ditambah rekonsiliasi periodik lewat SDK.
- Agen anak ditemukan dari label `review-team.session`, `review-team.role`, `review-team.lens`, `review-team.unit`, dan label bawaan `paseo.parent-agent-id`.
- Saat semua lensa sudah memberi hasil, plugin mengirim satu pesan konsolidasi ke lead. Ini adalah jaring pengaman bila notifikasi selesai native tidak membangunkan lead.
- Laporan reviewer/penerjemah dibaca dari timeline agen setelah giliran selesai, lalu dipetakan ke state sesi.
- Pada sesi terjemahan, fase berpindah ke QA hanya setelah peninjau QA ada dan semua penerjemah terminal; batch penerjemah baru mengembalikan fase ke `translating` sebelum konsolidasi.
- Preset menentukan daftar lensa, prompt peran, kedalaman, batas batch, dan copy UI. Protokol laporan tidak berubah antar-preset.

## Preset

### Preset bawaan

| ID | Label | Lensa default | Verdict lead |
| --- | --- | --- | --- |
| `code` | Code Review | correctness, security, tests, architecture, performance | `APPROVE`, `PERLU PERUBAHAN`, `BLOCKED` |
| `novel` | Review Novel | Alur & Benang, Konsistensi Tokoh, Dunia & Istilah, Gaya & Suara | `SIAP`, `PERLU REVISI`, `TERTAHAN` |
| `translate` | Terjemahan Novel (EN→ID) | Kesetiaan Makna, Kealamian Bahasa, Istilah & Nama, Konsistensi & Kontinuitas, Format & Kelengkapan | `SIAP`, `PERLU REVISI`, `TERTAHAN` |

Preset `code` adalah perilaku lama dan dipakai untuk sesi yang dibuat sebelum fitur preset ada. Sesi lama tanpa `presetId` tetap terbaca dan tampil sebagai Code Review.

Preset `translate` memakai empat lensa QA default: Kesetiaan Makna, Kealamian Bahasa, Istilah & Nama, dan Format & Kelengkapan. Lensa Konsistensi & Kontinuitas tersedia sebagai tambahan bila keputusan istilah dan kesinambungan lintas bab perlu diaudit.

### Review Novel

Reviewer novel membaca naskah dari **workspace**, bukan dari database. Plugin tidak mengakses D1 Novelin. Sebelum memulai sesi:

1. Ekspor atau salin naskah ke workspace sebagai teks/Markdown, misalnya `manuscript/bab-01.md`, `manuscript/bab-02.md`, dan seterusnya.
2. Sertakan bahan kanon bila ada: ringkasan plot, wiki tokoh, daftar istilah, atau catatan benang.
3. Isi target dengan path atau rentang bab, misalnya `manuscript/` atau `bab 3–5`.
4. Pilih lensa. Default-nya alur, tokoh, dunia, dan gaya; tambahkan pacing bila tempo dan ketegangan pembaca perlu ditinjau.

Laporan naratif ditulis dalam bahasa Indonesia, sedangkan kunci JSON, marker, dan enum verdict tetap bahasa Inggris agar parser tetap stabil.

### Terjemahan Novel (EN→ID)

Mode terjemahan memakai alur dua tahap. Lead membuat satu **Penerjemah** per unit (biasanya satu bab), menunggu semua unit mencapai status terminal, lalu membuat satu **Peninjau QA** per lensa untuk membandingkan sumber dan hasil sebelum menyusun laporan akhir.

Sumber dan hasil sama-sama berada di **workspace**. Plugin tidak mengakses database D1 Novelin.

1. Siapkan naskah Inggris di workspace sebagai teks/Markdown, misalnya `manuscript/en/bab-01.md`. Sertakan glosarium, daftar nama, atau catatan kanon bila ada.
2. Pilih preset **Terjemahan Novel**.
3. Isi **Sumber & rentang bab**, misalnya `manuscript/en/ (bab 1–20)`. Batasi sesi pada satu arc atau volume; default-nya maksimal 20 unit dan 5 penerjemah paralel per sesi.
4. Isi **Folder hasil** relatif terhadap workspace, misalnya `translated/id`. Folder wajib berada di dalam workspace, bukan root workspace, bukan `.git`, dan tidak boleh keluar lewat `..` atau symlink. Plugin **tidak membuat folder**; buat folder bila perlu atau biarkan penerjemah membuatnya sesuai izin agen.
5. Pilih lensa QA, kedalaman, provider, dan model. Bila tersedia, pilih juga **Mode** dan **Thinking level** untuk lead, penerjemah, dan peninjau QA. Penerjemah membutuhkan model dan izin yang dapat menulis file; peninjau QA cukup read-only.
6. Mulai sesi. Lead membuat penerjemah per bab dan meneruskan path sumber, path hasil, bahasa, gaya, glosarium, serta protokol laporan.
7. Pantau progres unit di panel. Penghitung memakai `selesai/ditemukan` karena total unit baru diketahui dari agen yang benar-benar dibuat; plugin tidak menebak jumlah bab.
8. Setelah semua unit terminal, lead membuat peninjau QA. QA membandingkan sumber dan hasil per lensa dan melapor hanya kepada lead.
9. Baca **Catatan QA** dan laporan akhir di panel, lalu buka file hasil dari **file explorer workspace Paseo**. Panel tidak menyediakan preview file.
10. Hentikan sesi kapan saja; opsional arsipkan lead, penerjemah, dan QA. File hasil tidak dihapus.

Untuk novel panjang (misalnya 872 bab), jalankan beberapa sesi per arc/volume. Ini disengaja: batas unit dan konkuransi menjaga sesi tetap dapat diamati dan dipulihkan, bukan pipeline bulk sekali jalan.

Penerjemah dapat **menimpa** file yang sudah ada di folder hasil. Tinjau folder dan izin agen sebelum memulai. Plugin sendiri tidak menulis, membuat, atau menghapus file/folder workspace; plugin hanya memvalidasi folder sebelum sesi dan memverifikasi path hasil setelah laporan.

Jika penerjemah mengklaim `DONE` tetapi path hasil hilang, berada di luar folder hasil, tidak aman, atau sama dengan sumber, unit ditandai `needs_input`, event peringatan dicatat, dan unit tidak dihitung selesai. Perbaiki path atau minta penerjemah mengulang.

### Preset custom

Plugin membaca `$PASEO_HOME/plugin-data/review-team/presets.json` (atau `$REVIEW_TEAM_DATA_DIR/presets.json` bila override pengembangan aktif). File ini dibaca saat state dimuat dan tidak pernah ditulis oleh plugin.

- Maksimal 25 preset custom dan 8 lensa per preset; ukuran file maksimal 64 KB.
- ID preset dan ID lensa memakai slug huruf kecil: `^[a-z][a-z0-9-]{0,39}$`.
- ID `code`, `novel`, dan `translate` dicadangkan untuk preset bawaan. ID duplikat ditolak; preset bawaan selalu menang.
- `defaultLensIds` wajib minimal satu dan harus subset dari `lenses`.
- Ketiga kedalaman (`quick`, `standard`, `deep`) dan keenam label verdict wajib lengkap.
- `task` default-nya `"review"`. Preset review lama tanpa `task` tetap valid dan tidak boleh membawa blok `translation`.
- Preset terjemahan custom wajib memakai `task: "translate"` dan menyertakan `translation`, `roles.translator`, `roles.translatorPlural`, `prompt.translatorRole`, `prompt.translatorRules`, dan `prompt.translationFocus`.
- `translation.defaultOutputDir` wajib path relatif yang aman; berlaku batas `maxUnitsPerSession` (1–50) dan `maxConcurrentTranslators` (1–8).
- Entri yang tidak valid dibuang, bukan menggagalkan plugin. Peringatan tampil di panel Review Team.
- Field `source` diabaikan saat load; plugin selalu menandai preset file sebagai `custom`.
- Blok `prompt` tidak pernah dikirim ke client.

Contoh lengkap tersedia di [`examples/presets.example.json`](examples/presets.example.json). Bentuk minimalnya:

```json
{
  "version": 1,
  "presets": [
    {
      "id": "game-design",
      "label": "Game Design Review",
      "description": "Review dokumen desain game dari lensa balance, narasi, dan UX.",
      "target": {
        "label": "Dokumen desain",
        "hint": "Tunjuk path dokumen GDD atau bagian yang perlu ditinjau.",
        "placeholder": "mis. docs/gdd/combat.md"
      },
      "lenses": [
        { "id": "balance", "label": "Balance", "hint": "Angka, ekonomi, dan loop permainan." },
        { "id": "narrative", "label": "Narasi", "hint": "Alur cerita dan konsistensi dunia." },
        { "id": "ux", "label": "UX", "hint": "Beban kognitif dan kejelasan instruksi." }
      ],
      "defaultLensIds": ["balance", "narrative"],
      "depths": {
        "quick": { "label": "Cepat", "hint": "Satu bagian.", "guidance": "Read only the section named in the brief." },
        "standard": { "label": "Standar", "hint": "Dokumen utama.", "guidance": "Read the target document and its immediate references." },
        "deep": { "label": "Mendalam", "hint": "Dokumen dan referensi.", "guidance": "Trace related systems and note remaining uncertainty." }
      },
      "roles": { "lead": "Ketua", "reviewer": "Peninjau", "reviewerPlural": "para peninjau" },
      "labels": {
        "findings": "Temuan",
        "location": "Bagian",
        "recommendation": "Saran",
        "verdicts": {
          "approve": "SIAP",
          "request_changes": "REVISI",
          "blocked": "TERTAHAN",
          "pass": "LULUS",
          "warn": "CATATAN",
          "fail": "GAGAL"
        }
      },
      "ui": { "startHint": "Peninjau akan membaca dokumen desain di workspace." },
      "prompt": {
        "leadRole": "You are the lead of a game design review team.",
        "leadRules": ["This is a read-only review. Never edit the document."],
        "reviewerRole": "You are a game design reviewer reporting to the lead.",
        "reviewerRules": ["Support every finding with a section reference."],
        "evidenceRules": ["Quote the relevant section or mark the claim unverified."],
        "consolidationFocus": ["Merge overlapping notes and rank by player impact."],
        "verdictGuidance": "Use approve only when no material design issue remains.",
        "locationExample": "section:line atau null",
        "reportLanguage": "Indonesian"
      }
    }
  ]
}
```

Bentuk minimal preset terjemahan custom (contoh lengkap ada di [`examples/presets.example.json`](examples/presets.example.json)):

```json
{
  "id": "novel-fr-id",
  "label": "Terjemahan Prancis",
  "description": "Terjemahkan naskah Prancis ke Indonesia per bab, lalu periksa hasilnya dengan QA.",
  "task": "translate",
  "translation": {
    "sourceLanguage": "French",
    "targetLanguage": "Indonesian",
    "defaultOutputDir": "translated/id-fr",
    "unitLabel": "Bab",
    "outputExtension": ".md",
    "maxUnitsPerSession": 12,
    "maxConcurrentTranslators": 4
  },
  "target": {
    "label": "Sumber & rentang bab",
    "hint": "Sebutkan file atau folder sumber dan rentang bab untuk sesi ini.",
    "placeholder": "mis. manuscript/fr/ (bab 1–12)"
  },
  "lenses": [
    { "id": "fidelity", "label": "Kesetiaan Makna", "hint": "Makna dan detail yang hilang atau ditambahkan." },
    { "id": "style", "label": "Gaya", "hint": "Diksi dan ritme bahasa Indonesia." }
  ],
  "defaultLensIds": ["fidelity", "style"],
  "depths": {
    "quick": { "label": "Cepat", "hint": "Sampel unit.", "guidance": "Check a sample of each unit and mark the rest unverified." },
    "standard": { "label": "Standar", "hint": "Semua unit dalam rentang.", "guidance": "Compare every unit in scope against the source." },
    "deep": { "label": "Mendalam", "hint": "Semua unit dan lintas bab.", "guidance": "Audit the full range and cross-check terminology across chapters." }
  },
  "roles": {
    "lead": "Ketua",
    "reviewer": "Peninjau QA",
    "reviewerPlural": "para peninjau QA",
    "translator": "Penerjemah",
    "translatorPlural": "para penerjemah"
  },
  "labels": {
    "findings": "Catatan QA",
    "location": "Bab/berkas",
    "recommendation": "Saran perbaikan",
    "verdicts": {
      "approve": "SIAP",
      "request_changes": "PERLU REVISI",
      "blocked": "TERTAHAN",
      "pass": "LULUS",
      "warn": "CATATAN",
      "fail": "GAGAL"
    }
  },
  "ui": { "startHint": "Penerjemah menulis hasil ke folder workspace; QA berjalan setelah semua unit terminal." },
  "prompt": {
    "leadRole": "You are the lead of a French-to-Indonesian novel translation team.",
    "leadRules": ["This is a translation session. Never edit the source files; only translators write output."],
    "reviewerRole": "You are a QA reviewer comparing the French source with the Indonesian translation.",
    "reviewerRules": ["Read-only. Never edit the translation or the source."],
    "evidenceRules": ["Quote both the source and the translation for every finding."],
    "consolidationFocus": ["Merge notes across lenses and rank by impact on meaning and readability."],
    "verdictGuidance": "Use approve only when every unit is complete and faithful enough to read.",
    "locationExample": "Bab 3 atau null",
    "reportLanguage": "Indonesian",
    "translatorRole": "You are a translator writing one Indonesian unit from a French source.",
    "translatorRules": ["Translate faithfully and write only the assigned output file."],
    "translationFocus": ["Every source sentence is represented and no new information is added."]
  }
}
```

Ubah file, lalu muat ulang plugin atau buka ulang panel. Peringatan validasi muncul di panel; detailnya juga tercatat di `paseo plugin logs review-team`.

## Format laporan

Penerjemah menutup giliran dengan status dan path hasil yang relatif terhadap root workspace:

````text
TRANSLATION_REPORT: DONE|BLOCKED|FAILED
```translation-output
{"unit":"Bab 1","source":"manuscript/en/bab-01.md","output":"translated/id/bab-01.md","summary":"...","notes":[]}
```
````

Reviewer (termasuk peninjau QA terjemahan) menutup giliran dengan:

````text
REVIEW_REPORT: DONE|BLOCKED|FAILED
```review-findings
{"lens":"security","verdict":"pass|warn|fail","summary":"...","findings":[]}
```
````

Lead menutup sesi dengan blok di antara sentinel:

````text
=== REVIEW TEAM REPORT BEGIN ===
REVIEW_VERDICT: approve|request_changes|blocked
```review-final
{"summary":"...","findings":[...]}
```
=== REVIEW TEAM REPORT END ===
````

JSON yang rusak tidak menggagalkan sesi: laporan mentah tetap disimpan dan ditampilkan sebagai teks. Kunci JSON, sentinel, nama lensa internal, dan enum verdict/severity selalu bahasa Inggris; hanya teks naratif yang mengikuti bahasa preset.

## Data dan privasi

- Data plugin: `$PASEO_HOME/plugin-data/review-team/` (override pengembangan: `REVIEW_TEAM_DATA_DIR`).
- Berisi `index.json`, `defaults.json`, dan `sessions/<id>.json`; event dibatasi 200 per sesi.
- `presets.json` adalah file input milik operator. Plugin hanya membacanya, tidak pernah menulis atau mengubahnya.
- Penulisan atomic dengan fallback Windows; file korup dilewati saat load.
- File hasil terjemahan berada di folder hasil workspace, bukan di data plugin. Penerjemah yang menulis file tersebut; plugin tidak menulisnya.
- Plugin hanya memvalidasi folder hasil dan memverifikasi path hasil lewat `realpath`/`lstat`; plugin tidak membaca isi naskah.
- Plugin tidak mengirim data ke layanan eksternal. Trafik model tetap melalui provider yang dipilih di Paseo.
- Menghapus plugin tidak menghapus data. Hapus direktori di atas secara manual bila ingin bersih total.

## Keamanan dan batasan

- **Review read-only dan terjemahan menulis — keduanya instruksi prompt, bukan sandbox.** Lead, reviewer, dan penerjemah tetap memakai izin agen dan kebijakan tool provider masing-masing. Tinjau izin yang diminta; plugin tidak menyetujuinya otomatis.
- **Plugin tidak menulis workspace.** Pada mode terjemahan hanya agen penerjemah yang menulis file. Plugin memvalidasi folder hasil sebelum sesi dan memverifikasi path setelah laporan, tanpa membuat atau menghapus file/folder.
- **Validasi path bukan jaminan.** Penerjemah yang menyimpang dari brief masih dapat menulis di luar folder hasil bila izin agennya mengizinkan. Batasi izin agen dan periksa hasilnya.
- **Agent tools global.** Mengaktifkan `mcp.injectIntoAgents` memengaruhi agen baru di seluruh daemon, bukan hanya sesi ini. Itulah sebabnya plugin meminta consent eksplisit.
- **Stop tidak instan.** Plugin menginterupsi lead, menandai sesi berhenti, dan menawarkan arsip agen. Reviewer atau penerjemah yang sedang berjalan dapat menyelesaikan langkah aman terakhirnya.
- **Bukan penjamin kebenaran.** Kualitas review/terjemahan bergantung pada model, target yang diberikan, dan kepatuhan agen terhadap format laporan.

## Pengembangan

```bash
npm install
npm run typecheck
npm test
```

Audit UI mobile (tidak boleh ada DOM/CSS/event web di `client/`):

```bash
rg -n "document\.|window\.|localStorage|navigator\.|</?(div|span|p|a|button|input|img|ul|ol|li|h[1-6]|section|label|form|textarea)[ >/]|className=|onClick=" client/
```

Struktur:

```
paseo-plugin.json     manifest (id, requirements)
index.client.tsx      panel workspace + item Command Center
index.server.ts       registrasi RPC + observer
shared/               kontrak Zod, konstanta, preset, prompt, parser laporan, helper path terjemahan
server/               store, loader preset, SDK agen, observer, service sesi, validasi path terjemahan
client/               panel, form setup, komponen React Native (termasuk kartu penerjemah)
examples/             contoh presets.json review dan terjemahan
tests/                parser, preset, prompt, loader, store, dan path terjemahan
```

## Batasan v1.2

- Tidak ada pesan peer-to-peer antaragen; lead adalah hub.
- Plugin tidak membuat reviewer atau penerjemah sendiri; itu tugas lead lewat alat native.
- Preset custom hanya lewat file JSON; belum ada editor preset di UI.
- Tidak ada render markdown, slash command, layar settings, atau rilis npm.
- Satu sesi aktif per workspace; tidak ada sesi lintas workspace.
- Tidak ada auto-approve izin atau auto-arsip tanpa persetujuan operator.
- Plugin tidak membaca database D1 Novelin; naskah harus tersedia sebagai file teks/Markdown di workspace atau ditempel ke target.
- Terjemahan dibatasi per batch; tidak ada pipeline bulk untuk ratusan bab dalam satu sesi.
- Total unit terjemahan mengikuti agen yang benar-benar ditemukan, bukan daftar bab yang ditebak plugin.
- Panel tidak membuka atau mem-preview file hasil; buka dari file explorer workspace.
- Plugin tidak membuat atau menulis file/folder workspace; hanya penerjemah yang menulis, dan plugin memverifikasi path secara read-only.

## Lisensi

MIT. Lihat [LICENSE](LICENSE).
