# Ninja Saga Mission Bot

Extension Chrome lokal (tanpa AI, tanpa token) yang mengulang misi Grade A
**The Fire-Thunder Alliance** secara otomatis.

## Pasang

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (kanan atas)
3. Klik **Load unpacked**, pilih folder `~/ninja-saga-bot`
4. Buka / reload `https://ninjasaga.cc/play`, login, tunggu desa tampil
5. Panel **Ninja Saga Bot** muncul di kanan bawah: klik **Start** atau tekan `Alt+S`

## Hot reload (development)

```
node ~/ninja-saga-bot/dev-server.js
```

Server di `127.0.0.1:8777` memantau file. Background extension mengecek tiap 2 detik:

| File berubah | Yang terjadi |
|---|---|
| `bot.js` | Disuntikkan langsung ke tab game; game tidak reload, hitungan misi & kunci chakra diwarisi |
| `hook.js` | Panel menampilkan pemberitahuan; perlu reload halaman di antara misi |
| `manifest.json`, `background.js`, `poller.js` | Extension reload sendiri lalu menyuntik ulang bot ke tab |

Tanpa server, extension berjalan normal; hot reload saja yang tidak aktif.

### Server otomatis saat Start (Native Messaging)

Daftarkan sekali (perlu dijalankan sendiri):

```
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
cp ~/ninja-saga-bot/com.billy.nsbot.json ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
```

Setelah itu Start di panel membuat Chrome menjalankan `native-host.js` (server
hot reload), dan Stop mematikannya. Jika ID extension berubah (misalnya folder
dipindah), sesuaikan `allowed_origins` di `com.billy.nsbot.json`.

## Cara kerja

Bot membaca piksel canvas game (Ruffle) dan mengenali layar:

| Layar | Tanda | Aksi |
|---|---|---|
| Giliran kita | tombol Run biru + Dodge oranye | pilih jurus, klik musuh |
| Battle (giliran musuh / berjalan) | timeline ungu atau bar Goal kuning | tunggu |
| Dialog cerita | bar hitam atas & bawah | klik |
| Victory / Mission Success / mulai misi | gumpalan hijau checkmark | klik checkmark |
| Desa | emblem rank ungu di atas | Mission Room > Grade A > hal. 2 > Fire-Thunder > check |
| Popup tutorial / panel (Shop, dll.) | tombol X merah kecil berisi silang putih | klik X (tombol hijau "Go to Academy" sengaja tidak diklik) |
| Peta misi (area bergulir) | panah oranye "Go!" kanan/kiri | selama masih ada karakter di area, klik karakter terbesar dulu (musuh); "Go!" baru diklik bila tidak ada musuh tersisa. Karakter yang diklik tapi tidak memicu battle = pemain: warnanya diingat dan dilewati berikutnya |
| Cutscene "klik musuh" | tidak dikenali > 0,6 dtk | klik karakter yang terdeteksi (maks. 3), baru sapu klik grid bila tidak ada |

### Patch memori (pengganti MacCheat)

`hook.js` berjalan di iframe `/emulator` sebelum Ruffle dimuat dan menangkap
`WebAssembly.Memory` milik Ruffle. Setiap kali bot berada di desa (artinya
karakter sudah dipilih) untuk pertama kalinya, sebelum membuka Mission Room,
bot memindai memori
untuk `A2 25 E8 07 A3 A2` lalu mengubah semua hasilnya menjadi
`A2 25 E8 07 A9 A2`. Jika tidak ada hasil (dan belum pernah di-patch), bot
mencoba ulang hingga 20 kali lalu berhenti dengan pesan di panel.

Patch hanya dilakukan sekali per sesi halaman. Reload atau login ulang membuat
Ruffle memakai memori baru, sehingga patch otomatis dijalankan lagi.

Hook hanya bekerja jika extension sudah aktif **sebelum** halaman game dimuat,
jadi setelah memasang/memperbarui extension selalu reload halaman game.

### Pengaturan (panel > Pengaturan)

