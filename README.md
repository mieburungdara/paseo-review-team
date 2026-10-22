# Review Team untuk Paseo

Plugin Paseo yang membuka **ruang review multi-agen** di setiap workspace. Satu agen **lead** memimpin beberapa **reviewer** paralel, menggabungkan temuan, dan menyusun satu laporan akhir. Tersedia preset bawaan **Code Review** dan **Review Novel**, plus preset custom lewat file JSON. Panel workspace menampilkan status lead, coverage tiap lensa, temuan terstruktur, event, dan laporan konsolidasi.

Plugin ini mengikuti model koordinasi native Paseo: lead membuat reviewer dengan alat `create_agent`, reviewer melapor hanya kepada lead, dan lead menjadi hub yang meneruskan konteks antarlensa. Tidak ada pesan peer-to-peer yang dibuat-buat.

## Fitur

- **Preset bawaan & custom** — Code Review dan Review Novel; ganti preset di form setup untuk mengganti lensa, kedalaman, copy UI, dan gaya laporan. Preset custom dibaca dari `presets.json`.
- **Lead + reviewer paralel** — satu reviewer per lensa yang dipilih. Preset Code Review memakai correctness, security, tests, architecture, dan performance; preset Review Novel memakai alur, tokoh, dunia, gaya, dan pacing.
- **Coverage dari agen nyata** — dihitung dari reviewer yang benar-benar ditemukan lewat label sesi dan `paseo.parent-agent-id`, bukan dari klaim lead.
- **Laporan terstruktur** — JSON `review-findings` per reviewer dan `review-final` dari lead; parser toleran dengan fallback teks mentah.
- **Visibilitas izin** — permintaan izin yang menunggu terlihat di panel; plugin **tidak pernah** menyetujui izin otomatis.
- **Kontrol operator** — kirim arahan ke lead, minta laporan ulang, hentikan sesi, dan opsional arsipkan semua agen.
- **Persistence lokal** — snapshot sesi, default setup, dan event feed disimpan di data plugin dengan penulisan atomic. File preset milik operator tidak pernah ditulis plugin.
- **Panel mobile** — React Native primitives, warna tema Paseo, dan layout compact.

## Persyaratan

- Paseo **>= 0.12.0** (daemon dan app).
- Provider/model yang mendukung tool use.
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
3. Pilih preset: **Code Review**, **Review Novel**, atau preset custom yang terdeteksi. Label target, daftar lensa, dan pilihan kedalaman mengikuti preset.
4. Isi target review. Untuk kode, misalnya `diff vs main`, `src/auth/login`, atau `PR #42`; untuk novel, misalnya `manuscript/bab-03.md` atau `bab 3–5`.
5. Pilih lensa, kedalaman, provider, dan model. Mengganti preset mengembalikan lensa dan kedalaman ke default preset tersebut.
6. Jika agent tools belum aktif, tinjau penjelasannya lalu aktifkan lewat tombol consent.
7. Mulai review. Lead akan membuat satu reviewer per lensa.
8. Pantau coverage, status lead, kartu reviewer, dan event. Pesan lead bila perlu mengarahkan ulang.
9. Setelah semua lensa memberi hasil, plugin mengingatkan lead untuk berkonsolidasi dan mengirim laporan akhir.
10. Hentikan sesi kapan saja; opsional arsipkan lead dan reviewer setelah dihentikan.

Sesi yang sudah `complete`, `stopped`, atau `failed` dapat digantikan dengan review baru di workspace yang sama. Hanya satu sesi aktif diperbolehkan per workspace.

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

- Plugin hanya membuat **lead**. Lead yang membuat reviewer memakai alat agen Paseo, sehingga hierarki dan notifikasi tetap native.
- Observer memakai `agent.created`, `turn_started`, `turn_ended`, `permission_requested`, `permission_resolved`, `archived`, dan `closed`, ditambah rekonsiliasi periodik lewat SDK.
- Reviewer ditemukan dari label `review-team.session`, `review-team.lens`, dan label bawaan `paseo.parent-agent-id`.
- Saat semua lensa sudah memberi hasil, plugin mengirim satu pesan konsolidasi ke lead. Ini adalah jaring pengaman bila notifikasi selesai native tidak membangunkan lead.
- Laporan reviewer dibaca dari timeline agen setelah giliran selesai, lalu dipetakan ke state sesi.
- Preset menentukan daftar lensa, prompt peran, kedalaman, dan copy UI. Protokol laporan tidak berubah antar-preset.

## Preset

### Preset bawaan

