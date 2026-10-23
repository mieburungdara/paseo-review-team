# Review Team

Review Team menambahkan ruang tim multi-agen ke panel workspace Paseo dengan dua task:

- **Review** — satu agen **lead** memimpin beberapa **reviewer** paralel (satu per lensa), lalu menggabungkan temuan menjadi satu laporan dengan verdict dan daftar temuan terstruktur.
- **Terjemahan** — lead memimpin **penerjemah** per unit yang menulis naskah Indonesia ke folder hasil workspace, lalu **peninjau QA** read-only membandingkan sumber dan hasil sebelum lead mengonsolidasikan laporan.

Plugin menyertakan preset **Code Review**, **Review Novel**, dan **Terjemahan Novel** (English → Indonesian), serta menerima preset custom dari `presets.json`. Preset menentukan task, lensa, kedalaman, prompt peran, batas batch, dan copy panel tanpa mengubah protokol laporan review.

## Kapan dipakai

- **Code Review** untuk PR, diff branch, atau area kode berisiko: correctness, security, tests, architecture, performance.
- **Review Novel** untuk naskah fiksi: alur, konsistensi tokoh, dunia dan istilah, gaya, serta pacing.
- **Terjemahan Novel** untuk naskah Inggris yang perlu diterjemahkan ke Indonesia per bab, dengan QA kesetiaan makna, kealamian bahasa, istilah, dan kelengkapan.
- **Preset custom** untuk dokumen, bahasa, atau aset lain yang butuh reviewer/penerjemah terkoordinasi.

## Cara kerja review

1. Operator memilih preset review, target, lensa, kedalaman, provider, model, serta mode dan thinking level bila tersedia. Pilihan ini berlaku untuk lead dan semua reviewer.
2. Plugin membuat satu agen lead dengan instruksi konsolidasi, label sesi, prompt sesuai preset, dan mode/thinking pilihan operator.
3. Lead membuat reviewer lewat alat agen native Paseo (`create_agent`), satu reviewer per lensa, dengan `settings` yang sama.
4. Reviewer bekerja paralel dan melapor hanya kepada lead; lead menjadi hub yang meneruskan konteks antarlensa.
5. Plugin mengamati lifecycle agen, mem-parse laporan dari timeline, dan menghitung coverage dari reviewer yang benar-benar berjalan.
6. Setelah semua lensa memberi hasil, plugin mengingatkan lead untuk berkonsolidasi, lalu menampilkan laporan akhir.

## Cara kerja terjemahan

```
Operator: sumber + rentang bab + folder hasil
   │
   ▼
Plugin ── membuat ──► Lead (fase translating)
                        │ create_agent (maks. 5 penerjemah aktif)
                        ├──► Penerjemah: Bab 1 ── tulis translated/id/bab-01.txt
                        ├──► Penerjemah: Bab 2
                        └──► Penerjemah: Bab N
                        │
                        │ semua unit terminal
                        ├──► Peninjau QA: Kesetiaan Makna
                        ├──► Peninjau QA: Kealamian Bahasa
                        ├──► Peninjau QA: Istilah & Nama
                        └──► Peninjau QA: Format & Kelengkapan
                        │
                        ▼
                     Lead konsolidasi → laporan akhir
```

1. Operator memilih preset terjemahan, sumber/rentang, folder hasil relatif, format berkas (`.txt` default atau `.md`), lensa QA, kedalaman, provider, model, serta mode dan thinking level bila tersedia. Pilihan ini berlaku untuk lead, penerjemah, dan QA.
2. Plugin memvalidasi folder hasil (relatif, di dalam workspace, bukan root/`.git`, aman dari `..`/symlink) sebelum membuat lead. Plugin tidak membuat folder.
3. Lead membuat satu penerjemah per unit pada batch saat ini. Setiap penerjemah menulis hanya file hasil yang ditugaskan.
4. Penerjemah menutup giliran dengan `TRANSLATION_REPORT` dan `translation-output` berisi path sumber/hasil relatif workspace.
5. Plugin memverifikasi path hasil secara read-only. Klaim DONE dengan hasil hilang/di luar folder/tidak aman/sama dengan sumber menjadi `needs_input` dan tidak dihitung selesai.
6. Setelah semua unit terminal, lead membuat peninjau QA per lensa. QA read-only membandingkan sumber dan hasil.
7. Plugin mengingatkan lead untuk konsolidasi setelah semua lensa QA accounted; lead mengirim laporan akhir dengan protokol review yang sama.

