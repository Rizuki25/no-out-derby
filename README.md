# No-Out Derby (Futsal Pantul)

Game **2D Pixel Arcade Futsal** berkecepatan tinggi di arena oktagon tertutup — **tanpa garis keluar (*out*), tanpa pelanggaran (*foul*), dan tanpa henti.** Dibangun dari nol menggunakan **TypeScript**, **HTML5 Canvas (`480x270` pixel-perfect)**, dan **Web Audio API** (chiptune retro BGM + SFX prosedural) tanpa aset eksternal atau dependensi runtime tambahan.

> Dokumentasi lengkap peraturan, seluruh mode, kontrol detail, mekanisme fisika, dan tips bermain dapat dibaca di [`game.prd`](./game.prd).

---

## Fitur Utama

- **12 Mode Permainan:**
  - **Quick Match & Versus:** `1v1 vs AI`, `2v2 vs AI`, `3v3 (GK+2) vs AI`, `2P 1v1 Versus`, `2P 2v2 Versus`, `2P 3v3 Versus`, `2P 2v2 Co-op`, dan `2P 3v3 Co-op`.
  - **Derby Cup Tournament (`1v1`, `2v2`, `3v3`):** Turnamen 3 babak (*Quarter Final* → *Semi Final* → *Grand Final*) dengan sistem pemilihan **Perk** permanen antarrbabak (`Turbo Boots`, `Iron Leg`, `Quick Dash`, `Banana Curve`, `Steel Body`, `Magnet Touch`).
  - **Practice / Chaos Sandbox:** Mode latihan bebas tanpa batas waktu dengan tombol pemicu mutator instan (`1`–`6`, `0`), umpan silang *One-Timer* instan (`F`), reset bola (`B`), dan toggle bek AI sparring (`T`).
- **2 Gaya Kontrol Bola (`BALL CTRL`):**
  - **`Dribble + Tackle`:** Sentuh bola untuk menggiring di kaki + *Dash-Tackle* untuk membuat lawan stun dan mencuri penguasaan bola (`STEAL!`).
  - **`Classic (Bounce)`:** Kontrol pantul pinball arkade murni pada setiap sentuhan.
- **Mekanisme Aksi & Game Feel:**
  - **Power Shot Charge (Roket Penuh) & Banana Curve:** Tahan tombol *Kick* untuk mengisi daya hingga penuh untuk melesatkan tembakan roket berkecepatan tinggi (`455 px/s`, One-Timer hingga `515 px/s`), atau gerakkan ke samping saat melepas untuk tembakan melengkung (*Magnus spin*).
  - **Fokus 1 Pemain & Rekan Bot Cerdas (Tanpa Auto-Switch):** Di mode `2v2`/`3v3`, kendali user tetap fokus pada 1 pemain (tidak berpindah otomatis secara mengejutkan), sementara rekan bot aktif membantu menutup pertahanan, mengejar lawan, membuka ruang sayap saat menyerang, dan mengirim umpan ke depan (switch manual `[Q]` tetap tersedia bila diinginkan).
  - **One-Timer / Volley Shot:** Ayunkan tendangan tepat saat umpan cepat atau pantulan mengarah ke pemain untuk tembakan super cepat dengan jejak cyan-emas dan *hitstop*.
  - **Golden Goal Overtime & Instant Replay:** Seri saat `00:00` otomatis masuk babak *Golden Goal*; gol spektakuler memutar ulang 3 detik terakhir (180 frame @ 60Hz) bergaya siaran retro (`REC / REPLAY`).
  - **Floating Callouts:** Teks piksel di lapangan untuk momen `ONE-TIMER!`, `BANK SHOT!`, `TOP BIN!`, `ROCKET!`, `GREAT SAVE!`, `CLANG!`, dan `STEAL!`.
- **3 Variasi Arena, 3 Pilihan Luas Lapangan & 6 Chaos Mutators:**
  - Arena **Classic Stadium**, **Concrete Alley** (lapangan sempit, pantulan keras), dan **Rooftop Night** (angin samping dinamis).
  - Pilihan **`PITCH SIZE`** untuk semua mode (termasuk Derby Cup & Sandbox): **`Standard (Default)`** (ukuran asli tetap utuh, kamera statis), **`Large (1.8x Area)`**, dan **`Stadium XL (2.7x)`** lengkap dengan kamera pengikut halus (*smooth follow camera*), penskalaan gawang proporsional, serta indikator *off-screen* untuk `P1`/`P2`/bola ekstra.
  - Mutator **Giant Ball**, **Slippery Pitch**, **Pinball Mode (114%)**, **Hot Potato (6s explosion)**, **Wide Goals (1.6x)**, dan **Double Trouble (2 Balls)**.
