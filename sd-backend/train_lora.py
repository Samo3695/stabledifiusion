"""
LoRA Training Script pre Stable Diffusion
==========================================

Tento skript natrénuje LoRA model na vašom vlastnom datasete obrázkov.
LoRA sa potom použije v app-lite.py na generovanie v štýle vášho datasetu.

POUŽITIE:
1. Upravte DATASET_PATH nižšie
2. Pripravte dataset (15-30 obrázkov v priečinku)
3. Spustite: python train_lora.py
4. Počkajte 1-2 hodiny (RTX 4060)
5. Výstup: lora_models/my_lora.safetensors

ŠTRUKTÚRA DATASETU:
dataset/
  ├── image_001.jpg
  ├── image_002.jpg
  └── ...

Automaticky sa vygenerujú captions (popisy) pre každý obrázok.
"""

import os
import torch
from diffusers import StableDiffusionPipeline, DDPMScheduler
from transformers import CLIPTextModel, CLIPTokenizer
from PIL import Image
import torch.nn.functional as F
from tqdm import tqdm
from pathlib import Path
import numpy as np

# ==========================================
# NASTAVENIA - UPRAVTE PODĽA POTREBY
# ==========================================

# 📁 CESTA K DATASETU (obrázky pre trénovanie)
DATASET_PATH = r"C:\Users\siven\Downloads\verzie\firstshot\1x"

# 🎯 TRIGGER WORD (slovo ktoré spustí váš štýl)
# Použite v prompte: "a 1x house, front view"
TRIGGER_WORD = "1x"

# 💾 VÝSTUPNÝ SÚBOR
OUTPUT_NAME = "lora_1x"  # Vytvorí: lora_models/lora_1x.safetensors

# 🔧 TRÉNOVACIE PARAMETRE (pre RTX 4060 8GB)
LEARNING_RATE = 5e-5  # Bolo 1e-4, znížené pre stabilitu
MAX_TRAIN_STEPS = 5000  # Bolo 1500, VÝRAZNE ZVÝŠENÉ pre lepšie výsledky
TRAIN_BATCH_SIZE = 1
GRADIENT_ACCUMULATION_STEPS = 4  # Bolo 1, zvýšené pre lepšiu stabilitu
RESOLUTION = 512  # 512x512 px
LORA_RANK = 64  # Bolo 32, zvýšené pre väčšiu kapacitu učenia

# 🏗️ BASE MODEL
# Odporúčané modely:
# - "CompVis/stable-diffusion-v1-4" (starší, slabší)
# - "runwayml/stable-diffusion-v1-5" (základný)
# - "SG161222/Realistic_Vision_V5.1_noVAE" (fotorealistický, najlepší!)
BASE_MODEL = "SG161222/Realistic_Vision_V5.1_noVAE"

# 💬 AUTOMATICKÝ CAPTION (popis obrázkov)
# Použije sa ak neexistujú .txt súbory
DEFAULT_CAPTION = f"a {TRIGGER_WORD}, high quality, detailed"

# ==========================================
# KÓD - NEMUSÍTE MENIŤ
# ==========================================

def setup_directories():
    """Vytvorí potrebné priečinky"""
    os.makedirs("lora_models", exist_ok=True)
    os.makedirs(DATASET_PATH, exist_ok=True)
    print(f"✅ Priečinky pripravené")
    print(f"📁 Dataset: {DATASET_PATH}")
    print(f"💾 Výstup: lora_models/{OUTPUT_NAME}.safetensors")

def load_dataset():
    """Načíta obrázky z datasetu"""
    image_extensions = {'.jpg', '.jpeg', '.png', '.webp'}
    image_paths = []
    
    for file in Path(DATASET_PATH).iterdir():
        if file.suffix.lower() in image_extensions:
            image_paths.append(file)
    
    if not image_paths:
        raise ValueError(f"❌ Žiadne obrázky v {DATASET_PATH}!")
    
    print(f"✅ Nájdených {len(image_paths)} obrázkov")
    return image_paths

