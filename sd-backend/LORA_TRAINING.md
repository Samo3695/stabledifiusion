# 🎨 NÁVOD NA TRÉNOVANIE LoRA MODELOV

## 📖 Čo je LoRA?

**LoRA (Low-Rank Adaptation)** je malý addon (~50-200MB) ktorý modifikuje Stable Diffusion model aby generoval vo vašom vlastnom štýle.

### Výhody:
- ✅ **Rýchle trénovanie** (1-2 hodiny na RTX 4060)
- ✅ **Málo dát** (15-30 obrázkov stačí)
- ✅ **Malý súbor** (50-200MB vs 4GB celý model)
- ✅ **Funguje s Image-to-Image** (presne čo potrebujete!)
- ✅ **Kombinovateľné** (použite viacero LoRA naraz)

---

## 🎯 VÁŠ USE-CASE: Domčeky v konzistentnom štýle

Chcete generovať variácie domčekov v rovnakom štýle a uhle pohľadu.

### Výsledok po natrénovaní:
```
INPUT: Nahraný obrázok domčeka
       ↓
IMAGE-TO-IMAGE + LoRA
       ↓
OUTPUT: Domček vo VAŠOM ŠTÝLE (z datasetu)! 🏠
```

---

## 📁 KROK 1: Príprava datasetu

### Požiadavky na obrázky:
- **Počet:** 15-30 obrázkov (viac = lepšie, ale nie nutné)
- **Štýl:** Všetky v rovnakom štýle (pixel art, cartoon, realistický...)
- **Uhol:** Všetky z rovnakého uhla (frontal, isometric, 45°...)
- **Rozlíšenie:** 512x512 alebo 768x768 px
- **Formát:** PNG alebo JPG

### Príklad štruktúry:
```
C:\moje\stabledifiuson\training_data\domceky\
├── house_001.png  (modrý domček, frontal view)
├── house_002.png  (červený domček, frontal view)
├── house_003.png  (drevený domček, frontal view)
├── ...
└── house_030.png
```

### Ako získať obrázky?

**Možnosť A: Bootstrap cez Stable Diffusion**
```
Prompt: "isometric house, pixel art style, front view, simple, game asset, white background"
```
Vygenerujte 20-30 variácií s rôznymi farbami/detailmi.

**Možnosť B: Vlastné obrázky**
- Nakresliť v grafickom editore
- Stiahnuť z internetu (pozor na licenciu!)
- Vygenerovať cez iný AI nástroj

**Možnosť C: Rendering z 3D modelu**
- Vytvorte 3D model domčeka
- Renderujte 20-30 variácií (rôzne textúry/farby)
- Všetky z rovnakého uhla kamery!

---

## ⚙️ KROK 2: Konfigurácia train_lora.py

Otvorte súbor `sd-backend/train_lora.py` a upravte nastavenia:

```python
# 📁 CESTA K DATASETU
DATASET_PATH = r"C:\moje\stabledifiuson\training_data\domceky"

# 🎯 TRIGGER WORD (slovo ktoré spustí váš štýl)
TRIGGER_WORD = "domcek"  # Použijete v prompte: "a domcek house..."

# 💾 VÝSTUPNÝ SÚBOR
OUTPUT_NAME = "my_lora"  # Vytvorí: lora_models/my_lora.safetensors

# 🔧 TRÉNOVACIE PARAMETRE (pre RTX 4060 8GB)
LEARNING_RATE = 1e-4       # Rýchlosť učenia
MAX_TRAIN_STEPS = 1500     # 15-30 obrázkov × 50-100 krokov
LORA_RANK = 32             # Vyššie = kvalitnejšie (16, 32, 64, 128)
RESOLUTION = 512           # 512x512 px
```

### Odporúčané nastavenia podľa veľkosti datasetu:

| Obrázkov | MAX_TRAIN_STEPS | LORA_RANK | Čas (RTX 4060) |
|----------|-----------------|-----------|----------------|
| 10-15    | 1000-1500       | 16-32     | 30-60 min      |
| 15-30    | 1500-3000       | 32-64     | 1-2 hodiny     |
| 30-50    | 3000-5000       | 64-128    | 2-4 hodiny     |