Panel menampilkan status lead, progres unit (`selesai/ditemukan`), kartu penerjemah dan path hasil, coverage QA, temuan per severity, laporan akhir, event feed, dan composer untuk mengirim arahan ke lead.

## Preset

- `code` (bawaan) mempertahankan perilaku lama dan dipakai untuk sesi tanpa `presetId`.
- `novel` memakai lensa plot, character, world, prose, dan pacing; peran Ketua/Peninjau; verdict SIAP/PERLU REVISI/TERTAHAN; laporan naratif bahasa Indonesia.
- `translate` memakai task terjemahan EN→ID, folder hasil default `translated/id`, format hasil default `.txt` (bisa diganti `.md` per sesi), satu penerjemah per bab, dan lensa QA fidelity/naturalness/terminology/consistency/format.
- Preset custom dimuat dari `$PASEO_HOME/plugin-data/review-team/presets.json`, divalidasi per entri, dan entri invalid dibuang dengan peringatan di panel. ID `code`, `novel`, dan `translate` dicadangkan.
- Naskah (sumber dan hasil) harus berada di workspace sebagai teks/Markdown. Plugin tidak mengakses D1 Novelin.
- Kunci JSON, marker, dan enum verdict tetap bahasa Inggris agar parser dan sesi lama tetap kompatibel.

## Berkas baru untuk terjemahan

- `shared/translation.ts` — helper path relatif dan label status output.
- `server/translation.ts` — validasi folder hasil dan verifikasi path output.
- `shared/reports.ts` — parser `TRANSLATION_REPORT` di samping parser review.
- `client/components.tsx` — `TranslatorCard` dan `OutputStatusBadge`.

## Persyaratan

- Paseo >= 0.12.0.
- Agent tools diaktifkan (`mcp.injectIntoAgents`). Panel menyediakan consent gate; plugin tidak mengaktifkannya otomatis.
- Provider/model dengan dukungan tool use; mode dan thinking level opsional tergantung apa yang diekspos provider. Penerjemah membutuhkan kemampuan menulis file.

## Keamanan

- Review bersifat read-only dan terjemahan menulis file — keduanya **lewat instruksi prompt**, bukan sandbox. Izin agen tetap berlaku dan ditinjau manual di Paseo.
- Plugin tidak pernah menyetujui permintaan izin otomatis.
- Plugin tidak membuat atau menulis file/folder workspace. Hanya agen penerjemah yang menulis, dan plugin memverifikasi path secara read-only.
- Path hasil divalidasi sebelum sesi dan diverifikasi setelah laporan, tetapi tidak menjamin kepatuhan agen. Batasi izin agen.
- Data sesi disimpan lokal di `$PASEO_HOME/plugin-data/review-team/`; file hasil berada di workspace, bukan di data plugin.
- `presets.json` hanya dibaca; plugin tidak menulis atau mengubah file milik operator.

## Batasan

- Tidak ada pesan peer-to-peer antaragen.
- Satu sesi aktif per workspace.
- Terjemahan dibatasi per batch (default 20 unit/sesi, 5 penerjemah paralel); novel panjang dijalankan dalam beberapa sesi.
- Total unit mengikuti agen yang ditemukan; bukan daftar bab yang ditebak plugin.
- Preset custom hanya lewat file JSON; belum ada editor preset di UI.
- Belum ada render markdown, slash command, layar settings, atau rilis npm.
- Stop menginterupsi lead; agen anak dapat menyelesaikan langkah aman terakhirnya. File hasil tidak dihapus.
- Panel tidak mem-preview file hasil; buka dari file explorer workspace.
- Plugin tidak membaca D1 Novelin; naskah harus tersedia di workspace.

## Lisensi

MIT.
