# Stable Diffusion Backend Server

Python backend server s lokálnym Stable Diffusion modelom.

## Požiadavky

- Python 3.10+
- NVIDIA GPU s CUDA (odporúčané min. 8GB VRAM)
- Alebo CPU (pomalšie)

## Inštalácia

### 1. Vytvorte virtuálne prostredie

```bash
python -m venv venv
venv\Scripts\activate
```

### 2. Nainštalujte závislosti

```bash
pip install -r requirements.txt
```

### 3. Spustite server

```bash
python app.py
```

Server beží na: `http://localhost:5000`

## Použitie s Vue aplikáciou

V `sd-app/src/components/ImageGenerator.vue` zmeňte API_URL:

```javascript
const API_URL = 'http://localhost:5000/generate'
const API_KEY = '' // Netreba pre lokálny server
```

## Modely

Pri prvom spustení sa automaticky stiahne Stable Diffusion model (~4GB).

Použitý model: `runwayml/stable-diffusion-v1-5`

## Endpoints

### POST /generate
Generuje obrázok z promptu.

**Request:**
```json
{
  "prompt": "A beautiful sunset",
  "negative_prompt": "blurry, bad quality",
  "num_inference_steps": 50,
  "guidance_scale": 7.5
}
```

**Response:**
```json
{
  "image": "base64_encoded_image"
}
```

### GET /health
Kontrola stavu servera.

## Riešenie problémov

**Nedostatok pamäte?**
- Použite menší model alebo CPU
- Znížte `num_inference_steps`

**Pomalé generovanie?**
- Na CPU trvá 1-5 minút
- Na GPU (RTX 3060) ~10 sekúnd

**CUDA chyba?**
- Nainštalujte CUDA Toolkit
- Alebo použite CPU: `device = "cpu"`