---

## 🚀 KROK 3: Inštalácia závislostí

Ak ste ešte nenaištalovali trénovacie knižnice:

```powershell
cd c:\moje\stabledifiuson\sd-backend
.\venv\Scripts\Activate.ps1

# Inštalácia dodatočných závislostí
pip install -r requirements-training.txt
```

Toto nainštaluje:
- `safetensors` - ukladanie LoRA
- `peft` - LoRA support
- `bitsandbytes` - rýchlejší optimizer

---

## 🏋️ KROK 4: Spustenie trénovania

```powershell
cd c:\moje\stabledifiuson\sd-backend
.\venv\Scripts\Activate.ps1

# Spustenie trénovania
python train_lora.py
```

### Čo sa stane:
1. ✅ Skript načíta obrázky z `DATASET_PATH`
2. ✅ Stiahne base model (SD v1.4) ak ešte nie je v cache
3. ✅ Vytvorí LoRA vrstvy
4. ✅ Začne trénovanie (progress bar)
5. ✅ Uloží `lora_models/my_lora.safetensors`

### Výstup:
```
==================================================
🚀 ŠTART LoRA TRÉNOVANIA
==================================================

📁 Načítavam dataset...
✅ Nájdených 25 obrázkov

🔄 Načítavam base model: CompVis/stable-diffusion-v1-4
✅ Model načítaný

🔧 Konfigurujem LoRA (rank=32)...
✅ LoRA vrstvy pripravené

🏋️  ZAČÍNAM TRÉNOVANIE
   Kroky: 1500
   Learning rate: 0.0001
   Očakávaný čas: ~100 minút (na GPU)

Trénovanie: 100%|████████| 1500/1500 [1:32:15<00:00, loss=0.0234]

💾 Ukladám LoRA model...
✅ LoRA uložená: lora_models/my_lora.safetensors
📊 Veľkosť: 87.3 MB

==================================================
🎉 TRÉNOVANIE DOKONČENÉ!
==================================================
```

---

## 🎨 KROK 5: Použitie v aplikácii

### A) Overenie že LoRA je dostupná

```powershell
# Skontrolujte priečinok
dir lora_models

# Malo by ukázať:
my_lora.safetensors
```

### B) Reštart backend servera

Ak server beží, reštartujte ho aby detekoval novú LoRA:

```powershell
# Zastavte server (Ctrl+C)
# Spustite znova
python app-lite.py
```

### C) Overenie cez /health endpoint

```powershell
curl http://localhost:5000/health
```

Odpoveď by mala obsahovať:
```json
{
  "status": "ok",
  "loras_available": ["my_lora"],
  "current_lora": null
}
```

### D) Použitie vo frontende

V aplikácii:
1. Nahrajte obrázok domčeka
2. Vyberte LoRA: "my_lora"
3. Nastavte silu LoRA: 80-100%
4. Prompt: `"a domcek house, red roof, front view, detailed"`
5. Kliknite "Generovať obrázok"

**Výsledok:** Domček transformovaný do vášho štýlu! 🏠✨

---

## 💡 TIPY PRE LEPŠIE VÝSLEDKY

### 1. Trigger Word v prompte
Vždy použite trigger word v prompte:
```
❌ ZLE: "a house with red roof"
✅ DOBRE: "a domcek house with red roof"
```

### 2. Sila LoRA (lora_scale)
- **0.0 - 0.3:** Slabý vplyv (jemné zmeny)
- **0.5 - 0.7:** Stredný vplyv (vyvážené)
- **0.8 - 1.0:** Silný vplyv (výrazný štýl)

### 3. Strength parameter (Image-to-Image)
- **0.3 - 0.5:** Zachová viac z originálneho obrázka
- **0.6 - 0.8:** Vyvážená transformácia
- **0.8 - 1.0:** Výrazná zmena