def get_caption(image_path):
    """
    Vygeneruje caption z názvu súboru.
    Príklad: 'egypt_palace_gold.jpg' -> 'egypt palace gold'
    
    Najprv skúsi načítať .txt súbor, ak neexistuje, použije názov súboru.
    """
    # Skús najprv .txt súbor (ak existuje)
    txt_path = image_path.with_suffix('.txt')
    
    if txt_path.exists():
        with open(txt_path, 'r', encoding='utf-8') as f:
            caption = f.read().strip()
            print(f"   📝 Caption (z .txt): '{caption}'")
            return caption
    
    # Ak neexistuje .txt, použi názov súboru ako caption
    filename = os.path.basename(image_path)
    # Odstráň príponu (.jpg, .png, .jpeg, atď.)
    caption = os.path.splitext(filename)[0]
    # Nahraď podčiarkovníky a pomlčky medzerami
    caption = caption.replace('_', ' ').replace('-', ' ')
    # Odstráň viacnásobné medzery
    caption = ' '.join(caption.split())
    
    print(f"   📝 Caption (z názvu): '{caption}'")
    return caption

def prepare_image(image_path, size=512):
    """Pripraví obrázok pre trénovanie"""
    image = Image.open(image_path).convert('RGB')
    
    # Resize na 512x512 (alebo inú veľkosť)
    image = image.resize((size, size), Image.Resampling.LANCZOS)
    
    # Konverzia na tensor
    image = torch.from_numpy(np.array(image)).float() / 127.5 - 1.0
    image = image.permute(2, 0, 1).unsqueeze(0)
    
    return image

