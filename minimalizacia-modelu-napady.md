# Minimalizácia modelu - nápady

## Aktuálny stav
- SD Turbo FP16 ONNX (~2 GB) beží v browseri cez onnxruntime-web/webgpu
- Generovanie: 2-6s, img2img + txt2img
- Prvé stiahnutie: ~27 min pri 10 Mbit/s

---

## Možnosti zmenšenia

### 1. INT8/INT4 kvantizácia
- INT8: ~1 GB, INT4: ~500 MB
- Kvalita klesne pre generálny obsah
- **LoRA merged pred kvantizáciou** kompenzuje stratu pre špecifickú doménu (iso budovy)
- Postup: Tréning LoRA → merge do base modelu → kvantizácia → ONNX export

### 2. Pix2Pix (~20-30 MB na model)
- Naučí sa mapovanie vstup → výstup (napr. cube → izometrická budova)
- Jeden forward pass, žiadne iteratívne denoising kroky
- Inference <100ms
- Sťahovanie: ~3s na model
- **Nevýhoda**: žiadny prompt, fixný štýl, potrebné párové tréningové dáta
- **Výhoda**: ultra malý, ultra rýchly, ideálny pre browser

### 3. CycleGAN (~20-30 MB na model)
- Podobné ako Pix2Pix ale nepotrebuje párové dáta
- Stačí 2 sady obrázkov (vstupné + výstupné)
- Deterministický výstup (rovnaký vstup = rovnaký výstup)

### 4. Menšie SD architektúry
- Small Stable Diffusion (~500 MB), Tiny SD (~300 MB)
- Dajú sa fine-tunuť na iso budovy
- Stále ONNX, stále WebGPU

### 5. SD Turbo + LoRA + ControlNet (len backend)
- ControlNet rešpektuje štruktúru vstupu
- LoRA mení štýl
- Prompt dáva kontrolu
- **Háčik**: ControlNet pre WebGPU/ONNX v browseri zatiaľ nemá hotové riešenie

---

## Porovnanie veľkostí

| Model | Veľkosť | Sťahovanie (10 Mbit/s) | Inference | Prompt |
|---|---|---|---|---|
| SD Turbo FP16 (teraz) | ~2 GB | ~27 min | 2-6s | áno |
| SD Turbo INT8 + LoRA | ~1 GB | ~14 min | 2-6s | áno |
| SD Turbo INT4 + LoRA | ~500 MB | ~7 min | 2-6s | áno |
| Pix2Pix (1 štýl) | ~20-30 MB | ~3s | <100ms | nie |
| Pix2Pix (10 štýlov) | ~200-300 MB | ~30s | <100ms | nie |

---

## Rozhodnutie: Pix2Pix vs SD Turbo + LoRA

### SD Turbo INT8 + LoRA je lepšia ak:
- Chceš flexibilitu (prompt kontrola)
- Chceš jeden model na všetko
- Rýchlosť sťahovania nie je priorita
- Chceš kombinácie ("chinese pagoda with factory chimney")

### Pix2Pix je lepšia ak:
- Priorita je veľkosť sťahovania (20MB vs 1GB+)
- Nepotrebuješ prompt
- Lazy loading štýlov (stiahni len čo treba)
- Ultra rýchle generovanie (<100ms)

---

## Pix2Pix pipeline (ak sa rozhodnem)

1. Vygenerovať 100-200 iso budov cez SD backend (dataset)
2. Ku každej vytvoriť zjednodušený vstup (automaticky scriptom - edge detection, color reduction)
3. Tréning Pix2Pix v Pythone (PyTorch, pár hodín na GPU)
4. Export do ONNX (~20-30 MB)
5. Nahrať na HuggingFace
6. Načítať v browseri cez onnxruntime-web/webgpu
7. Vstupný obrázok → model → izometrická budova za <100ms

---

## LoRA + kvantizácia pipeline (ak sa rozhodnem)

1. Nazbierať dataset iso budov (100-500 obrázkov)
2. Natrénovať LoRA (train_lora.py existuje v sd-backend/)
3. Mergnúť LoRA do base SD Turbo váh (DÔLEŽITÉ: pred kvantizáciou!)
4. Kvantizovať merged model na INT8/INT4
5. Exportovať do ONNX
6. Nahrať na HuggingFace
7. Použiť v browseri rovnako ako teraz

### 6. Text Encoder na backend (CPU server)
- Text Encoder (CLIP) presunúť na lacný backend server
- Browser pošle prompt → server vráti embeddings (77×1024, ~300 KB JSON)
- Browser sťahuje len UNet + VAE (~1.9 GB namiesto ~2.5 GB)
- **GPU nepotrebné** — CLIP na CPU zvládne ~30-60 req/s (~2000-3600/min)
- S cache (rovnaký prompt = rovnaký výsledok): prakticky neobmedzene
- Latencia: +0.5-2s na HTTP request (zanedbateľné oproti generovaniu)
- Hosting: lacný VPS ~5€/mesiac stačí
- Kombinovateľné s kvantizáciou: INT8 UNet (~865 MB) + VAE (~200 MB) = **~1.1 GB v browseri**

---