### 4. Kombinácia parametrov
```python
# Pre jemné úpravy:
lora_scale = 0.6
strength = 0.5

# Pre výrazný štýl:
lora_scale = 0.9
strength = 0.75
```

---

## 🔧 RIEŠENIE PROBLÉMOV

### ❌ "CUDA out of memory"

**Problém:** Nedostatok VRAM

**Riešenie:**
```python
# V train_lora.py upravte:
RESOLUTION = 384  # namiesto 512
LORA_RANK = 16    # namiesto 32
```

### ❌ "No images found in dataset"

**Problém:** Zlá cesta k datasetu

**Riešenie:**
```python
# Skontrolujte cestu v train_lora.py:
DATASET_PATH = r"C:\moje\stabledifiuson\training_data\domceky"

# Použite plnú cestu s r"..." pre Windows
```

### ❌ "Loss not decreasing"

**Problém:** Model sa neučí

**Riešenie:**
```python
# Zvýšte learning rate:
LEARNING_RATE = 2e-4  # namiesto 1e-4

# Alebo znížte pre stabilnejšie učenie:
LEARNING_RATE = 5e-5
```

### ❌ "LoRA not affecting output"

**Problém:** LoRA nemá vplyv

**Riešenie:**
1. Použite trigger word v prompte: `"a domcek house..."`
2. Zvýšte `lora_scale` na 0.9-1.0
3. Natrénujte dlhšie (viac krokov)

---

## 📊 POKROČILÉ NASTAVENIA

### Captioning (popisy obrázkov)

Môžete vytvoriť vlastné popisy pre každý obrázok:

```
house_001.png
house_001.txt  →  "a domcek house, blue roof, front view, detailed, pixel art"

house_002.png
house_002.txt  →  "a domcek house, red walls, front view, detailed, pixel art"
```

Výhody:
- Lepšia presnosť
- Model sa učí špecifické detaily

Nevýhody:
- Časovo náročné
- Nie nutné pre konzistentný štýl

### Multiple LoRAs

Môžete namiešať viacero LoRA:

```python
# TODO: Implementácia v budúcnosti
load_lora("domceky_style", scale=0.7)
load_lora("pixel_art", scale=0.5)
```

---

## 📈 OČAKÁVANÉ VÝSLEDKY

### Po úspešnom natrénovaní:

**Input (nahraný obrázok):**
```
[Fotografia obyčajného domu]
```

**Prompt:**
```
"a domcek house, red roof, front view, highly detailed"
```

**Output:**
```
[Dom v štýle vášho datasetu - rovnaký uhol, farby, štýl ako trénovacie obrázky]
```

### Kvalita závisí od:
- ✅ Konzistentnosť datasetu (rovnaký štýl/uhol)
- ✅ Počet trénovacích obrázkov (viac = lepšie)
- ✅ Trénovacie kroky (dlhšie = kvalitnejšie)
- ✅ Použitie trigger word v prompte

---

## 🚀 ĎALŠIE KROKY

1. **Experimentujte s parametrami:**
   - Skúste rôzne `lora_scale` hodnoty
   - Testujte rôzne `strength` pre img2img

2. **Vytvorte viacero LoRA:**
   - Jeden pre domčeky
   - Jeden pre stromy
   - Jeden pre postavy

3. **Zdieľajte výsledky:**
   - LoRA súbory sú malé (~50-200MB)
   - Môžete ich zdieľať s inými

4. **Fine-tuning:**
   - Ak výsledky nie sú ideálne, natrénujte znova s upravenými parametrami

---

## 📞 POMOC

**Dataset príklady:**
- Hľadajte "isometric game assets" alebo "pixel art houses"
- Použite Stable Diffusion na generovanie bootstrapu
- Najdôležitejšie: **konzistencia!**

**Debugging:**
- Skontrolujte `train_lora.py` nastavenia
- Overte že dataset obsahuje obrázky
- Sledujte loss hodnotu (mala by klesať)

---

**🎉 HOTOVO! Teraz môžete trénovať vlastné LoRA modely a generovať vo vašom štýle!**

