# 🎨 Stable Diffusion Web Aplikácia

Vue.js webová aplikácia pre generovanie obrázkov pomocou Stable Diffusion AI.

## ✨ Funkcie

- 🖼️ Generovanie obrázkov z textového popisu (prompt)
- 🎭 Podpora negatívnych promptov
- 📸 Galéria vygenerovaných obrázkov
- 💾 Sťahovanie obrázkov
- 🗑️ Mazanie obrázkov
- 🎲 Demo režim s náhodnými obrázkami

## 🚀 Spustenie projektu

Aplikácia už beží na: **http://localhost:5173/**

### Príkazy

```bash
# Vývojový server
yarn dev

# Build pre produkciu
yarn build
```

## 🔑 Nastavenie Stable Diffusion API

### Hugging Face API (Odporúčané)

1. Vytvorte si účet na [Hugging Face](https://huggingface.co/join)
2. Získajte API token: [Settings → Tokens](https://huggingface.co/settings/tokens)
3. Otvorte `src/components/ImageGenerator.vue` a na riadku 15 vložte váš token

### Demo režim

Aplikácia má zabudovaný Demo režim - testujte bez API!

## 💡 Tipy pre lepšie výsledky

- Používajte anglické prompty
- Buďte špecifickí: `"Beautiful sunset over mountains, highly detailed, 8k"`
- Pridajte štýl: `"oil painting"`, `"digital art"`, `"photorealistic"`
- Použite negatívne prompty: `"blurry, low quality"`

## 🛠️ Technológie

Vue 3 + Vite + Stable Diffusion API

