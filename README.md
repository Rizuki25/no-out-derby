# No-Out Derby (Futsal Pantul)

Game **2D Pixel Arcade Futsal** berkecepatan tinggi di arena oktagon tertutup — **tanpa garis keluar (*out*), tanpa pelanggaran (*foul*), dan tanpa henti.** Dibangun dari nol menggunakan **TypeScript**, **HTML5 Canvas (`480x270` pixel-perfect)**, dan **Web Audio API** (chiptune retro BGM + SFX prosedural) tanpa aset eksternal atau dependensi runtime tambahan.

> Dokumentasi lengkap peraturan, seluruh mode, kontrol detail, mekanisme fisika, dan tips bermain dapat dibaca di [`game.prd`](./game.prd).

---

## Fitur Utama

- **16 Mode Permainan + Online P2P Multiplayer (`[O]`):**
  - **Online Multiplayer P2P (WebRTC + Vercel Signaling):** Bermain jarak jauh lewat kode room 4 karakter atau link undangan `?room=XXXX` (`1v1/2v2/3v3/4v4 Versus` & `2v2/3v3/4v4 Co-op`). Menggunakan arsitektur *Host-Authoritative 60Hz* di atas **dual WebRTC DataChannel** (*unreliable* untuk snapshot/input latensi rendah + interpolasi Guest, serta *reliable* untuk ping & kontrol room) dengan pertukaran sinyal ringan di `/api/rooms`.
  - **Quick Match & Versus:** `1v1 vs AI`, `2v2 vs AI`, `3v3 (GK+2) vs AI`, `4v4 (GK+3) vs AI (Stadium XL)`, `2P 1v1 Versus`, `2P 2v2 Versus`, `2P 3v3 Versus`, `2P 4v4 Versus`, `2P 2v2 Co-op`, `2P 3v3 Co-op`, dan `2P 4v4 Co-op`.
  - **Derby Cup Tournament (`1v1`, `2v2`, `3v3`, `4v4`):** Turnamen 3 babak (*Quarter Final* → *Semi Final* → *Grand Final*) dengan sistem pemilihan **Perk** permanen antarrbabak (`Turbo Boots`, `Iron Leg`, `Quick Dash`, `Banana Curve`, `Steel Body`, `Magnet Touch`).
  - **Practice / Chaos Sandbox:** Mode latihan bebas tanpa batas waktu dengan tombol pemicu mutator instan (`1`–`6`, `0`), umpan silang *One-Timer* instan (`F`), reset bola (`B`), dan toggle bek AI sparring (`T`).
- **2 Gaya Kontrol Bola (`BALL CTRL`):**
  - **`Dribble + Tackle`:** Sentuh bola untuk menggiring di kaki + *Dash-Tackle* untuk membuat lawan stun dan mencuri penguasaan bola (`STEAL!`).
  - **`Classic (Bounce)`:** Kontrol pantul pinball arkade murni pada setiap sentuhan.
