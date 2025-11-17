from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler
from PIL import Image
import io
import base64
import os

app = Flask(__name__)
CORS(app)  # Povolí požiadavky z Vue aplikácie

# Globálna premenná pre pipeline
pipe = None

def load_model():
    """Načíta Stable Diffusion model"""
    global pipe
    
    print("🔄 Načítavam Stable Diffusion model...")
    print("⏳ Prvé spustenie môže trvať niekoľko minút (sťahuje sa ~4GB model)")
    
    # Zistenie dostupnosti GPU
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"🖥️  Používam zariadenie: {device}")
    
    if device == "cpu":
        print("⚠️  UPOZORNENIE: Generovanie na CPU je veľmi pomalé (1-5 minút)")
    
    # Načítanie modelu z Hugging Face
    model_id = "runwayml/stable-diffusion-v1-5"
    
    try:
        pipe = StableDiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
            safety_checker=None,  # Vypnutie safety checkera pre rýchlosť
        )
        
        # Optimalizácia
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
        pipe = pipe.to(device)
        
        # Pre GPU - optimalizácia pamäte
        if device == "cuda":
            pipe.enable_attention_slicing()
            # pipe.enable_xformers_memory_efficient_attention()  # Vyžaduje xformers
        
        print("✅ Model úspešne načítaný!")
        return True
        
    except Exception as e:
        print(f"❌ Chyba pri načítavaní modelu: {e}")
        return False

@app.route('/health', methods=['GET'])
def health():
    """Kontrola stavu servera"""
    return jsonify({
        'status': 'ok',
        'model_loaded': pipe is not None,
        'device': 'cuda' if torch.cuda.is_available() else 'cpu'
    })

@app.route('/generate', methods=['POST'])
def generate():
    """Generuje obrázok z promptu"""
    global pipe
    
    if pipe is None:
        return jsonify({'error': 'Model nie je načítaný'}), 500
    
    try:
        data = request.json
        prompt = data.get('prompt', '')
        negative_prompt = data.get('negative_prompt', '')
        num_inference_steps = data.get('num_inference_steps', 50)
        guidance_scale = data.get('guidance_scale', 7.5)
        
        if not prompt:
            return jsonify({'error': 'Prompt je povinný'}), 400
        
        print(f"🎨 Generujem: {prompt}")
        
        # Generovanie obrázka
        with torch.inference_mode():
            image = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                width=512,
                height=512,
            ).images[0]
        
        # Konverzia na base64
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Obrázok vygenerovaný!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}',
            'prompt': prompt
        })
        
    except Exception as e:
        print(f"❌ Chyba pri generovaní: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/models', methods=['GET'])
def list_models():
    """Zoznam dostupných modelov"""
    models = [
        {
            'id': 'runwayml/stable-diffusion-v1-5',
            'name': 'Stable Diffusion 1.5',
            'description': 'Štandardný model, dobrá rovnováha kvality a rýchlosti'
        },
        {
            'id': 'stabilityai/stable-diffusion-2-1',
            'name': 'Stable Diffusion 2.1',
            'description': 'Novšia verzia, lepšia kvalita'
        }
    ]
    return jsonify({'models': models})

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Stable Diffusion Backend Server")
    print("=" * 60)
    
    # Načítanie modelu pri štarte
    if load_model():
        print("\n🌐 Server je pripravený!")
        print("📍 URL: http://localhost:5000")
        print("=" * 60)
        app.run(host='0.0.0.0', port=5000, debug=False)
    else:
        print("\n❌ Nepodarilo sa načítať model. Server sa nespustí.")