- **Kustomisasi Kit Klub & Progresi Lokal:**
  - 6 preset jersey kontras tinggi (`Garuda Red`, `Cyber Blue`, `Tarkam Gold`, `Shadow Violet`, `Lime Street`, `Sunset Flare`) yang otomatis mencegah tabrakan warna antar tim.
  - **Career Records** & penyimpanan preferensi otomatis di `localStorage`, dilengkapi layar **How To Play (`[H]`)** dan **Records (`[R]`)** langsung di dalam game.
- **Dukungan Multi-Input & Mode Tampilan Mobile (`[V] PAD: AUTO / MOBILE / PC` & `[F] FULLSCREEN`):**
  - **Keyboard (1P & 2P lokal)**, **Gamepad API**, dan **Mobile Handheld View** siap main online di smartphone maupun testing di desktop (`[V]` di Main Menu / `MOBILE PAD` di Pause).
  - **Fullscreen Web & Mobile Edge-to-Edge (`[F]`):** Tombol **Fullscreen** tersedia langsung di **Main Menu** (bar sentuh bawah `[ ] FULLSCREEN MODE` + pill kanan atas `[F] FULLSCREEN`), **Pause Menu**, serta **Utility Bar (`[ ] FULL`)** saat bertanding. Mendukung native `Fullscreen API` + kunci orientasi Landscape otomatis di mobile, *fallback immersive viewport* (iOS Safari), penskalaan 100% *edge-to-edge*, serta dukungan PWA `manifest.webmanifest` (`display: fullscreen`).
  - **Adaptif Portrait & Landscape:** Di orientasi Portrait, menu & lapangan mengisi 100% lebar atas layar sementara saat bertanding bagian bawah menjadi dek kontroler khusus (zero overlap!); di Landscape kontrol melayang transparan mengikuti *safe-area*.
  - **Joystick & Tombol Khusus Mobile:** Analog Joystick 360°, tombol **`KICK`** (dengan indikator pengisian daya langsung), **`TACKLE` / `DASH`** dinamis, **`SWITCH`** (2v2/3v3), tombol utilitas (`PAUSE`, `SFX`, `VIEW`, `[ ] FULL`, `SKIP REPLAY >>`), serta bar Sandbox instan (`FEED`, `BALL`, `AI BEK`, `M1`–`M6`, `CLR`).

---

## Ringkasan Kontrol

| Aksi | Player 1 (Solo) | Player 1 (2P) | Player 2 (2P) |
| :--- | :--- | :--- | :--- |
| **Gerak** | `WASD` / `Panah` | `WASD` | `Panah` |
| **Kick / Hold Power** | `Space` / `J` / `Enter` | `Space` / `J` | `Enter` / `Numpad 1` |
| **Dash / Tackle / Steal** | `Shift` / `K` | `Left Shift` / `K` | `Right Ctrl` / `Right Shift` / `Numpad 2` |
| **Switch Pemain (2v2 / 3v3)** | `Q` / `L` | `Q` / `L` | `Numpad 0` / `/` |

- **Utilitas:** `F` (Toggle Fullscreen di Menu/Pause/Full Time), `V` (Switch View: `AUTO`/`MOBILE`/`PC`), `H` (Guide), `R` (Career Records), `M` (Mute SFX/BGM), `Esc` / `P` (Pause), `Space` (Skip Replay).
- **Practice Sandbox:** `1`–`6` (Toggle Mutator), `0` (Clear Mutator), `F` (Feed Pass Volley), `B` (Reset Ball), `T` (Toggle Defender AI).

---

## Persyaratan & Cara Menjalankan

Pastikan sudah terpasang **Node.js** (disarankan v18+) dan **npm**.

```bash
# 1. Clone repositori
git clone <url-repo-anda>
cd no-out-derby

# 2. Install dependencies
npm install

# 3. Jalankan development server
npm run dev
```

### Skrip Tersedia (`package.json`)

| Perintah | Deskripsi |
| :--- | :--- |
| `npm run dev` | Menjalankan server pengembangan Vite dengan HMR. |
| `npm run build` | Mengecek tipe TypeScript (`tsc --noEmit`) lalu mem-build bundle produksi ke `dist/`. |
| `npm run preview` | Menjalankan server preview lokal dari hasil build `dist/`. |
| `npm test` | Menjalankan seluruh unit & integration test sekali jalan dengan Vitest (`vitest run`). |
| `npm run test:watch` | Menjalankan Vitest dalam mode watch saat pengembangan. |

---

## Deploy ke Vercel