- **Mekanisme Aksi & Game Feel:**
  - **Power Shot Charge (Roket Penuh) & Banana Curve:** Tahan tombol *Kick* untuk mengisi daya hingga penuh untuk melesatkan tembakan roket berkecepatan tinggi (`455 px/s`, One-Timer hingga `515 px/s`), atau gerakkan ke samping saat melepas untuk tembakan melengkung (*Magnus spin*).
  - **Panah Arah Tembakan & Indikator Umpan:** Saat menggiring atau menahan daya tendang, panah bidik menunjukkan lintasan tembakan (berubah **emas + titik bidik** saat mengunci gawang), sementara **cincin bidik cyan** otomatis menandai rekan tim yang akan menerima umpan.
  - **Smart Teammate Pass & Give-and-Go (`[E]` / Gamepad `X` / Mobile `PASS`):** Mengirim umpan terarah akurat ke kaki/ruang lari rekan tim (tanpa dibelokkan ke arah gawang), langsung memberi dorongan lari ke depan (*Give-and-Go*) untuk kombinasi *1-2*, dan didukung AI rekan yang aktif mengumpan di 3v3/4v4.
  - **Skill Dribble / Body Feint (*Step-Over*):** Menekan tombol *Dash* saat sedang menggiring bola di mode `Dribble + Tackle` memicu gerak *sidestep* kelit cepat dengan bola tetap menempel di kaki — mampu mengecoh *Dash-Tackle* lawan (`ANKLE BREAKER!`) dan membuat penjegel kehilangan keseimbangan sesaat.
  - **Fever Blitz & Super Strike (`[C]` / Gamepad `RB` / Mobile `FEVER`):** Bar Fever (`0–100%`) di HUD atas terisi dari umpan, tembakan, *feint dodge*, tekel curi bola, *save* kiper, maupun bonus *comeback* saat kebobolan. Saat 100%, aktifkan **Fever Mode (4.5 detik)** untuk kecepatan +20%, *Dash* 45% lebih cepat, daya tembak +18%, serta tendangan berjejak api **FEVER STRIKE!** yang lebih kencang dari batas normal.
  - **Quick Team Tactics (`[Tab]` / `[1]`–`[3]` / Gamepad `LB` / Mobile `TAC`):** Ubah instruksi rekan bot di mode `2v2`/`3v3`/`4v4` kapan saja di tengah laga antara **`BALANCED`**, **`ATTACK+`** (pressing tinggi & *overlap* sayap), dan **`DEFEND+`** (garis blok belakang rapat).
  - **Fokus 1 Pemain & Rekan Bot Cerdas (Tanpa Auto-Switch):** Di mode `2v2`/`3v3`/`4v4`, kendali user tetap fokus pada 1 pemain (tidak berpindah otomatis secara mengejutkan), sementara rekan bot aktif membantu menutup pertahanan, mengejar lawan, mengisi dua jalur sayap/gelandang berbeda di `4v4`, dan mengirim umpan ke depan (switch manual `[Q]` tetap tersedia bila diinginkan).
  - **One-Timer / Volley Shot:** Ayunkan tendangan tepat saat umpan cepat atau pantulan mengarah ke pemain untuk tembakan super cepat dengan jejak cyan-emas dan *hitstop*.
  - **Golden Goal Overtime & Instant Replay:** Seri saat `00:00` otomatis masuk babak *Golden Goal*; gol spektakuler memutar ulang 3 detik terakhir (180 frame @ 60Hz) bergaya siaran retro (`REC / REPLAY`).
  - **Floating Callouts:** Teks piksel di lapangan untuk momen `FEVER STRIKE!`, `ANKLE BREAKER!`, `TEAM FEVER!`, `ONE-TIMER!`, `BANK SHOT!`, `TOP BIN!`, `ROCKET!`, `GREAT SAVE!`, `CLANG!`, dan `STEAL!`.
- **3 Variasi Arena, 3 Pilihan Luas Lapangan & 6 Chaos Mutators:**
  - Arena **Classic Stadium**, **Concrete Alley** (lapangan sempit, pantulan keras), dan **Rooftop Night** (angin samping dinamis).
  - Pilihan **`PITCH SIZE`** untuk semua mode (`Standard`, `Large 1.8x`, `Stadium XL 2.7x`, dan otomatis terkunci ke **Stadium XL** khusus seluruh mode **4v4** agar 8 pemain leluasa bergerak), lengkap dengan kamera pengikut halus (*smooth follow camera*), penskalaan gawang proporsional, serta indikator *off-screen* untuk `P1`/`P2`/bola ekstra.
  - Mutator **Giant Ball**, **Slippery Pitch**, **Pinball Mode (114%)**, **Hot Potato (6s explosion)**, **Wide Goals (1.6x)**, dan **Double Trouble (2 Balls)**.
- **Kustomisasi Kit Klub & Progresi Lokal:**
  - 6 preset jersey kontras tinggi (`Garuda Red`, `Cyber Blue`, `Tarkam Gold`, `Shadow Violet`, `Lime Street`, `Sunset Flare`) yang otomatis mencegah tabrakan warna antar tim.
  - **Career Records** & penyimpanan preferensi otomatis di `localStorage`, dilengkapi layar **How To Play (`[H]`)** dan **Records (`[R]`)** langsung di dalam game.
