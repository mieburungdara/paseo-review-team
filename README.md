# Review Team untuk Paseo

Plugin Paseo yang membuka **ruang review multi-agen** di setiap workspace. Satu agen **lead** memimpin beberapa **reviewer** paralel, menggabungkan temuan, dan menyusun satu laporan akhir. Panel workspace menampilkan status lead, coverage tiap lensa, temuan terstruktur, event, dan laporan konsolidasi.

Plugin ini mengikuti model koordinasi native Paseo: lead membuat reviewer dengan alat `create_agent`, reviewer melapor hanya kepada lead, dan lead menjadi hub yang meneruskan konteks antarlensa. Tidak ada pesan peer-to-peer yang dibuat-buat.

## Fitur

- **Lead + reviewer paralel** — satu reviewer per lensa: correctness, security, tests, architecture, performance.
- **Coverage dari agen nyata** — dihitung dari reviewer yang benar-benar ditemukan lewat label sesi dan `paseo.parent-agent-id`, bukan dari klaim lead.
- **Laporan terstruktur** — JSON `review-findings` per reviewer dan `review-final` dari lead; parser toleran dengan fallback teks mentah.
- **Visibilitas izin** — permintaan izin yang menunggu terlihat di panel; plugin **tidak pernah** menyetujui izin otomatis.
- **Kontrol operator** — kirim arahan ke lead, minta laporan ulang, hentikan sesi, dan opsional arsipkan semua agen.
- **Persistence lokal** — snapshot sesi, default setup, dan event feed disimpan di data plugin dengan penulisan atomic.
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
3. Isi target review (mis. `diff vs main`, `src/auth/login`, atau `PR #42`), pilih lensa, kedalaman, provider, dan model.
4. Jika agent tools belum aktif, tinjau penjelasannya lalu aktifkan lewat tombol consent.
5. Mulai review. Lead akan membuat satu reviewer per lensa.
6. Pantau coverage, status lead, kartu reviewer, dan event. Pesan lead bila perlu mengarahkan ulang.
7. Setelah semua lensa memberi hasil, plugin mengingatkan lead untuk berkonsolidasi dan mengirim laporan akhir.
8. Hentikan sesi kapan saja; opsional arsipkan lead dan reviewer setelah dihentikan.

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
- Reviewer ditemukan dari label `review-team.session` dan label bawaan `paseo.parent-agent-id`.
- Saat semua lensa sudah memberi hasil, plugin mengirim satu pesan konsolidasi ke lead. Ini adalah jaring pengaman bila notifikasi selesai native tidak membangunkan lead.
- Laporan reviewer dibaca dari timeline agen setelah giliran selesai, lalu dipetakan ke state sesi.

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

JSON yang rusak tidak menggagalkan sesi: laporan mentah tetap disimpan dan ditampilkan sebagai teks.

## Data dan privasi

- Data plugin: `$PASEO_HOME/plugin-data/review-team/` (override pengembangan: `REVIEW_TEAM_DATA_DIR`).
- Berisi `index.json`, `defaults.json`, dan `sessions/<id>.json`; event dibatasi 200 per sesi.
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
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```

Struktur:

```
paseo-plugin.json     manifest (id, requirements)
index.client.tsx      panel workspace + item Command Center
index.server.ts       registrasi RPC + observer
shared/               kontrak Zod, konstanta, prompt, parser laporan
server/               store, SDK agen, observer lifecycle, service sesi
client/               panel, form setup, komponen React Native
tests/                parser laporan dan store
```

## Batasan v1

- Tidak ada pesan peer-to-peer antarreviewer; lead adalah hub.
- Plugin tidak membuat reviewer sendiri; itu tugas lead lewat alat native.
- Tidak ada render markdown, slash command, layar settings, atau rilis npm.
- Satu sesi aktif per workspace; tidak ada review lintas workspace.
- Tidak ada auto-approve izin atau auto-arsip tanpa persetujuan operator.

## Lisensi

MIT. Lihat [LICENSE](LICENSE).