| ID | Label | Lensa default | Verdict lead |
| --- | --- | --- | --- |
| `code` | Code Review | correctness, security, tests, architecture, performance | `APPROVE`, `PERLU PERUBAHAN`, `BLOCKED` |
| `novel` | Review Novel | Alur & Benang, Konsistensi Tokoh, Dunia & Istilah, Gaya & Suara | `SIAP`, `PERLU REVISI`, `TERTAHAN` |

Preset `code` adalah perilaku lama dan dipakai untuk sesi yang dibuat sebelum fitur preset ada. Sesi lama tanpa `presetId` tetap terbaca dan tampil sebagai Code Review.

### Review Novel

Reviewer novel membaca naskah dari **workspace**, bukan dari database. Plugin tidak mengakses D1 Novelin. Sebelum memulai sesi:

1. Ekspor atau salin naskah ke workspace sebagai teks/Markdown, misalnya `manuscript/bab-01.md`, `manuscript/bab-02.md`, dan seterusnya.
2. Sertakan bahan kanon bila ada: ringkasan plot, wiki tokoh, daftar istilah, atau catatan benang.
3. Isi target dengan path atau rentang bab, misalnya `manuscript/` atau `bab 3–5`.
4. Pilih lensa. Default-nya alur, tokoh, dunia, dan gaya; tambahkan pacing bila tempo dan ketegangan pembaca perlu ditinjau.

Laporan naratif ditulis dalam bahasa Indonesia, sedangkan kunci JSON, marker, dan enum verdict tetap bahasa Inggris agar parser tetap stabil.

### Preset custom

Plugin membaca `$PASEO_HOME/plugin-data/review-team/presets.json` (atau `$REVIEW_TEAM_DATA_DIR/presets.json` bila override pengembangan aktif). File ini dibaca saat state dimuat dan tidak pernah ditulis oleh plugin.

- Maksimal 25 preset custom dan 8 lensa per preset; ukuran file maksimal 64 KB.
- ID preset dan ID lensa memakai slug huruf kecil: `^[a-z][a-z0-9-]{0,39}$`.
- ID `code` dan `novel` dicadangkan untuk preset bawaan. ID duplikat ditolak; preset bawaan selalu menang.
- `defaultLensIds` wajib minimal satu dan harus subset dari `lenses`.
- Ketiga kedalaman (`quick`, `standard`, `deep`) dan keenam label verdict wajib lengkap.
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

Ubah file, lalu muat ulang plugin atau buka ulang panel. Peringatan validasi muncul di panel; detailnya juga tercatat di `paseo plugin logs review-team`.

## Format laporan

Reviewer menutup giliran dengan:

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
- Plugin tidak mengirim data ke layanan eksternal. Trafik model tetap melalui provider yang dipilih di Paseo.
- Menghapus plugin tidak menghapus data. Hapus direktori di atas secara manual bila ingin bersih total.

## Keamanan dan batasan

- **Read-only bersifat instruksi prompt, bukan sandbox.** Lead dan reviewer tetap memakai izin agen dan kebijakan tool provider masing-masing. Tinjau izin yang diminta; plugin tidak menyetujuinya otomatis.
- **Agent tools global.** Mengaktifkan `mcp.injectIntoAgents` memengaruhi agen baru di seluruh daemon, bukan hanya sesi ini. Itulah sebabnya plugin meminta consent eksplisit.
- **Stop tidak instan.** Plugin menginterupsi lead, menandai sesi berhenti, dan menawarkan arsip agen. Reviewer yang sedang berjalan dapat menyelesaikan langkah aman terakhirnya.
- **Bukan penjamin kebenaran review.** Kualitas bergantung pada model, target yang diberikan, dan kepatuhan agen terhadap format laporan.

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
shared/               kontrak Zod, konstanta, preset, prompt, parser laporan
server/               store, loader preset, SDK agen, observer, service sesi
client/               panel, form setup, komponen React Native
examples/             contoh presets.json
tests/                parser, preset, prompt, loader, dan store
```

## Batasan v1

- Tidak ada pesan peer-to-peer antarreviewer; lead adalah hub.
- Plugin tidak membuat reviewer sendiri; itu tugas lead lewat alat native.
- Preset custom hanya lewat file JSON; belum ada editor preset di UI.
- Tidak ada render markdown, slash command, layar settings, atau rilis npm.
- Satu sesi aktif per workspace; tidak ada review lintas workspace.
- Tidak ada auto-approve izin atau auto-arsip tanpa persetujuan operator.
- Plugin tidak membaca database D1 Novelin; naskah harus tersedia sebagai file teks/Markdown di workspace atau ditempel ke target.

## Lisensi

MIT. Lihat [LICENSE](LICENSE).