| Opsi | Default | Keterangan |
|---|---|---|
| Slot karakter | 1 | Kartu di layar pilih karakter (1-2 baris atas, 3-4 tengah, 5-6 bawah). Sesuaikan saat ganti karakter: dipakai saat login ulang setelah reload pemulihan |
| Level saat ini | 0 | Diisi sekali; naik sendiri tiap layar Level Up. 0 = fitur berhenti-di-level nonaktif |
| Target level | 0 | Level tujuan untuk perkiraan di Progres; bot berhenti di desa saat tercapai. 0 = level berhenti berikutnya |
| Berhenti di level | 20,40,60,80,100 | Bot berhenti di desa saat level ujian rank tercapai |
| Auto misi XP tertinggi | on | Pindai Grade A→B→C, ambil baris terbuka terakhir sebelum gembok; pindai ulang tiap Start, tiap level up, dan bila slot/level di pengaturan berubah |
| Grade misi | A | Tombol Grade di Mission Room (A/B/C) |
| Halaman | 2 | Jumlah klik panah kanan = halaman - 1 |
| Baris | 1 | Misi ke-1/2/3 di halaman itu |
| Urutan slot jurus | 1,8,7,3,6,5,4 | Slot 1-4 kiri, 5-8 kanan tombol Attack; slot yang tidak ditulis dicoba terakhir |
| Slot heal | 2 | Dipakai hanya saat HP < 35%; 0 = tidak ada |
| Mode | Bot otomatis | `Cheat saja`: kamu bermain sendiri, bot hanya memasang cheat yang dicentang (jurus, serangan biasa, chakra) tanpa klik |
| Suara game | off | Suara dibisukan lewat gain 0 (AudioContext tetap jalan karena battle menunggu event suara selesai) |
| Gaya serangan | Basic attack | `Basic attack`: tiap giliran langsung Attack ke musuh (heal tetap saat HP rendah); `Jurus`: pakai urutan slot jurus seperti sebelumnya |
| Cheat serangan biasa | on | Damage tombol Attack = 400000 (`BattleProcessor.setCharacterCommand`: nilai bawaan game untuk ID admin; lompatan `ifnge +6` diubah jadi `+0`). AOB `24 00 0F 06 00 00 2D A6 01 75 63 08` -> `...0F 00 00 00...` |
| Patch memori AOB | on | `A2 25 E8 07 A3 A2` -> `...A9 A2` (AVM2: `÷1000` jadi `|1000` di `calcSkillDamage`) |
| Kunci chakra | on | Chakra ditahan penuh |
| Pulih otomatis | on | Reload + lanjut otomatis saat error/macet |

Pengaturan tersimpan di localStorage dan berlaku pada navigasi misi berikutnya.
Misi yang terkunci (gembok) tidak bisa dimulai; bot akan terus mencoba.

### Pengaman Token

Selama bot berjalan, `hook.js` membaca nama layanan setiap panggilan AMF dan **menolak**
panggilan yang membeli atau memakai Token: `CharacterDAO.buyItem`, `buyPet`, `trainSkill`,
`trainPetSkill`, `instantTrainByToken`, `resetAPbyToken`, `saveResetAP`,
`CharacterService.reviveBattleCharacter`, serta nama lain yang mengandung `.buy`,
`purchase` atau `ByToken`. Saat bot berhenti, pembelian manual tetap normal.

- `localStorage.nsServiceLog`: 80 panggilan server terakhir (nama layanan, bot jalan/tidak)
- `localStorage.nsBlockedCalls`: 50 panggilan yang diblokir

### Panel situs (Store dll.)

Klik liar pada tombol toko di dalam game memanggil `showPanel(...)` milik situs
(lewat ExternalInterface) dan memindahkan tab ke `/store` tanpa reload. Selama bot
berjalan panggilan non-Play diabaikan (dicatat di `window.__nsBlockedPanels`);
klik manual tetap bekerja. Jika URL tetap bergeser, bot mengklik menu PLAY situs
sehingga game kembali tanpa reload.

### Panel hitungan

Baris yang ditampilkan: nama misi + level + XP dasar (dari data game), level -> target,
jumlah misi dijalankan, durasi per misi untuk tiap kecepatan (1x-5x, median), XP per
misi (diukur dari bilah XP, sebelum terukur memakai XP dasar), misi ke level berikutnya
(sudah/total, sisa, waktu), sisa misi dan waktu sampai target.

