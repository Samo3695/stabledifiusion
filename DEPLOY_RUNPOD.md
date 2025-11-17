# 🚀 Deploy na RunPod

Kompletný návod na nasadenie Stable Diffusion aplikácie na RunPod.

## 📋 Príprava

### 1. Registrácia na RunPod
1. Choď na [runpod.io](https://runpod.io)
2. Vytvor účet
3. Pridaj kredit ($10-20 na začiatok)

### 2. Docker Image sa builduje automaticky! 🎉

**GitHub Actions automaticky zbuilduje a nahrá Docker image pri každom pushu na `main` branch.**

Image je dostupný na:
```
ghcr.io/siven-samuel/stabledifiusion:latest
```

**Ako to funguje:**
1. Push kód na GitHub → automatický build
2. GitHub Actions zbuilduje Docker image
3. Image sa nahrá na GitHub Container Registry
4. Môžeš ho hneď použiť v RunPod!

**Kontrola buildu:**
- Choď na GitHub repo → **Actions tab**
- Uvidíš "Build and Push Docker Image" workflow
- Zelená fajka ✅ = build úspešný

**Manuálne spustenie buildu:**
1. Choď na **Actions** → **Build and Push Docker Image**
2. Klikni **Run workflow** → **Run workflow**

## 🎯 Deploy na RunPod

### Použitie automaticky zbuildovaného image

1. **Vytvor Template:**
   - V RunPod dashboard klikni na **Templates** → **New Template**
   - **Container Image:** `ghcr.io/siven-samuel/stabledifiusion:latest`
   - **Container Disk:** 20 GB (min)
   - **Volume Disk:** 50 GB (pre modely cache)
   - **Expose HTTP Ports:** `5000`
   - **Environment Variables:**
     ```
     HF_HOME=/workspace/.cache/huggingface
     CUDA_VISIBLE_DEVICES=0
     ```

2. **Deploy Pod:**
   - Choď na **Pods** → **Deploy**
   - Vyber svoj template
   - **GPU Type:** RTX 4090 (najlepší pomer cena/výkon) alebo RTX 3090
   - **Region:** Najbližšia (Europe/US)
   - Klikni **Deploy**

3. **Prístup:**
   - Po deploy dostaneš **Public IP** a **Port**
   - Backend: `http://TVOJA_IP:5000`
   - Testuj: `http://TVOJA_IP:5000/health`

### Metóda 2: Pomocou RunPod CLI

```bash
# Nainštaluj RunPod CLI
pip install runpod

# Login
runpod config

# Deploy
runpod deploy \
  --name stablediffusion \
  --image ghcr.io/siven-samuel/stabledifiusion:latest \
  --gpu-type "NVIDIA RTX 4090" \
  --gpu-count 1 \
  --ports 5000:5000 \
  --volume 50 \
  --env HF_HOME=/workspace/.cache/huggingface
```

## 🔧 Konfigurácia Backend

### Pridaj CORS pre vzdialený prístup

Uprav `sd-backend/app-lite.py`:

```python
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["*"])  # Pre produkciu špecifikuj domény
```

### Environment Variables

V RunPod Template pridaj:

```
HF_HOME=/workspace/.cache/huggingface
FLASK_HOST=0.0.0.0
FLASK_PORT=5000
TRANSFORMERS_CACHE=/workspace/.cache/huggingface
```

## 📊 Monitorovanie

### Logy v RunPod

```bash
# V RunPod Web Terminal
cd /app/sd-backend
tail -f logs/app.log
```

### Health Check

```bash
curl http://TVOJA_IP:5000/health
```

Odpoveď:
```json
{
  "status": "running",
  "models_loaded": ["lite"],
  "device": "cuda",
  "loras_available": ["lora_1x", "my_lora"]
}
```

## 💰 Náklady (RTX 4090)

- **On-Demand:** $0.44/hod
- **1000 obrázkov/deň:** ~$0.73/deň = **~$22/mes**
- **5000 obrázkov/deň:** ~$3.60/deň = **~$108/mes**

**Tip:** Nastav **Auto-Stop** keď nepoužívaš (šetrí ~50% nákladov)

## 🔐 Bezpečnosť

### 1. Pridaj API Key autentifikáciu

V `app-lite.py`:

```python
from functools import wraps
from flask import request

API_KEY = os.getenv("API_KEY", "your-secret-key")

def require_api_key(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        key = request.headers.get('X-API-Key')
        if key != API_KEY:
            return {"error": "Unauthorized"}, 401
        return f(*args, **kwargs)
    return decorated_function

@app.route('/generate', methods=['POST'])
@require_api_key
def generate():
    # ...
```

### 2. Rate Limiting

```bash
pip install flask-limiter
```

```python
from flask_limiter import Limiter

limiter = Limiter(
    app,
    key_func=lambda: request.remote_addr,
    default_limits=["100 per hour"]
)

@app.route('/generate', methods=['POST'])
@limiter.limit("10 per minute")
def generate():
    # ...
```

## 🚀 Frontend Deploy (Vercel/Netlify)

### 1. Uprav API URL

V `sd-app/src/components/ImageGenerator.vue`:

```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/generate'
```

### 2. Build frontend

```bash
cd sd-app
yarn build
```

### 3. Deploy na Vercel

```bash
npm i -g vercel
cd sd-app
vercel deploy
```

Environment variables:
```
VITE_API_URL=http://RUNPOD_IP:5000
```

## 📝 Checklist

- [ ] GitHub Actions workflow funguje (zelená fajka v Actions tab)
- [ ] Docker image je na `ghcr.io/siven-samuel/stabledifiusion:latest`
- [ ] RunPod template vytvorený
- [ ] Pod deployed a running
- [ ] `/health` endpoint funguje
- [ ] Test generovania obrázka
- [ ] CORS nakonfigurované
- [ ] API key autentifikácia (optional)
- [ ] Rate limiting (optional)
- [ ] Frontend deployed (Vercel/Netlify)
- [ ] Auto-stop nastavený (šetrí peniaze)

## 🆘 Troubleshooting

### GitHub Actions build zlyháva
```bash
# Skontroluj Actions tab na GitHub
# Klikni na failed workflow → pozri logy
```

### RunPod nemôže stiahnuť image
- Image musí byť **public**
- Choď na GitHub repo → **Packages** → tvoj package
- Klikni **Package settings** → **Change visibility** → **Public**

### Container nezapína
```bash
# Skontroluj logy v RunPod Web Terminal
docker logs <container_id>
```

### CUDA not available
```bash
# Skontroluj GPU
nvidia-smi
```

### Models nesťahuje
```bash
# Skontroluj HF_HOME
echo $HF_HOME
ls -la /workspace/.cache/huggingface
```

### Port nie je dostupný
- Skontroluj že port 5000 je v **Exposed Ports**
- Skontroluj firewall v RunPod settings

## 📞 Kontakt & Support

- RunPod Discord: [discord.gg/runpod](https://discord.gg/runpod)
- GitHub Issues: `github.com/siven-samuel/stabledifiusion/issues`

---

**Ready to deploy?** 🚀

1. **Commit a push zmeny** (GitHub Actions automaticky zbuilduje image)
2. **Počkaj ~10-15 min** na dokončenie buildu (sleduj v Actions tab)
3. **Nastav RunPod template** s `ghcr.io/siven-samuel/stabledifiusion:latest`
4. **Deploy!**

**Žiadne lokálne buildovanie potrebné!** ✨

