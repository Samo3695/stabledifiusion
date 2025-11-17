# 🎨 NÁVOD NA SPUSTENIE - Stable Diffusion

## ⚡ RÝCHLY ŠTART (2 kroky)

### 1️⃣ Spustite Backend Server

```powershell
cd sd-backend
.\install.bat          # Prvýkrát - inštaluje závislosti (5-10 min)
.\start.bat            # Spustí server
```

### 2️⃣ Spustite Frontend

V **NOVOM** termináli:

```powershell
cd sd-app
yarn dev
```

Otvorte prehliadač: **http://localhost:5173**

---

## 📋 PODROBNÝ NÁVOD

### KROK 1: Príprava Backend (Python)

1. Otvorte PowerShell/CMD
2. Prejdite do priečinka:
   ```
   cd c:\moje\stabledifiuson\sd-backend
   ```

3. **PRVÝKRÁT - Inštalácia:**
   - Windows: Dvojklik na `install.bat`
   - Alebo v termináli: `.\install.bat`
   - Počkajte 5-10 minút

4. **Spustenie servera:**
   - Windows: Dvojklik na `start.bat`
   - Alebo v termináli: `.\start.bat`
   - Pri prvom spustení sa stiahne model (~4GB)
   - Počkajte kým uvidíte: "Server pripravený!"

### KROK 2: Spustenie Frontend (Vue)

1. Otvorte **NOVÝ** PowerShell/CMD terminál
2. Prejdite do priečinka:
   ```
   cd c:\moje\stabledifiuson\sd-app
   ```

3. Spustite aplikáciu:
   ```
   yarn dev
   ```

4. Otvorte prehliadač na: `http://localhost:5173`

---

## 🎯 AKO POUŽÍVAŤ

1. **Napíšte prompt** (popis obrázka v angličtine):
   ```
   "A beautiful sunset over mountains, highly detailed"
   ```

2. **Negatívny prompt** (voliteľné):
   ```
   "blurry, low quality"
   ```

3. Kliknite **"Generovať obrázok"**

4. Počkajte:
   - **S GPU:** 5-15 sekúnd
   - **Bez GPU (CPU):** 1-5 minút

5. Obrázok sa zobrazí v galérii!

> Poznámka: Ak pri generovaní nahráte obrázok (Image-to-Image), nahraný vstupný obrázok zostane zachovaný pre ďalšie generovania, až kým ho manuálne neodstránite pomocou tlačidla ❌ v náhľade.

---

## 💡 PRÍKLADY PROMPTOV

### Krajina:
```
"Beautiful landscape, mountains, lake, sunset, 8k, photorealistic"
```

### Portrét:
```
"Portrait of a woman, professional photography, studio lighting, detailed"
```

### Fantasy:
```
"Dragon flying over castle, epic, fantasy art, detailed, 4k"
```

### Sci-Fi:
```
"Cyberpunk city, neon lights, rain, night, cinematic"
```

---

## 🔧 RIEŠENIE PROBLÉMOV

### ❌ "Failed to fetch" alebo pripojenie zlyhalo

**Problém:** Frontend sa nevie pripojiť k backend serveru

**Riešenie:**
1. Skontrolujte či backend beží
2. Otvorte: `http://localhost:5000/health`
3. Malo by ukázať: `{"status": "ok"}`
4. Ak nie, reštartujte backend

### ❌ Python nie je nainštalovaný

**Riešenie:**
1. Stiahnite Python 3.10+ z: https://www.python.org/
2. Pri instalácii **zaškrtnite "Add to PATH"**
3. Reštartujte terminál
4. Spustite znova `install.bat`

### ❌ Pomalé generovanie (1-5 minút)

**Dôvod:** Používate CPU namiesto GPU

**Riešenie:**
- Nainštalujte CUDA (pre NVIDIA GPU)
- Alebo použite LITE verziu: spustite `python app-lite.py`
- Alebo buďte trpezliví 😊

### ❌ Nedostatok pamäte (CUDA out of memory)

**Riešenie:**
1. Zatvorte iné aplikácie
2. Použite LITE verziu: `python app-lite.py`
3. Alebo znížte kvalitu v `app.py`:
   ```python
   num_inference_steps=25  # namiesto 50
   ```

---

## 📊 VERZIE

### app.py (Štandard)
- Model: Stable Diffusion 1.5
- Veľkosť: ~4GB
- Kvalita: ⭐⭐⭐⭐⭐
- Rýchlosť: ⭐⭐⭐

### app-lite.py (Lite)
- Model: Stable Diffusion 1.4
- Veľkosť: ~2GB
- Kvalita: ⭐⭐⭐⭐
- Rýchlosť: ⭐⭐⭐⭐

**Spustenie LITE verzie:**
```powershell
cd sd-backend
venv\Scripts\activate
python app-lite.py
```

---

## 🖥️ SYSTÉMOVÉ POŽIADAVKY

### Minimálne (CPU):
- Procesor: Intel i5 / AMD Ryzen 5
- RAM: 8GB
- Disk: 10GB voľného
- ⏱️ Generovanie: 1-5 minút

### Odporúčané (GPU):
- Procesor: Intel i7 / AMD Ryzen 7
- RAM: 16GB
- GPU: NVIDIA RTX 3060+ (8GB VRAM)
- Disk: 10GB voľného
- ⏱️ Generovanie: 5-15 sekúnd

---

## 📞 ĎALŠIA POMOC

1. **Backend nefunguje?**
   - Pozrite `sd-backend/README.md`

2. **Frontend nefunguje?**
   - Pozrite `sd-app/README.md`

3. **Model sa nestiahne?**
   - Skontrolujte internetové pripojenie
   - Potrebné ~4GB download

---

## ✅ KONTROLNÝ ZOZNAM

- [ ] Python 3.10+ nainštalovaný
- [ ] `install.bat` dokončený
- [ ] Backend server beží (http://localhost:5000/health)
- [ ] Frontend beží (http://localhost:5173)
- [ ] Model stiahnutý (~4GB)
- [ ] Generovanie funguje

---

**🎉 Teraz môžete generovať obrázky pomocou AI!**