- **Dukungan Multi-Input, Controller Eksternal (USB/Bluetooth) & Mode Mobile (`[V]` & `[F]`):**
  - **Controller / Joystick Eksternal (*Plug-and-Play* + *Haptic Rumble*):** Mendukung controller **Xbox, PlayStation, Switch Pro, Logitech, Gamesir, maupun Gamepad USB/Bluetooth generik** untuk P1 & P2. Colok atau *pair* Bluetooth lalu tekan tombol apa saja di joystick: status & toast notifikasi otomatis tampil, navigasi menu bisa lewat Stick Kiri/D-Pad, dilengkapi **deadzone radial 360° halus** + **throttle kecepatan analog proporsional** + traksi belokan responsif (bebas rasa kaku saat menggiring), dukungan **trigger analog (`RT`/`LT`)**, fallback **POV hat DirectInput**, **getaran *dual-rumble*** saat tendangan keras/tekel/gol, dan penyembunyian otomatis kontrol sentuh saat controller aktif di HP (`VIEW: AUTO`).
  - **Keyboard (1P & 2P lokal) & Mobile Handheld View** siap main online di smartphone maupun testing di desktop (`[V]` di Main Menu / `MOBILE PAD` di Pause).
  - **Fullscreen Web & Mobile Edge-to-Edge (`[F]`):** Tombol **Fullscreen** tersedia langsung di **Main Menu** (bar sentuh bawah `[ ] FULLSCREEN MODE` + pill kanan atas `[F] FULLSCREEN`), **Pause Menu**, serta **Utility Bar (`[ ] FULL`)** saat bertanding. Mendukung native `Fullscreen API` + kunci orientasi Landscape otomatis di mobile, *fallback immersive viewport* (iOS Safari), penskalaan 100% *edge-to-edge*, serta dukungan PWA `manifest.webmanifest` (`display: fullscreen`).
  - **Adaptif Portrait & Landscape:** Di orientasi Portrait, menu & lapangan mengisi 100% lebar atas layar sementara saat bertanding bagian bawah menjadi dek kontroler khusus (zero overlap!); di Landscape kontrol melayang transparan mengikuti *safe-area*.
  - **Joystick & Tombol Khusus Mobile:** Analog Joystick 360°, tombol **`KICK`** (dengan indikator pengisian daya langsung), **`TACKLE` / `DASH`** dinamis, **`SWITCH`** (2v2/3v3/4v4), tombol utilitas (`PAUSE`, `SFX`, `VIEW`, `[ ] FULL`, `SKIP REPLAY >>`), serta bar Sandbox instan (`FEED`, `BALL`, `AI BEK`, `M1`–`M6`, `CLR`).

---

## Ringkasan Kontrol