Repositori sudah dilengkapi [`vercel.json`](./vercel.json) (preset Vite -> build `npm run build`, output `dist/`):

1. Push repo ke GitHub.
2. Buka [Vercel](https://vercel.com), klik **Add New Project**, lalu import repo `no-out-derby`.
3. Pastikan Build Command `npm run build` dan Output Directory `dist` (otomatis terdeteksi), lalu klik **Deploy**.
4. Buka URL `.vercel.app` dari HP (mode **Mobile Pad** aktif otomatis lewat `VIEW: AUTO`) atau uji langsung dari browser PC dengan menekan **`V`** / klik pill **`[V] PAD:AUTO`** di Main Menu!

---

## Struktur Proyek

```text
no-out-derby/
├── index.html                  # Canvas container, Mobile Deck UI & Menu Fullscreen Bar
├── public/
│   └── manifest.webmanifest    # Konfigurasi PWA fullscreen untuk browser mobile
├── game.prd                    # Panduan pemain lengkap, aturan, mode & PRD teknis
├── package.json
├── tsconfig.json
├── vercel.json                 # Konfigurasi build & output untuk deploy Vercel
├── vite.config.ts
└── src/
    ├── main.ts                 # Entry point, loop utama, binding UI & Sandbox hotkeys
    ├── types.ts                # Tipe inti entitas, arena, mutator, kit, stats & event
    ├── audio/
    │   └── SoundEngine.ts      # Web Audio synthesizer untuk BGM chiptune & SFX prosedural
    ├── engine/
    │   ├── ArenaGeometry.ts    # Segmen dinding oktagon 45°, tiang gawang & anti-tunneling clamp
    │   ├── ArenaPresets.ts     # Konfigurasi Arena & 3 Luas Lapangan (Standard / Large / XL)
    │   ├── GameLoop.ts         # Fixed-timestep 60Hz loop + hitstop & slow-motion
    │   ├── PhysicsEngine.ts    # Sub-stepped 2D physics, dribble/tackle, curve & one-timer
    │   └── ReplayBuffer.ts     # Ring buffer 180 frame (3 detik) untuk Instant Replay
    ├── game/
    │   ├── AIController.ts     # AI Outfield & Kiper untuk 3 tingkat kesulitan (Rookie/Pro/Tarkam)
    │   ├── CareerRecords.ts    # Penyimpanan statistik karier & preferensi di localStorage
    │   ├── DerbyCup.ts         # Progression turnamen 3 babak & sistem 6 Perk
    │   ├── Fullscreen.ts       # Helper Fullscreen API, lock landscape & fallback iOS viewport
    │   ├── InputManager.ts     # Input keyboard, Gamepad API & Multi-Touch / Pointer Joystick
    │   ├── MatchState.ts       # State machine pertandingan, Golden Goal, stats & Sandbox logic
    │   ├── MobileLayout.ts     # Deteksi mode mobile, ukuran canvas Portrait/Landscape & HUD state
    │   └── MutatorManager.ts   # Penjadwalan & efek 6 Chaos Mutators
    ├── render/
    │   ├── Palette.ts          # Palet warna piksel retro
    │   ├── ParticleSystem.ts   # Partikel debu, jejak tendangan, save/steal sparks & konfeti
    │   ├── PixelFont.ts        # Bitmap font 5x7 crisp tanpa anti-aliasing
    │   ├── PixelSprites.ts     # Renderer karakter animasi, bola berputar & ikon mutator
    │   ├── Renderer.ts         # Renderer lapangan, kamera dinamis, bayangan, callouts & replay
    │   ├── TeamKits.ts         # 6 preset kit tim beserta logika pencegah tabrakan warna
    │   └── UIRenderer.ts       # Main Menu, HUD, Pause, Replay, Records, Guide & Derby Cup UI
    └── tests/
        ├── ai.test.ts
        ├── dribble_and_3v3.test.ts
        ├── gamefeel_and_kits.test.ts
        ├── match.test.ts
        ├── mobile_layout.test.ts
        ├── mutator.test.ts
        ├── phase3.test.ts
        ├── physics.test.ts
        ├── pitch_size.test.ts
        └── progression_and_sandbox.test.ts
```

---

## Teknologi

- [TypeScript](https://www.typescriptlang.org/) (`^5.7.2`) — Strict mode (`ES2022`)
- [Vite](https://vite.dev/) (`^6.0.7`) — Dev server & production bundler
- [Vitest](https://vitest.dev/) (`^2.1.8`) — Automated testing framework (10 test files, 42 tests)
- **HTML5 Canvas 2D & Web Audio API** — Nol dependensi runtime eksternal
# no-out-derby