## Poznámky 
- LoRA sa MUSÍ mergnúť PRED kvantizáciou (nie po)
- Pix2Pix: pre variabilitu pridať noise na vstup alebo conditional GAN s noise vektorom
- Modely sa cachujú v IndexedDB - sťahovanie len pri prvom použití
- Existujúci LoRA súbor: sd-backend/lora_models/my_lora/Iso-Pixel-05.safetensors (18.1MB, rank 32)

---

## 🧠 VRAM / WebGPU memory management (apríl 2026)

### Aktuálny stav po optimalizáciách
- `computeGenSizeForAspect` v `LocalModel.vue`: `SHORT=448`, `MAX_LONG=960`, `MAX_PIXELS=512*960`
- Tiled VAE decode implementovaný v `webgpuDiffusion.js` (`vaeDecodeTiled`) — dekóduje po 64×64 latent tile-och s overlapom 8, cosine feather blending
- Dispose vstupných tensorov + `_flushGpuQueue()` medzi generáciami
- `hiddenStates` sa počíta raz pred loopom (nie každý step)

### Známe limity
- **UNet nie je tiled** → attention matrix je O(N²), pri ~512×960 už je na hrane
- Vyššie než ~960 na dlhšej strane UNet padne s chybou:
  `Failed to create a WebGPU compute pipeline: A valid external Instance reference no longer exists`
  (v conv_out — znamená že predchádzajúce vrstvy vyčerpali buffer pool a device-lost)
- Tiled VAE odstránil VAE OOM, ale UNet zostáva bottleneck

### Pre produkciu (TODO keď pôjde do ostrého deploya)

1. **Runtime detekcia GPU limitov**
   ```js
   const adapter = await navigator.gpu.requestAdapter()
   const maxBuf = adapter.limits.maxBufferSize
   const maxBinding = adapter.limits.maxStorageBufferBindingSize
   ```
   - iGPU / mobile: často 128–256 MB → MAX_PIXELS ~384×512
   - Discrete NVIDIA/AMD: 2 GB → MAX_PIXELS ~768×1024
   - Dynamicky nastaviť `MAX_PIXELS` pri inite

2. **Auto-fallback na quantized model pri OOM**
   - Prvý pokus: fp16
   - Ak spadne: prepnúť na `isometric-quantized` (int8 weights, ~425 MB namiesto ~850 MB)
   - Int8 nezvýši rozlíšenie zásadne (~+10–15 %) ale zachráni slabé GPU
   - POZOR: int8 zhoršuje kvalitu pri SD-Turbo (1–2 steps) — viditeľne menej detailov

3. **Try-catch + graceful retry so zmenšeným rozlíšením**
   ```js
   try { await pipeline.generateImg2Img(...) }
   catch (e) {
     if (isOOM(e)) { zníž rozlíšenie o 20 %, skús znova }
   }
   ```

4. **MultiDiffusion (tiled UNet)** — veľký refactor
   - Rozdeliť denoising loop na prekrývajúce sa dlaždice v latent space
   - Permits generácia 1024×1024+ aj na slabšej GPU
   - POZOR: pri SD-Turbo (1 step) švíky medzi tile-mi sú viditeľné → treba viac overlapu alebo 2+ kroky
   - Odhad: ~200 riadkov nového kódu v `generate*` funkciách

5. **IoBinding + preallocated output buffers (ORT Web)**
   - `session.run` s `preferredOutputLocation: 'gpu-buffer'` a znovupoužívanými GPUBuffer
   - Eliminuje allocácie medzi stepmi
   - Komplexnejšie API, ale najlepšie pre sustained throughput

### Prečo druhá generácia niekedy padne (history)
- **Root cause**: ORT Web allocator pool neuvoľní intermediate buffery medzi `run()` volaniami
- Ak druhý run má **iné rozmery** (iný template aspect ratio → iné H×W), pool sa nedá reusnúť → alokuje ďalšie navrch → pretečenie `maxBufferSize`
- Zmena **promptu** problém nespôsobuje (dimenzie zostávajú rovnaké)
- Fix (už hotový): dispose vstupných tensorov + flush queue medzi generáciami
- **POZOR**: nedisposovať výstupy z `session.run()` — ORT ich interne trackuje, explicit dispose rozbije session state (`Cannot read properties of undefined (reading 'destroy')`)

### Hardware realita pre public deploy
| GPU trieda | Aktuálne 448×960 |
|---|---|
| Discrete NVIDIA RTX / moderné AMD | ✅ |
| Apple Silicon M1+ | ✅ |
| Intel Iris Xe (novšie) | ⚠️ |
| Intel UHD (staršie iGPU) | ❌ |
| Mobile (Android/iOS WebGPU) | ❌ |

→ Pre public deploy znížiť default na ~384×768, alebo runtime-detect (bod 1).

### Aspect ratio deformácia (už opravené)
- Predtým: vstupný 1×3 template (512×1536) sa squashol na 512×512 → deformácia
- Teraz: `computeGenSizeForAspect` zachová pomer strán, snap na 64, clamp na MAX_PIXELS
- Output sa resizuje späť na pôvodné rozmery template-u cez `resizeDataUrl`