def train_lora():
    """Hlavná trénovacia funkcia"""
    print("\n" + "="*50)
    print("🚀 ŠTART LoRA TRÉNOVANIA")
    print("="*50 + "\n")
    
    # 1. Nastavenie
    setup_directories()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"🖥️  Zariadenie: {device}")
    
    if device.type == "cpu":
        print("⚠️  UPOZORNENIE: Používate CPU! Trénovanie bude VEĽMI pomalé (dni).")
        print("   Odporúčam GPU (NVIDIA) pre rýchle trénovanie.")
        response = input("   Pokračovať? (y/n): ")
        if response.lower() != 'y':
            return
    
    # 2. Načítanie datasetu
    print("\n📁 Načítavam dataset...")
    image_paths = load_dataset()
    
    # 3. Načítanie base modelu
    print(f"\n🔄 Načítavam base model: {BASE_MODEL}")
    print("   (Prvýkrát sa stiahne ~4GB, ďalej z cache)")
    
    pipeline = StableDiffusionPipeline.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16 if device.type == "cuda" else torch.float32,
    )
    pipeline.to(device)
    
    unet = pipeline.unet
    text_encoder = pipeline.text_encoder
    tokenizer = pipeline.tokenizer
    vae = pipeline.vae
    
    print("✅ Model načítaný")
    
    # 4. Nastavenie LoRA layers (použitím peft)
    print(f"\n🔧 Konfigurujem LoRA (rank={LORA_RANK})...")
    
    from peft import LoraConfig, get_peft_model
    
    # Konfigurácia LoRA pre UNet
    lora_config = LoraConfig(
        r=LORA_RANK,
        lora_alpha=LORA_RANK,
        init_lora_weights="gaussian",
        target_modules=["to_k", "to_q", "to_v", "to_out.0"],
    )
    
    # Aplikuj LoRA na UNet
    unet = get_peft_model(unet, lora_config)
    unet.print_trainable_parameters()
    
    print("✅ LoRA vrstvy pripravené")
    
    # 5. Optimizer
    optimizer = torch.optim.AdamW(
        unet.parameters(),
        lr=LEARNING_RATE,
        betas=(0.9, 0.999),
        weight_decay=1e-2,
        eps=1e-08,
    )
    
    # 6. Trénovanie
    print(f"\n🏋️  ZAČÍNAM TRÉNOVANIE")
    print(f"   Kroky: {MAX_TRAIN_STEPS}")
    print(f"   Learning rate: {LEARNING_RATE}")
    print(f"   Batch size: {TRAIN_BATCH_SIZE}")
    print(f"   Očakávaný čas: ~{MAX_TRAIN_STEPS // 15} minút (na GPU)")
    print()
    
    global_step = 0
    progress_bar = tqdm(total=MAX_TRAIN_STEPS, desc="Trénovanie")
    
    unet.train()
    
    import numpy as np
    
    while global_step < MAX_TRAIN_STEPS:
        for image_path in image_paths:
            if global_step >= MAX_TRAIN_STEPS:
                break
            
            # Načítaj obrázok a caption
            caption = get_caption(image_path)
            pixel_values = prepare_image(image_path, RESOLUTION).to(device)
            
            # Ensure correct dtype for VAE (match model precision)
            if device.type == 'cuda':
                pixel_values = pixel_values.half()  # Convert to float16 for GPU
            
            # Encode text
            text_inputs = tokenizer(
                caption,
                padding="max_length",
                max_length=tokenizer.model_max_length,
                truncation=True,
                return_tensors="pt",
            )
            text_input_ids = text_inputs.input_ids.to(device)
            
            with torch.no_grad():
                encoder_hidden_states = text_encoder(text_input_ids)[0]
                latents = vae.encode(pixel_values).latent_dist.sample()
                latents = latents * vae.config.scaling_factor
            
            # Sample noise
            noise = torch.randn_like(latents)
            timesteps = torch.randint(0, pipeline.scheduler.config.num_train_timesteps, (latents.shape[0],), device=device)
            timesteps = timesteps.long()
            
            # Add noise
            noisy_latents = pipeline.scheduler.add_noise(latents, noise, timesteps)
            
            # Predict noise
            model_pred = unet(noisy_latents, timesteps, encoder_hidden_states).sample
            
            # Loss
            loss = F.mse_loss(model_pred.float(), noise.float(), reduction="mean")
            
            # Backward
            loss.backward()
            optimizer.step()
            optimizer.zero_grad()
            
            # Progress
            global_step += 1
            progress_bar.update(1)
            progress_bar.set_postfix({"loss": loss.item()})
    
    progress_bar.close()
    
    # 7. Uloženie
    print(f"\n💾 Ukladám LoRA model...")
    output_path = f"lora_models/{OUTPUT_NAME}.safetensors"
    
    # Uloženie pomocou peft
    unet.save_pretrained(f"lora_models/{OUTPUT_NAME}")
    
    print(f"✅ LoRA uložená: lora_models/{OUTPUT_NAME}/")
    
    # Alternatívne: Export do safetensors formátu
    try:
        from peft import get_peft_model_state_dict
        from safetensors.torch import save_file
        
        lora_state_dict = get_peft_model_state_dict(unet)
        save_file(lora_state_dict, output_path)
        print(f"✅ Safetensors export: {output_path}")
        print(f"📊 Veľkosť: {os.path.getsize(output_path) / (1024*1024):.1f} MB")
    except Exception as export_err:
        print(f"⚠️  Safetensors export preskočený: {export_err}")
    
    # 8. Hotovo!
    print("\n" + "="*50)
    print("🎉 TRÉNOVANIE DOKONČENÉ!")
    print("="*50)
    print(f"\n💡 AKO POUŽIŤ:")
    print(f"   1. LoRA je uložená v: lora_models/{OUTPUT_NAME}.safetensors")
    print(f"   2. V aplikácii vyberte túto LoRA")
    print(f"   3. V prompte použite: '{TRIGGER_WORD}'")
    print(f"   4. Príklad: 'a {TRIGGER_WORD} house, red roof, front view'")
    print(f"\n✨ Výsledky budú v štýle vášho datasetu!")

if __name__ == "__main__":
    try:
        train_lora()
    except KeyboardInterrupt:
        print("\n\n⚠️  Trénovanie prerušené používateľom")
    except Exception as e:
        print(f"\n\n❌ CHYBA: {e}")
        import traceback
        traceback.print_exc()
