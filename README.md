# Flappy Friends 3D

Game browser 3D dengan mode sendiri dan sesi bersama hingga 8 pemain. Pemain yang membuat sesi menjadi host dan dapat memulai kapan saja, termasuk saat masih sendirian. Peserta masuk dengan nama dan kode sesi 5 karakter atau tautan undangan. Tersedia level **Normal** dan **Hard**; Hard mempercepat pipa, merapatkan jaraknya, dan mempersempit celah. Pada mode bersama, host memilih level di lobby dan semua peserta memakai level yang sama. Sebelum hitung mundur, setiap perangkat menyiapkan tampilan dan memberi sinyal siap agar pemain tidak langsung gugur saat game mulai. Setelah semua pemain gugur, host dapat memulai ronde baru tanpa membuat sesi atau membagikan kode lagi. Rekor lokal disimpan terpisah per level.

Jika ada minimal dua pemain, item power-up ×3 dan ×5 muncul bergantian di antara deret pipa. Item langsung aktif saat diambil. Selama 4 detik, pemain lain harus mengetuk cepat 3 atau 5 kali dalam 1,1 detik untuk satu kepakan. Pemilik item tidak terkena efek itemnya sendiri.

## Jalankan

Butuh Node.js 18+ untuk mode bersama. Tidak ada paket npm atau proses build.

```sh
node server.js
```

Buka `http://localhost:3000`. Port dapat diubah dengan `PORT=8080 node server.js`. Mode sendiri juga bisa dimainkan dengan membuka `index.html` langsung, selama CDN Three.js dapat diakses.

## Pemasangan

Langkah umum untuk memasang game di server:

1. Salin `index.html` dan `server.js` ke direktori aplikasi.
2. Jalankan `node server.js` sebagai layanan yang terus hidup. Server mendengarkan di `0.0.0.0:3000` secara default.
3. Arahkan domain dengan reverse proxy HTTPS ke port 3000. Pastikan proxy meneruskan koneksi WebSocket di `/ws` (`Upgrade` dan `Connection` headers).
4. Buka situs dari perangkat yang berbeda dan bagikan kode/tautan sesi.

Room bersifat sementara dan hilang ketika server dimulai ulang. Satu proses server menangani seluruh pemain; jika memakai lebih dari satu proses, perlu penyimpanan room bersama dan sticky sessions. Skor terbaik setiap browser disimpan lewat `localStorage`.
