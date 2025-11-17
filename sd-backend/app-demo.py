"""
Jednoduchý Flask server pre testovanie
Zatiaľ bez Stable Diffusion - vráti demo obrázok
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
from PIL import Image, ImageDraw, ImageFont
import random

app = Flask(__name__)
CORS(app)

def create_demo_image(prompt):
    """Vytvorí demo obrázok s textom"""
    # Vytvorenie obrázka
    img = Image.new('RGB', (512, 512), color=(random.randint(50, 200), random.randint(50, 200), random.randint(50, 200)))
    draw = ImageDraw.Draw(img)
    
    # Pridanie textu
    text = f"Demo Image\n\n{prompt[:30]}..."
    
    # Jednoduchý text (bez fontu)
    bbox = draw.textbbox((0, 0), text)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    position = ((512 - text_width) // 2, (512 - text_height) // 2)
    draw.text(position, text, fill=(255, 255, 255))
    
    return img

@app.route('/health', methods=['GET'])
def health():
    """Kontrola stavu servera"""
    return jsonify({
        'status': 'ok',
        'model_loaded': True,
        'device': 'demo',
        'version': 'demo'
    })

@app.route('/generate', methods=['POST'])
def generate():
    """Generuje demo obrázok"""
    try:
        data = request.json
        prompt = data.get('prompt', 'No prompt')
        
        print(f"🎨 Generujem demo obrázok: {prompt}")
        
        # Vytvorenie demo obrázka
        image = create_demo_image(prompt)
        
        # Konverzia na base64
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Demo obrázok vytvorený!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}',
            'prompt': prompt
        })
        
    except Exception as e:
        print(f"❌ Chyba: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Demo Backend Server (Bez AI)")
    print("=" * 60)
    print("\n🌐 Server pripravený!")
    print("📍 URL: http://localhost:5000")
    print("💡 Tento server vracia demo obrázky")
    print("=" * 60)
    print()
    
    app.run(host='0.0.0.0', port=5000, debug=False)
