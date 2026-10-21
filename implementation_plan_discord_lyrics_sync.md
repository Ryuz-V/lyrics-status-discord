Setelah membandingkan dokumen 

implementation_plan_discord_lyrics_sync.md
 dengan kondisi codebase project saat ini (

main.js
, 

spotify.js
, 

lyrics.js
, 

activitystatus.js
, dsb.), berikut adalah analisis komparasi mendalam serta rekomendasi hal yang perlu diubah, ditambahkan, dan dipertahankan:

2. Hal yang Perlu Diubah (Refactoring & Perbaikan)
1. Perlindungan Rate-Limit & Error Handling di 

discord.js
 (Paling Krusial)
Masalah saat ini: Setiap baris lirik berganti, fungsi updateCustomStatus langsung menembak API Discord PATCH /users/@me/settings. Jika ada baris lirik yang hanya berjarak 1 detik, ini melanggar batasan rate-limit Discord dan akun berisiko terkena rate limit 429 atau flagged.
Perubahan:
Tambahkan variabel lastSentTimestamp. Terapkan jeda minimum (misal minimal 3 detik antar-request).
Tangkap respon HTTP 429 Too Many Requests, baca nilai retry_after, dan jeda loop pengiriman status sesuai durasi tersebut.
2. Aktifkan Mode Ganda (Custom Status vs Discord RPC)
Masalah saat ini: Di 

activitystatus.js
, Anda sudah memiliki implementasi koneksi Discord RPC via IPC socket (\\.\pipe\discord-ipc-0) yang sangat rapi dengan dukungan timestamp, aset gambar, dan tombol. Namun di 

main.js
, RPC ini hanya di-connect, lirik lagu sama sekali tidak dikirimkan ke sana.
Perubahan:
Berikan pilihan di UI: Pengguna bisa memilih ingin menampilkan lirik via Custom Status (status teks kecil di profil dengan emoji) atau via Discord RPC (kotak aktivitas Rich Presence yang resmi, aman 100% dari ToS, dan tidak membutuhkan User Token berbahaya).
3. Pembersihan File & Dependensi Usang (Dead Code Cleanup)
Masalah saat ini: Project memiliki banyak file peninggalan masa lalu yang membingungkan:


spotify_api.js
 & 

setup-spotify.js
 (Express server port 8888 dan Spotify Web API Node yang sudah tidak dipakai).


index.js
 (file CLI lama yang tidak dipakai oleh Electron).
Dependensi di package.json seperti express, cors, spotify-web-api-node, @southctrl/musixmatch-lyrics, @mjba/lyrics.
Perubahan:
Hapus atau arsipkan file-file tersebut dan uninstall dependensi yang tidak terpakai agar ukuran bundle aplikasi jauh lebih ringan.
3. Hal yang Perlu Ditambahkan (Fitur Baru)
1. Listener Media OS (Windows SMTC)
Tujuan: Merealisasikan tujuan utama dokumen, yaitu membuat aplikasi bebas dari Spicetify (plug-and-play).
Yang perlu dibuat:
Modul pembaca Windows Media Session (misalnya menggunakan native library Node.js untuk Windows SMTC atau PowerShell/C# background helper) yang membaca judul lagu, artis, status play/pause, dan durasi secara global dari Windows.
Tetap sediakan opsi di pengaturan: Sumber Media = "OS Media (Rekomendasi)" atau "Spicetify WebSocket (Port 8974)" agar pengguna lama tetap bisa memilih.
2. In-Memory / Local Lyrics Cache di 

lyrics.js
Tujuan: Saat ini di 

main.js
, ketika lagu di-pause, variabel currentLyrics di-reset menjadi null. Begitu lagu di-resume, aplikasi kembali menembak API LRCLIB.
Yang perlu ditambahkan:
Buat const lyricsCache = new Map(); dengan key artist_name - track_name.
Sebelum melakukan HTTP request ke LRCLIB, periksa dulu apakah lirik lagu tersebut sudah ada di cache.
3. Deteksi Iklan Spotify Free (Ad Detection)
Tujuan: Pengguna Spotify Free sering kali terganggu karena iklan terdeteksi sebagai lagu.
Yang perlu ditambahkan:
Sebelum memanggil API lirik, cek jika artist === "Spotify" atau trackName.includes("Advertisement") atau durasi lagu $< 35\text{ detik}$.
Jika iklan terdeteksi, tunda sinkronisasi dan kosongkan status atau tampilkan teks 🎵 Iklan Spotify.
4. Slider Lyrics Offset di Antarmuka (

index.html
 & 

renderer.js
)
Tujuan: Kompensasi keterlambatan jaringan Discord berbeda-beda pada tiap pengguna. Nilai saat ini di-hardcode $+500\text{ ms}$.
Yang perlu ditambahkan:
Tambahkan slider di UI dari $-2.0\text{ s}$ hingga $+2.0\text{ s}$ (default $+0.4\text{ s}$).
Kirim nilai offset ini ke engine sinkronisasi di 

main.js
.
5. Dukungan System Tray (Minimize to Tray)
Tujuan: Aplikasi lirik seharusnya berjalan di latar belakang (background) dan tidak mengotori taskbar Windows pengguna saat sedang mendengarkan lagu.
Yang perlu ditambahkan:
Gunakan modul Tray dari Electron di 

main.js
.
Saat tombol close (X) atau minimize ditekan, sembunyikan window ke tray pojok kanan bawah.
6. Enkripsi Penyimpanan Token
Tujuan: Menyimpan Discord User Token dalam format JSON plaintext di komputer berisiko jika ada malware.
Yang perlu ditambahkan:
Gunakan API bawaan Electron safeStorage.encryptString() dan safeStorage.decryptString() saat menyimpan dan membaca token dari config.json.
4. Hal yang Sebaiknya Tetap Dipertahankan dari Project Sekarang
Fitur Rotasi Custom Status Text (

main.js:355-399
):
Di project Anda saat ini, terdapat fitur yang sangat bagus di mana ketika musik sedang berhenti / tidak berputar, status Discord akan otomatis berganti memutar teks custom yang dimasukkan pengguna (customText1, customText2, customText3) sesuai interval waktu customTime.
Fitur ini tidak ada di dokumen plan, tetapi merupakan nilai tambah yang sangat baik dan membuat profil Discord tetap menarik walau pengguna sedang tidak mendengarkan lagu.
Arsitektur Electron:
Dibandingkan migrasi ke Python, basis Electron yang sudah Anda buat saat ini sudah sangat solid, memiliki UI modern berbasis web (

style.css
), dan siap dikembangkan lebih lanjut.
Saran Langkah Pengerjaan Berikutnya
Jika Anda ingin mulai menerapkan isi dokumen plan tersebut ke project ini, urutan pengerjaan yang paling efektif adalah:

Langkah 1 (Keamanan & Pembersihan): Bersihkan file usang, perbaiki rate-limit guard di 

discord.js
, dan tambahkan lyrics cache di 

lyrics.js
.
Langkah 2 (Pilihan Mode RPC / Custom Status): Sambungkan data lirik ke 

activitystatus.js
 agar pengguna punya opsi mode aman (Rich Presence).
Langkah 3 (OS Media Listener): Implementasikan pembaca media Windows (SMTC) agar tidak lagi wajib menggunakan Spicetify.
Langkah 4 (Polish UI/UX): Tambahkan slider offset, system tray, dan enkripsi token.
Bagian mana yang ingin Anda prioritaskan untuk kita kerjakan terlebih dahulu?