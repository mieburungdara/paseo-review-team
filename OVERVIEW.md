# Review Team

Review Team menambahkan ruang review multi-agen ke panel workspace Paseo. Satu agen **lead** memimpin beberapa **reviewer** paralel — satu per lensa — lalu menggabungkan temuan menjadi satu laporan dengan verdict dan daftar temuan terstruktur.

## Kapan dipakai

Gunakan plugin ini ketika perubahan perlu ditinjau dari beberapa sudut pandang sekaligus: correctness, security, tests, architecture, dan performance. Cocok untuk review PR, diff branch, atau area kode yang berisiko tinggi.

## Cara kerja

1. Operator memilih target review, lensa, kedalaman, dan model.
2. Plugin membuat satu agen lead dengan instruksi konsolidasi dan label sesi.
3. Lead membuat reviewer lewat alat agen native Paseo (`create_agent`), satu reviewer per lensa.
4. Reviewer bekerja paralel dan melapor hanya kepada lead; lead menjadi hub yang meneruskan konteks antarlensa.
5. Plugin mengamati lifecycle agen, mem-parse laporan dari timeline, dan menghitung coverage dari reviewer yang benar-benar berjalan.
6. Setelah semua lensa memberi hasil, plugin mengingatkan lead untuk berkonsolidasi bila diperlukan, lalu menampilkan laporan akhir.

Panel menampilkan status lead, coverage, kartu reviewer, temuan per severity, laporan akhir, event feed, dan composer untuk mengirim arahan ke lead.

## Persyaratan

- Paseo >= 0.12.0.
- Agent tools diaktifkan (`mcp.injectIntoAgents`). Panel menyediakan consent gate; plugin tidak mengaktifkannya otomatis.
- Provider/model dengan dukungan tool use.

## Keamanan

- Review bersifat read-only **lewat instruksi prompt**, bukan sandbox. Izin agen tetap berlaku dan ditinjau manual di Paseo.
- Plugin tidak pernah menyetujui permintaan izin otomatis.
- Mengaktifkan agent tools adalah perubahan setelan daemon yang bersifat global untuk agen baru.
- Data sesi disimpan lokal di `$PASEO_HOME/plugin-data/review-team/`; tidak ada pengiriman ke layanan eksternal oleh plugin.

## Batasan

- Tidak ada pesan peer-to-peer antarreviewer.
- Satu sesi aktif per workspace.
- Belum ada render markdown, slash command, layar settings, atau rilis npm.
- Stop menginterupsi lead; reviewer dapat menyelesaikan langkah aman terakhirnya.

## Lisensi

MIT.
