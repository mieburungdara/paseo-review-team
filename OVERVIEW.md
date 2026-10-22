# Review Team

Review Team menambahkan ruang review multi-agen ke panel workspace Paseo. Satu agen **lead** memimpin beberapa **reviewer** paralel — satu per lensa — lalu menggabungkan temuan menjadi satu laporan dengan verdict dan daftar temuan terstruktur.

Plugin menyertakan preset **Code Review** dan **Review Novel**, serta menerima preset custom dari `presets.json`. Preset menentukan lensa, kedalaman, prompt peran, dan copy panel tanpa mengubah protokol laporan.

## Kapan dipakai

Gunakan plugin ini ketika pekerjaan perlu ditinjau dari beberapa sudut pandang sekaligus:

- **Code Review** untuk PR, diff branch, atau area kode berisiko: correctness, security, tests, architecture, performance.
- **Review Novel** untuk naskah fiksi: alur, konsistensi tokoh, dunia dan istilah, gaya, serta pacing.
- **Preset custom** untuk dokumen atau aset lain yang butuh beberapa reviewer terkoordinasi.

## Cara kerja

1. Operator memilih preset, target review, lensa, kedalaman, dan model.
2. Plugin membuat satu agen lead dengan instruksi konsolidasi, label sesi, dan prompt sesuai preset.
3. Lead membuat reviewer lewat alat agen native Paseo (`create_agent`), satu reviewer per lensa.
4. Reviewer bekerja paralel dan melapor hanya kepada lead; lead menjadi hub yang meneruskan konteks antarlensa.
5. Plugin mengamati lifecycle agen, mem-parse laporan dari timeline, dan menghitung coverage dari reviewer yang benar-benar berjalan.
6. Setelah semua lensa memberi hasil, plugin mengingatkan lead untuk berkonsolidasi bila diperlukan, lalu menampilkan laporan akhir.

Panel menampilkan status lead, coverage, kartu reviewer, temuan per severity, laporan akhir, event feed, dan composer untuk mengirim arahan ke lead.

## Preset

- `code` (bawaan) mempertahankan perilaku lama dan dipakai untuk sesi tanpa `presetId`.
- `novel` memakai lensa plot, character, world, prose, dan pacing; peran Ketua/Peninjau; verdict SIAP/PERLU REVISI/TERTAHAN; laporan naratif bahasa Indonesia.
- Preset custom dimuat dari `$PASEO_HOME/plugin-data/review-team/presets.json`, divalidasi per entri, dan entri invalid dibuang dengan peringatan di panel.
- Untuk review novel, naskah dan catatan kanon harus diekspor ke workspace sebagai teks/Markdown. Plugin tidak mengakses D1 Novelin.
- Kunci JSON, marker, dan enum verdict tetap bahasa Inggris agar parser dan sesi lama tetap kompatibel.

## Persyaratan

- Paseo >= 0.12.0.
- Agent tools diaktifkan (`mcp.injectIntoAgents`). Panel menyediakan consent gate; plugin tidak mengaktifkannya otomatis.
- Provider/model dengan dukungan tool use.

## Keamanan

- Review bersifat read-only **lewat instruksi prompt**, bukan sandbox. Izin agen tetap berlaku dan ditinjau manual di Paseo.
- Plugin tidak pernah menyetujui permintaan izin otomatis.
- Mengaktifkan agent tools adalah perubahan setelan daemon yang bersifat global untuk agen baru.
- Data sesi disimpan lokal di `$PASEO_HOME/plugin-data/review-team/`; tidak ada pengiriman ke layanan eksternal oleh plugin.
- `presets.json` hanya dibaca; plugin tidak menulis atau mengubah file milik operator.

## Batasan

- Tidak ada pesan peer-to-peer antarreviewer.
- Satu sesi aktif per workspace.
- Preset custom hanya lewat file JSON; belum ada editor preset di UI.
- Belum ada render markdown, slash command, layar settings, atau rilis npm.
- Stop menginterupsi lead; reviewer dapat menyelesaikan langkah aman terakhirnya.
- Plugin tidak membaca D1 Novelin; naskah harus tersedia di workspace.

## Lisensi

MIT.