| Aksi | Player 1 (Solo) | Player 1 (2P) | Player 2 (2P) |
| :--- | :--- | :--- | :--- |
| **Gerak** | `WASD` / `Panah` | `WASD` | `Panah` |
| **Kick / Hold Power** | `Space` / `J` / `Enter` | `Space` / `J` | `Enter` / `Numpad 1` |
| **Dash / Tackle / Skill Feint** | `Shift` / `K` | `Left Shift` / `K` | `Right Ctrl` / `Right Shift` / `Numpad 2` |
| **Smart Pass (Give-and-Go)** | `E` / `U` | `E` / `U` | `.` / `Numpad 3` |
| **Fever Blitz (Saat 100%)** | `C` / `R` | `C` / `R` | `\` / `Numpad .` |
| **Quick Tactics (2v2–4v4)** | `Tab` / `1`–`3` | `Tab` / `1`–`3` | `O` / `]` |
| **Switch Pemain (2v2–4v4)** | `Q` / `L` | `Q` / `L` | `Numpad 0` / `/` |

- **Gamepad Eksternal (`L-Stick` / `D-Pad` Gerak):** `A`/`RT` = Kick (Hold), `B`/`LT` = Dash/Tackle/Feint, `X` = Smart Pass, `Y` = Switch, `LB` = Taktik (`Bal`/`Atk`/`Def`), `RB` = Fever Blitz!, `Start` = Pause.

- **Utilitas:** `O` (Lobby Online P2P di Main Menu), `F` (Toggle Fullscreen di Menu/Pause/Full Time), `V` (Switch View: `AUTO`/`MOBILE`/`PC`), `H` (Guide), `R` (Career Records), `M` (Mute SFX/BGM), `Esc` / `P` (Pause), `Space` (Skip Replay).
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

Repositori sudah dilengkapi [`vercel.json`](./vercel.json) (preset Vite -> build `npm run build`, output `dist/`) serta Vercel Serverless Function [`api/rooms.ts`](./api/rooms.ts) untuk *signaling* WebRTC (`GET/POST /api/rooms`):

1. Push repo ke GitHub.
2. Buka [Vercel](https://vercel.com), klik **Add New Project**, lalu import repo `no-out-derby` (Build Command `npm run build`, Output Directory `dist`).
3. **Untuk mengaktifkan Online P2P Multiplayer (`ONLINE P2P [O]`):** Buka tab **Storage / Integrations** di proyek Vercel, pasang **Upstash Redis** agar variabel lingkungan `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` (atau `KV_REST_API_URL` & `KV_REST_API_TOKEN`) terisi otomatis lalu redeploy. *(Jika Redis belum terpasang, `/api/rooms` mengembalikan HTTP `503 REDIS_NOT_CONFIGURED`; selama `npm run dev` lokal, middleware Vite otomatis menyediakan room store sementara.)*
4. Buka URL `.vercel.app` dari PC atau HP (mode **Mobile Pad** aktif otomatis lewat `VIEW: AUTO`), atau uji link undangan langsung dengan `?room=XXXX`.

---

## Struktur Proyek

```text
no-out-derby/
├── api/
│   └── rooms.ts                # Vercel Serverless Function untuk WebRTC signaling (Upstash Redis)
├── index.html                  # Canvas container, Online Modal, Mobile Deck UI & Fullscreen Bar
├── public/
│   └── manifest.webmanifest    # Konfigurasi PWA fullscreen untuk browser mobile
├── game.prd                    # Panduan pemain lengkap, aturan, mode & PRD teknis
├── package.json
├── tsconfig.json
├── vercel.json                 # Konfigurasi build & output untuk deploy Vercel
├── vite.config.ts              # Vite config + dev-only middleware /api/rooms
└── src/
    ├── main.ts                 # Entry point, loop utama, Online/Offline routing & hotkeys
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
    │   ├── MatchState.ts       # State machine pertandingan, Golden Goal, stats & snapshot sync
    │   ├── MobileLayout.ts     # Deteksi mode mobile, ukuran canvas Portrait/Landscape & HUD state
    │   └── MutatorManager.ts   # Penjadwalan & efek 6 Chaos Mutators
    ├── net/
    │   ├── NetSnapshot.ts      # Edge-counter input decoder, snapshot builder & Guest interpolator
    │   ├── OnlineLobbyUI.ts    # Modal UI Host/Join Online Room & tautan undangan ?room=XXXX
    │   ├── OnlineSession.ts    # Koordinator WebRTC Host-Authoritative 60Hz & sinkronisasi Guest
    │   ├── SignalingHandler.ts # Router/validator signaling GET/POST room & TTL 180s
    │   ├── SignalingTypes.ts   # Tipe room, mode online, kode 4-karakter & DTO signaling
    │   ├── UpstashRoomStore.ts # Adapter atomik Upstash Redis untuk penyimpanan room sementara
    │   └── WebRtcPeer.ts       # Wrapper RTCPeerConnection, trickle ICE, dual DataChannel & RTT
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
        ├── bugfixes.test.ts
        ├── dribble_and_3v3.test.ts
        ├── gameplay_actions.test.ts
        ├── gamefeel_and_kits.test.ts
        ├── match.test.ts
        ├── mobile_layout.test.ts
        ├── mutator.test.ts
        ├── net_snapshot.test.ts
        ├── phase3.test.ts
        ├── physics.test.ts
        ├── pitch_size.test.ts
        ├── progression_and_sandbox.test.ts
        └── signaling.test.ts
```

---

## Teknologi

- [TypeScript](https://www.typescriptlang.org/) (`^5.7.2`) — Strict mode (`ES2022`)
- [Vite](https://vite.dev/) (`^6.0.7`) — Dev server & production bundler
- [Vitest](https://vitest.dev/) (`^2.1.8`) — Automated testing framework (`npm test`)
- **WebRTC DataChannel & [`@upstash/redis`](https://upstash.com/)** — Online P2P *host-authoritative* 60Hz dengan signaling serverless di Vercel
- **HTML5 Canvas 2D & Web Audio API** — Rendering pixel-art & audio prosedural tanpa aset eksternal