Di bawah status: misi yang dijalankan, level saat ini -> target (level berhenti berikutnya),
jumlah misi dijalankan dan lama sesi, median menit per misi, rata-rata misi per level
(setelah 2x naik level), sisa misi dan perkiraan waktu sampai target. Data tersimpan di
`localStorage.nsBotStats`; tombol "Reset hitungan misi" di Pengaturan memulai ulang.

### Layar tidak dikenal

Jika bot berada di layar yang tidak dikenalinya lebih dari 3 detik, atau tepat
sebelum reload karena error, gambar kecil layar disimpan di
`localStorage.nsBotUnknownScreens` (3 terakhir, beserta alasan reload dan status bot) untuk dianalisis.

### Kunci chakra

Bot mencari objek karakter di memori (slot chakra diapit dua slot bernilai 100,
HP 32 byte sebelumnya, gold 32 byte sesudahnya; dipilih yang gold-nya terbesar)
lalu menahan chakra di nilai penuh. Charge praktis tidak terpakai.

### Kecepatan

Tombol 1x/2x/3x/5x di panel mempercepat jam game (requestAnimationFrame dan
performance.now di iframe). Pilihan tersimpan. Dengan renderer Canvas, di atas 3x
hasilnya hampir sama karena CPU yang jadi batas (terukur: 3x 125 dtk/misi, 5x 114).

Selama ada panggilan ke server game (setiap `fetch` POST/AMF, apa pun host-nya,
termasuk server `*.b-cdn.net` saat memilih server lain) jam game kembali 1x.
Tanpa ini batas waktu jaringan game ikut dipercepat dan muncul
"Sorry, you have lost connection to the server".

### Pemulihan otomatis

Jika Ruffle error atau tidak ada kemajuan 90 detik, halaman di-reload dengan
tanda lanjut otomatis: bot memilih karakter Billbravo, Play, patch ulang,
kunci chakra ulang, set kecepatan, dan memulai misi baru. Stop mematikan tanda ini.

Cooldown dibaca dari ikon: angka sisa giliran tampil di pojok kanan bawah ikon. Pojok
ikon dicatat saat jurus itu berhasil keluar (pasti siap), lalu ikon yang pojoknya
berbeda dianggap cooldown dan tidak diklik. Bila tidak ada jurus siap: **Attack**
(chakra sudah terkunci penuh, jadi Charge hanya cadangan terakhir).

Nama misi dan XP dasarnya diambil dari tabel `MissionDetail` di `data_library_en.swf`
(urut level, tanpa misi special; tombol Grade A/B/C = grade internal C/D/E).
Kebutuhan XP level: `round(L x 130 x 50^(L/50))` (`Formula.getXpByLv`).

Prioritas jurus mengikuti "Urutan slot jurus". Jurus yang sedang cooldown dilewati
dan dicoba lagi: 2 giliran setelah berhasil dipakai, atau 2/4/8 giliran setelah gagal
keluar. Jadi di pertarungan panjang (bos akhir misi) semua jurus tetap bergiliran.
**Charge** hanya dipakai jika tidak ada satu pun jurus yang keluar pada giliran itu.
**Refresh** hanya dipakai saat HP < 35%.

## Batasan

- Tab game boleh di latar belakang: saat tersembunyi, frame Ruffle dan jeda bot
  digerakkan timer Web Worker (tidak ikut diperlambat Chrome). Jangan masukkan
  ninjasaga.cc ke daftar tab yang dibekukan Memory Saver Chrome.
- Jangan ubah zoom halaman atau ukuran jendela secara drastis saat bot jalan.
- Bot tidak membaca level; hentikan manual (Stop / `Alt+S`) saat level 60.
- Posisi jurus mengikuti urutan slot sekarang. Jika slot jutsu diubah,
  sesuaikan `SKILLS` di `bot.js`.
- Melanggar aturan server soal bot bisa berujung ban akun; risiko ditanggung pemakai.
