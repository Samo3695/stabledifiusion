from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
from diffusers import (
    AutoPipelineForImage2Image,
    AutoPipelineForText2Image,
    StableDiffusionPipeline,
    StableDiffusionImg2ImgPipeline,
    StableDiffusionXLPipeline,
    StableDiffusionXLImg2ImgPipeline,
    DPMSolverMultistepScheduler,
    EulerAncestralDiscreteScheduler,
    EulerDiscreteScheduler,
    T2IAdapter,
    StableDiffusionAdapterPipeline,
    ControlNetModel,
    StableDiffusionControlNetPipeline,
    StableDiffusionXLControlNetPipeline,
    StableDiffusionControlNetImg2ImgPipeline,
    StableDiffusionXLControlNetImg2ImgPipeline,
)
from PIL import Image, ImageFilter
import io
import base64
import numpy as np
import os
import inspect
from pathlib import Path
from remove_background import remove_black_background
from color_transform import shift_hue, adjust_saturation, apply_color_tint

app = Flask(__name__)
CORS(app)

# Priečinok pre LoRA modely
LORA_DIR = "./lora_models"

# Priečinok pre LoRA modely
LORA_DIR = "./lora_models"

# Pipelines map to support multiple models (loaded on demand)
pipelines = {
    # key -> { 'pipe': pipeline_obj, 'img2img': img2img_obj, 'version': str }
}

# Aktuálne načítaná LoRA (aby sme vedeli či treba unfuse)
current_lora = {
    'name': None,
    'scale': None
}

def get_available_loras():
    """Vráti zoznam dostupných LoRA modelov (aj v podpriečinkoch)"""
    if not os.path.exists(LORA_DIR):
        os.makedirs(LORA_DIR, exist_ok=True)
        return []
    
    loras = []
    for file in Path(LORA_DIR).rglob('*'):
        if file.suffix in ['.safetensors', '.pt', '.bin']:
            loras.append(file.stem)
    return loras

def find_lora_path(lora_name):
    """Nájde cestu k LoRA súboru podľa názvu (aj v podpriečinkoch)"""
    for ext in ['.safetensors', '.pt', '.bin']:
        for file in Path(LORA_DIR).rglob(f'{lora_name}{ext}'):
            return str(file)
    return None

def load_lora_to_pipeline(pipe_entry, lora_name, lora_scale=0.9):
    """
    Načíta LoRA do pipeline.
    Ak už je nejaká LoRA načítaná, najprv ju unfuse.
    """
    global current_lora
    
    if not lora_name:
        # Ak je lora_name prázdny, unfuse aktuálnu LoRA
        if current_lora['name']:
            print(f"🔄 Unfusing aktuálnu LoRA: {current_lora['name']}")
            try:
                pipe_entry['pipe'].unfuse_lora()
                pipe_entry['img2img'].unfuse_lora()
            except:
                pass  # Možno nie je načítaná
            current_lora['name'] = None
            current_lora['scale'] = None
        return
    
    lora_path = find_lora_path(lora_name)
    if not lora_path:
        raise FileNotFoundError(f"LoRA súbor nenájdený: {lora_name}")
    
    print(f"🎨 Načítavam LoRA: {lora_name} (scale={lora_scale})")
    
    # Unfuse predchádzajúcu LoRA ak existuje
    if current_lora['name']:
        print(f"🔄 Unfusing predchádzajúcu LoRA: {current_lora['name']}")
        try:
            pipe_entry['pipe'].unfuse_lora()
            pipe_entry['img2img'].unfuse_lora()
        except:
            pass
    
    # Načítaj novú LoRA (zostane na tom istom device kde je pipeline)
    pipe_entry['pipe'].load_lora_weights(lora_path)
    pipe_entry['pipe'].fuse_lora(lora_scale=lora_scale)
    
    pipe_entry['img2img'].load_lora_weights(lora_path)
    pipe_entry['img2img'].fuse_lora(lora_scale=lora_scale)
    
    current_lora['name'] = lora_name
    current_lora['scale'] = lora_scale
    
    print(f"✅ LoRA načítaná a fused s scale={lora_scale}")

MODEL_REGISTRY = {
    'lite': {
        'id': 'CompVis/stable-diffusion-v1-4',
        'description': 'LITE (SD v1.4) - menší, rýchlejší model',
    },
    'realistic': {
        'id': 'SG161222/Realistic_Vision_V5.1_noVAE',
        'description': 'Realistic Vision V5.1 - fotorealistické detaily, najlepšia kvalita',
    },
    'dreamshaper': {
        'id': 'Lykon/dreamshaper-8',
        'description': 'DreamShaper 8 - univerzálny, kvalitné detaily, mix štýlov',
    },
    'texture': {
        'id': 'dream-textures/texture-diffusion',
        'description': 'Texture Diffusion - špecializovaný na seamless textúry',
    },
    'absolutereality': {
        'id': 'Lykon/absolute-reality-1.81',
        'description': 'Absolute Reality - podobný DreamShaper, semi-realistický',
    },
    'epicrealism': {
        'id': 'emilianJR/epiCRealism',
        'description': 'Epic Realism - blend reality & concept art, podobný DreamShaper',
    },
    'majicmix': {
        'id': 'digiplay/majicMIX_realistic_v7',
        'description': 'MajicMix Realistic - mix reality & fantasy, perfektný pre img2img',
    },
    'sdxl': {
        'id': 'stabilityai/stable-diffusion-xl-base-1.0',
        'description': 'SDXL - najvyššia kvalita, vyžaduje viac VRAM',
        'type': 'xl'  # Mark as XL for special handling
    },
    'sd-turbo-pytorch-fp16': {
        'id': os.environ.get('SD_TURBO_MERGED_MODEL_ID', 'stabilityai/sd-turbo'),
        'description': 'SD Turbo PyTorch FP16 - nastavte SD_TURBO_MERGED_MODEL_ID na merged HF repo ak ho chcete použiť',
        'type': 'sd21',
        'turbo': True,
    },
    'full': {
        'id': 'runwayml/stable-diffusion-v1-5',
        'description': 'Full (SD v1.5) - väčší, vyššia kvalita',
    }
}


def load_pipeline(key: str):
    """Načíta a vráti pipeline pre daný kľúč (lite/full). Nahráva sa on-demand."""
    global pipelines

    if key in pipelines:
        return pipelines[key]

    if key not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model key: {key}")

    model_id = MODEL_REGISTRY[key]['id']
    model_type = MODEL_REGISTRY[key].get('type', 'sd15')  # default SD 1.5
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"🚀 Načítavam model '{key}' -> {model_id} na zariadenie: {device}")

    try:
        # SDXL and Turbo models use different pipeline classes
        if MODEL_REGISTRY[key].get('turbo'):
            print("⚡ Používam SD Turbo PyTorch pipeline...")
            pipe = AutoPipelineForText2Image.from_pretrained(
                model_id,
                torch_dtype=torch.float16 if device == 'cuda' else torch.float32,
                variant="fp16" if device == 'cuda' else None,
                use_safetensors=True,
            )
        elif model_type == 'xl':
            print("🌟 Používam SDXL pipeline...")
            pipe = StableDiffusionXLPipeline.from_pretrained(
                model_id,
                torch_dtype=torch.float16 if device == 'cuda' else torch.float32,
                use_safetensors=True,
                variant="fp16" if device == 'cuda' else None,
            )
        else:
            pipe = StableDiffusionPipeline.from_pretrained(
                model_id,
                torch_dtype=torch.float16 if device == 'cuda' else torch.float32,
                safety_checker=None,
                requires_safety_checker=False,
            )

        # Scheduler nastavenie - pre Realistic Vision použiť Euler
        if MODEL_REGISTRY[key].get('turbo'):
            pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
        elif key == 'realistic':
            pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
        elif key in ['dreamshaper', 'absolutereality', 'epicrealism', 'majicmix']:
            # Pre concept art modely použiť DDIM alebo Euler
            pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config)
        else:
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
        
        pipe = pipe.to(device)
        if device == 'cuda':
            pipe.enable_attention_slicing()
            # Pridaj optimalizácie pre VRAM
            try:
                pipe.enable_vae_slicing()  # VAE slicing šetrí pamäť bez problémov s device
                pipe.enable_vae_tiling()   # Ešte lepšie šetrí VRAM pri veľkých obrázkoch
            except:
                pass  # Staršie verzie môžu nemať tieto metódy

        # Create img2img pipeline sharing components
        if MODEL_REGISTRY[key].get('turbo'):
            img2img = AutoPipelineForImage2Image.from_pipe(pipe)
        elif model_type == 'xl':
            img2img = StableDiffusionXLImg2ImgPipeline(
                vae=pipe.vae,
                text_encoder=pipe.text_encoder,
                text_encoder_2=pipe.text_encoder_2,
                tokenizer=pipe.tokenizer,
                tokenizer_2=pipe.tokenizer_2,
                unet=pipe.unet,
                scheduler=pipe.scheduler,
            )
        else:
            img2img = StableDiffusionImg2ImgPipeline(
                vae=pipe.vae,
                text_encoder=pipe.text_encoder,
                tokenizer=pipe.tokenizer,
                unet=pipe.unet,
                scheduler=pipe.scheduler,
                safety_checker=None,
                feature_extractor=pipe.feature_extractor,
            )
        img2img = img2img.to(device)

        pipelines[key] = {
            'pipe': pipe,
            'img2img': img2img,
            'version': key,
        }

        print(f"✅ Model '{key}' načítaný")
        return pipelines[key]

    except RuntimeError as oom:
        # GPU OOM or other runtime error
        print(f"❌ Chyba pri načítaní modelu '{key}': {oom}")
        raise
    except Exception as e:
        print(f"❌ Neočakovaná chyba pri načítaní modelu '{key}': {e}")
        raise

# =====================================================================
# T2I-Adapter integration
# =====================================================================
# Lazy caches — adapters and adapter-pipelines are loaded on first use.
adapters = {}              # key -> T2IAdapter
adapter_pipelines = {}     # f"{model_key}__{adapter_kind}" -> StableDiffusionAdapterPipeline
controlnets = {}           # key -> ControlNetModel
controlnet_pipelines = {}  # f"{model_key}__{controlnet_kind}" -> StableDiffusionControlNetPipeline
preprocessors = {}         # 'depth' | 'canny' | 'lineart' | 'sketch' -> detector

# HF model IDs for SD1.5-compatible T2I-Adapters from TencentARC.
ADAPTER_REGISTRY = {
    'depth_sd15':   'TencentARC/t2iadapter_depth_sd15v2',
    'canny_sd15':   'TencentARC/t2iadapter_canny_sd15v2',
    'sketch_sd15':  'TencentARC/t2iadapter_sketch_sd15v2',
}

CONTROLNET_REGISTRY = {
    'sd15': {
        'depth_sd15':   'lllyasviel/sd-controlnet-depth',
        'canny_sd15':   'lllyasviel/sd-controlnet-canny',
        'sketch_sd15':  'lllyasviel/control_v11p_sd15_scribble',
        'lineart_sd15': 'lllyasviel/control_v11p_sd15_lineart',
    },
    'sd21': {
        'depth_sd15': 'thibaud/controlnet-sd21-depth-diffusers',
        'canny_sd15': 'thibaud/controlnet-sd21-canny-diffusers',
    },
    'xl': {
        'depth_sd15': 'diffusers/controlnet-depth-sdxl-1.0',
        'canny_sd15': 'diffusers/controlnet-canny-sdxl-1.0',
    },
}


def load_adapter(kind: str):
    if kind in adapters:
        return adapters[kind]
    if kind not in ADAPTER_REGISTRY:
        raise ValueError(f"Unknown adapter: {kind}. Available: {list(ADAPTER_REGISTRY)}")
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    dtype = torch.float16 if device == 'cuda' else torch.float32
    print(f"⬇️  Loading T2I-Adapter '{kind}' ({ADAPTER_REGISTRY[kind]}) ...")
    a = T2IAdapter.from_pretrained(ADAPTER_REGISTRY[kind], torch_dtype=dtype)
    a = a.to(device)
    adapters[kind] = a
    print(f"✅ Adapter '{kind}' loaded on {device}")
    return a


def load_adapter_pipeline(model_key: str, adapter_kind: str):
    """Builds an adapter-conditioned pipeline that shares weights with the base SD pipeline.

    Only the adapter is new in VRAM (~150–300 MB). VAE/UNet/text encoder are reused.
    """
    cache_key = f"{model_key}__{adapter_kind}"
    if cache_key in adapter_pipelines:
        return adapter_pipelines[cache_key]
    base_entry = load_pipeline(model_key)
    base = base_entry['pipe']
    if isinstance(base, StableDiffusionXLPipeline):
        raise ValueError(f"Adapter pipeline currently supports SD1.5 base only; '{model_key}' is SDXL.")
    adapter = load_adapter(adapter_kind)
    pipe = StableDiffusionAdapterPipeline(
        vae=base.vae,
        text_encoder=base.text_encoder,
        tokenizer=base.tokenizer,
        unet=base.unet,
        adapter=adapter,
        scheduler=base.scheduler,
        safety_checker=None,
        feature_extractor=getattr(base, 'feature_extractor', None),
        requires_safety_checker=False,
    )
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    pipe = pipe.to(device)
    adapter_pipelines[cache_key] = pipe
    return pipe


def _model_family(model_key: str) -> str:
    return MODEL_REGISTRY.get(model_key, {}).get('type', 'sd15')


def load_controlnet(kind: str, model_key: str):
    family = _model_family(model_key)
    registry = CONTROLNET_REGISTRY.get(family, CONTROLNET_REGISTRY['sd15'])
    cache_key = f"{family}__{kind}"
    if cache_key in controlnets:
        return controlnets[cache_key]
    if kind not in registry:
        raise ValueError(f"ControlNet '{kind}' is not available for model '{model_key}'. Available: {list(registry)}")
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    dtype = torch.float16 if device == 'cuda' else torch.float32
    print(f"⬇️  Loading ControlNet '{kind}' for {family} ({registry[kind]}) ...")
    controlnet = ControlNetModel.from_pretrained(registry[kind], torch_dtype=dtype)
    controlnet = controlnet.to(device)
    controlnets[cache_key] = controlnet
    print(f"✅ ControlNet '{kind}' loaded on {device}")
    return controlnet


def load_controlnet_pipeline(model_key: str, controlnet_kind: str, img2img: bool = False):
    cache_key = f"{model_key}__{controlnet_kind}__{'i2i' if img2img else 't2i'}"
    if cache_key in controlnet_pipelines:
        return controlnet_pipelines[cache_key]
    base_entry = load_pipeline(model_key)
    base = base_entry['pipe']
    if isinstance(base, StableDiffusionXLPipeline):
        controlnet = load_controlnet(controlnet_kind, model_key)
        pipe_cls = StableDiffusionXLControlNetImg2ImgPipeline if img2img else StableDiffusionXLControlNetPipeline
        pipe = pipe_cls(
            vae=base.vae,
            text_encoder=base.text_encoder,
            text_encoder_2=base.text_encoder_2,
            tokenizer=base.tokenizer,
            tokenizer_2=base.tokenizer_2,
            unet=base.unet,
            controlnet=controlnet,
            scheduler=base.scheduler,
        )
    else:
        controlnet = load_controlnet(controlnet_kind, model_key)
        pipe_cls = StableDiffusionControlNetImg2ImgPipeline if img2img else StableDiffusionControlNetPipeline
        pipe = pipe_cls(
            vae=base.vae,
            text_encoder=base.text_encoder,
            tokenizer=base.tokenizer,
            unet=base.unet,
            controlnet=controlnet,
            scheduler=base.scheduler,
            safety_checker=None,
            feature_extractor=getattr(base, 'feature_extractor', None),
            requires_safety_checker=False,
        )
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    pipe = pipe.to(device)
    controlnet_pipelines[cache_key] = pipe
    return pipe


def get_preprocessor(kind: str):
    """Lazy-load depth/canny/etc detector from controlnet_aux."""
    if kind in preprocessors:
        return preprocessors[kind]
    try:
        from controlnet_aux import MidasDetector, CannyDetector, LineartDetector, PidiNetDetector
    except ImportError as e:
        raise RuntimeError("controlnet_aux is not installed. Run: pip install controlnet_aux==0.0.7") from e
    if kind == 'depth':
        preprocessors[kind] = MidasDetector.from_pretrained('lllyasviel/Annotators')
    elif kind == 'canny':
        preprocessors[kind] = CannyDetector()
    elif kind == 'lineart':
        preprocessors[kind] = LineartDetector.from_pretrained('lllyasviel/Annotators')
    elif kind == 'sketch':
        preprocessors[kind] = PidiNetDetector.from_pretrained('lllyasviel/Annotators')
    else:
        raise ValueError(f"No preprocessor available for kind '{kind}'")
    return preprocessors[kind]


def _b64_to_pil(b64_str: str) -> Image.Image:
    if ',' in b64_str:
        b64_str = b64_str.split(',', 1)[1]  # strip data URL prefix
    return Image.open(io.BytesIO(base64.b64decode(b64_str))).convert('RGB')


def _b64_to_pil_preserve_alpha(b64_str: str) -> Image.Image:
    if ',' in b64_str:
        b64_str = b64_str.split(',', 1)[1]
    image = Image.open(io.BytesIO(base64.b64decode(b64_str)))
    if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
        return image.convert('RGBA')
    return image.convert('RGB')


def _composite_on_background(image: Image.Image, background=(0, 0, 0)) -> Image.Image:
    if image.mode != 'RGBA':
        return image.convert('RGB')
    rgb = Image.new('RGB', image.size, background)
    rgb.paste(image, mask=image.getchannel('A'))
    return rgb


def _source_alpha_mask(source_image: Image.Image, size) -> Image.Image | None:
    if source_image.mode != 'RGBA':
        return None
    alpha = source_image.getchannel('A').resize(size, Image.LANCZOS)
    alpha = alpha.point(lambda p: 255 if p > 8 else 0)
    alpha = alpha.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.4))
    return alpha


def _apply_source_alpha(result: Image.Image, source_image: Image.Image) -> Image.Image:
    alpha = _source_alpha_mask(source_image, result.size)
    if alpha is None:
        return result
    output = result.convert('RGBA')
    output.putalpha(alpha)
    return output


def _with_background_constraints(prompt: str, negative_prompt: str):
    constrained_prompt = f"{prompt}, isolated object, plain black background, no scenery, no environment"
    background_negative = 'scenery, landscape, sky, clouds, room, table, horizon, patterned background, detailed background'
    constrained_negative = f"{negative_prompt}, {background_negative}" if negative_prompt else background_negative
    return constrained_prompt, constrained_negative


def _pil_to_b64_png(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def _decode_noise_mask(noise_mask_b64: str, target_size) -> np.ndarray | None:
    """Decode mask PNG → float32 array [H, W] in 0..1, resized to target_size.

    Returns None if mask is empty / decode fails.
    """
    if not noise_mask_b64:
        return None
    try:
        if ',' in noise_mask_b64:
            noise_mask_b64 = noise_mask_b64.split(',', 1)[1]
        mask_img = Image.open(io.BytesIO(base64.b64decode(noise_mask_b64))).convert('L')
        mask_img = mask_img.resize(target_size, Image.LANCZOS)
        mask_arr = np.asarray(mask_img, dtype=np.float32) / 255.0
        if mask_arr.max() <= 0.03:
            return None
        return mask_arr
    except Exception as e:
        print(f"⚠️  Failed to decode noise mask: {e}")
        return None


def _multiscale_noise(shape, rng=None) -> np.ndarray:
    """Sum of three octaves: pixel noise + small blobs (~8 px) + large blobs (~32 px).

    Multi-frequency noise gives SD-Turbo (1–4 steps) richer "seeds" to interpret
    as architectural detail (windows, doorways) than flat Gaussian, which the
    VAE encoder mostly averages away.
    """
    if rng is None:
        rng = np.random
    h, w, c = shape
    # Octave 1: per-pixel high-freq Gaussian
    n1 = rng.normal(0.0, 1.0, shape).astype(np.float32)
    # Octave 2: ~8 px blobs (downsample → upsample with bilinear)
    s2 = (max(1, h // 8), max(1, w // 8))
    n2_small = rng.normal(0.0, 1.0, (s2[0], s2[1], c)).astype(np.float32)
    n2 = np.asarray(
        Image.fromarray((n2_small * 40 + 128).clip(0, 255).astype(np.uint8))
        .resize((w, h), Image.BILINEAR),
        dtype=np.float32,
    )
    n2 = (n2 - 128.0) / 40.0
    # Octave 3: ~32 px blobs (window/door scale)
    s3 = (max(1, h // 32), max(1, w // 32))
    n3_small = rng.normal(0.0, 1.0, (s3[0], s3[1], c)).astype(np.float32)
    n3 = np.asarray(
        Image.fromarray((n3_small * 40 + 128).clip(0, 255).astype(np.uint8))
        .resize((w, h), Image.BILINEAR),
        dtype=np.float32,
    )
    n3 = (n3 - 128.0) / 40.0
    # Weight low frequencies harder — SD-Turbo amplifies blobs into shapes
    return 0.4 * n1 + 0.7 * n2 + 1.1 * n3


def _apply_noise_mask(src_image: Image.Image, noise_mask_b64: str, strength: float = 1.0) -> Image.Image:
    """Inject high-entropy multi-scale noise into `src_image` where the mask is white.

    SD-Turbo at 1–4 steps barely re-imagines flat regions because the VAE encodes
    them to ~constant latents. We inject:
      • Multi-octave noise (pixel + 8 px + 32 px blobs) — survives VAE encoding
        and looks like "raw architectural seeds" to the UNet.
      • Localised brightness drop (slight) — biases regions toward openings/doors.

    `strength` (0..2) scales overall noise amplitude; mask brightness scales it
    further per pixel.
    """
    mask_arr = _decode_noise_mask(noise_mask_b64, src_image.size)
    if mask_arr is None:
        return src_image
    try:
        rgb = np.asarray(src_image.convert('RGB'), dtype=np.float32)
        noise = _multiscale_noise(rgb.shape)
        # Amp tuned so a fully-white mask ≈ ±70 RGB units of high-freq + ±100 of blobs.
        amp = mask_arr[..., None] * float(strength) * 120.0
        # Slight darkening bias inside masked areas — diffusion preferentially
        # generates openings (windows/doors) in dimmer regions.
        bias = mask_arr[..., None] * float(strength) * -25.0
        out = rgb + noise * amp + bias
        out = np.clip(out, 0.0, 255.0).astype(np.uint8)
        print(f"🎨 Noise mask applied: coverage={float(mask_arr.mean()):.3f}, "
              f"max={float(mask_arr.max()):.2f}, strength={strength:.2f}")
        return Image.fromarray(out, mode='RGB')
    except Exception as e:
        print(f"⚠️  Failed to apply noise mask: {e}")
        return src_image


def _weaken_control_image(
    control_image: Image.Image,
    noise_mask_b64: str,
    controlnet_kind: str,
    strength: float = 1.0,
) -> Image.Image:
    """Locally erase / blur the ControlNet conditioning map where the mask is white.

    THIS is the dominant lever when ControlNet is overpowering the prompt:
      • depth   → blur heavily + pull toward mid-gray (kills the gradient that
                  forces the UNet to keep the surface flat).
      • canny / lineart / sketch → erase edges to black (no edge constraint).
      • other → fall back to depth-style blur.

    Outside the mask the conditioning image is untouched, so global composition
    (silhouettes, corners) stays locked.
    """
    mask_arr = _decode_noise_mask(noise_mask_b64, control_image.size)
    if mask_arr is None:
        return control_image
    try:
        kind_root = (controlnet_kind or '').split('_')[0].lower()
        ctl = np.asarray(control_image.convert('RGB'), dtype=np.float32)
        m = (mask_arr * float(strength)).clip(0.0, 1.0)[..., None]

        if kind_root in ('canny', 'lineart', 'sketch', 'mlsd', 'scribble'):
            # Edge-style: erase edges (black = no edge) in the masked region.
            erased = ctl * (1.0 - m)
            out = erased
            mode_used = 'erase-edges'
        else:
            # Depth / normal / generic gradient map: heavy blur + pull to mid-gray.
            blurred_pil = control_image.convert('RGB').filter(ImageFilter.GaussianBlur(radius=18))
            blurred = np.asarray(blurred_pil, dtype=np.float32)
            mid = np.full_like(ctl, 128.0)
            # Blend: original outside mask, blurred-toward-gray inside.
            washed = blurred * 0.45 + mid * 0.55
            out = ctl * (1.0 - m) + washed * m
            mode_used = 'blur-depth'

        out = np.clip(out, 0.0, 255.0).astype(np.uint8)
        print(f"🪓 ControlNet hint weakened ({mode_used}): "
              f"coverage={float(mask_arr.mean()):.3f}, strength={strength:.2f}")
        return Image.fromarray(out, mode='RGB')
    except Exception as e:
        print(f"⚠️  Failed to weaken control image: {e}")
        return control_image


def _adapter_conditioning_mode(pipe) -> str:
    """Return the PIL mode expected by the loaded adapter conditioning image."""
    conv_in = getattr(getattr(pipe.adapter, 'adapter', None), 'conv_in', None)
    in_channels = getattr(conv_in, 'in_channels', None)
    if in_channels == 64:
        return 'L'
    return 'RGB'


def _make_conditioning_image(data, source_image, kind: str, width: int, height: int) -> Image.Image:
    if 'adapter_image' in data and data['adapter_image']:
        return _b64_to_pil(data['adapter_image']).resize((width, height), Image.LANCZOS)
    if 'control_image' in data and data['control_image']:
        return _b64_to_pil(data['control_image']).resize((width, height), Image.LANCZOS)

    kind_root = kind.split('_')[0]
    proc = get_preprocessor(kind_root)
    conditioning_image = proc(source_image)
    if not isinstance(conditioning_image, Image.Image):
        conditioning_image = Image.fromarray(np.array(conditioning_image))
    return conditioning_image.resize((width, height), Image.LANCZOS)


# ─── WebGPU-compatible img2img loop (1:1 mirror of webgpuDiffusion.js generateImg2Img) ───
#
# diffusers' StableDiffusionImg2ImgPipeline picks timesteps via the scheduler
# (which depends on num_inference_steps & strength in a non-trivial way) and
# clamps `int(num_inference_steps * strength) >= 1`. That makes 1-step turbo
# img2img behave very differently from the in-browser WebGPU pipeline.
#
# This function reimplements the WebGPU variant exactly:
#   startTimestep = round(999 * strength)
#   timesteps = [startTimestep - i*stepSize for i in 0..numSteps-1]
#   sigmas    = [sigma(t) for t in timesteps] + [0]
#   latents   = encode(image) + sigmas[0] * noise
#   loop:    scaled = latents / sqrt(sigma^2 + 1)
#            eps    = unet(scaled, t, hidden)
#            latents = latents + eps * (sigmaNext - sigma)
#   image  = vae.decode(latents / 0.18215)

_NUM_TRAIN_TIMESTEPS = 1000
_BETA_START = 0.00085
_BETA_END = 0.012


def _alphas_cumprod_np():
    sqrt_start = _BETA_START ** 0.5
    sqrt_end = _BETA_END ** 0.5
    sqrt_betas = np.linspace(sqrt_start, sqrt_end, _NUM_TRAIN_TIMESTEPS, dtype=np.float64)
    betas = sqrt_betas * sqrt_betas
    alphas = 1.0 - betas
    return np.cumprod(alphas, dtype=np.float64)


_ALPHAS_CUMPROD = _alphas_cumprod_np()


def _sigma_for_timestep(t: int) -> float:
    a = _ALPHAS_CUMPROD[int(t)]
    return float(((1.0 - a) / a) ** 0.5)


@torch.inference_mode()
def webgpu_compatible_img2img(
    pipe,
    prompt: str,
    negative_prompt: str,
    init_image: Image.Image,
    strength: float,
    num_steps: int,
    width: int,
    height: int,
    generator,
    guidance_scale: float = 0.0,
):
    """Run img2img using the same Euler-discrete (epsilon) loop as WebGPU pipeline.

    Designed for SD-Turbo (guidance_scale=0, 1–4 steps). Mirrors webgpuDiffusion.js exactly.
    """
    device = pipe.device
    dtype = pipe.unet.dtype

    # ── 1. Encode image → latents (×0.18215) ────────────────────────────────
    img_np = np.asarray(init_image.convert('RGB'), dtype=np.float32) / 255.0
    img_np = img_np * 2.0 - 1.0  # [-1, 1]
    img_t = torch.from_numpy(img_np).permute(2, 0, 1).unsqueeze(0).to(device=device, dtype=dtype)
    image_latents = pipe.vae.encode(img_t).latent_dist.mean * 0.18215  # use mean (not sample) for determinism — matches webgpu

    # ── 2. Text embeddings ──────────────────────────────────────────────────
    tok = pipe.tokenizer(
        prompt,
        padding='max_length',
        max_length=pipe.tokenizer.model_max_length,
        truncation=True,
        return_tensors='pt',
    )
    hidden = pipe.text_encoder(tok.input_ids.to(device))[0].to(dtype)

    do_cfg = guidance_scale > 1.0
    if do_cfg:
        ntok = pipe.tokenizer(
            negative_prompt or '',
            padding='max_length',
            max_length=pipe.tokenizer.model_max_length,
            truncation=True,
            return_tensors='pt',
        )
        neg_hidden = pipe.text_encoder(ntok.input_ids.to(device))[0].to(dtype)
        hidden = torch.cat([neg_hidden, hidden], dim=0)

    # ── 3. Build timesteps (matches webgpu) ─────────────────────────────────
    max_t = _NUM_TRAIN_TIMESTEPS - 1
    start_t = max(1, int(round(max_t * strength)))
    step_size = max(1, start_t // max(1, num_steps))
    timesteps = [start_t - i * step_size for i in range(num_steps) if (start_t - i * step_size) > 0]
    if not timesteps:
        # strength too low → just decode original latents
        decoded = pipe.vae.decode(image_latents / 0.18215).sample
        decoded = (decoded.clamp(-1, 1).float() + 1.0) / 2.0
        arr = (decoded[0].permute(1, 2, 0).cpu().numpy() * 255.0).round().astype(np.uint8)
        return Image.fromarray(arr)

    sigmas = [_sigma_for_timestep(t) for t in timesteps] + [0.0]
    print(f"   └─ webgpu-compat: start_t={start_t}, ts={timesteps}, sigmas={[f'{s:.3f}' for s in sigmas]}")

    # ── 4. Init latents = image_latents + sigma0 * noise ────────────────────
    init_sigma = sigmas[0]
    noise = torch.randn(image_latents.shape, generator=generator, device=device, dtype=dtype)
    latents = image_latents + init_sigma * noise

    # ── 5. Denoising loop (Euler discrete, epsilon prediction) ──────────────
    for i, t in enumerate(timesteps):
        sigma = sigmas[i]
        sigma_next = sigmas[i + 1]
        scale = 1.0 / ((sigma * sigma + 1.0) ** 0.5)
        scaled = latents * scale

        ts_tensor = torch.tensor([int(t)], device=device, dtype=torch.long)
        if do_cfg:
            inp = torch.cat([scaled, scaled], dim=0)
            eps = pipe.unet(inp, ts_tensor.expand(2), encoder_hidden_states=hidden).sample
            eps_uncond, eps_text = eps.chunk(2)
            eps = eps_uncond + guidance_scale * (eps_text - eps_uncond)
        else:
            eps = pipe.unet(scaled, ts_tensor, encoder_hidden_states=hidden).sample

        latents = latents + eps * (sigma_next - sigma)

    # ── 6. VAE decode ───────────────────────────────────────────────────────
    decoded = pipe.vae.decode(latents / 0.18215).sample
    decoded = (decoded.clamp(-1, 1).float() + 1.0) / 2.0
    arr = (decoded[0].permute(1, 2, 0).cpu().numpy() * 255.0).round().astype(np.uint8)
    return Image.fromarray(arr)


@app.route('/generate-with-adapter', methods=['POST'])
def generate_with_adapter():
    """Generate an image conditioned on a T2I-Adapter (depth/canny/sketch/lineart).

    Request JSON:
      prompt: str
      negative_prompt: str (optional)
      model: str (key from MODEL_REGISTRY, SD1.5 only) — default 'lite'
      adapter: str (key from ADAPTER_REGISTRY) — default 'depth_sd15'
      image: base64 PNG/JPEG — source/structure image (e.g. 3D editor screenshot)
      adapter_image: base64 (optional) — pre-computed depth/canny map. If absent, derived from `image`.
      width / height: int (default 512)
      steps: int (default 30)
      guidance_scale: float (default 7.5)
      adapter_conditioning_scale: float (default 1.0)
      adapter_conditioning_factor: float (0–1, default 1.0) — fraction of denoising steps adapter is active.
      seed: int (optional)

    Response JSON:
      image: base64 PNG (final result)
      adapter_image: base64 PNG (computed/used conditioning map — useful for debugging)
    """
    data = request.get_json(silent=True) or {}
    prompt = data.get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': "'prompt' is required"}), 400
    if 'image' not in data:
        return jsonify({'error': "'image' (base64) is required"}), 400

    negative_prompt = data.get('negative_prompt', '')
    model_key = data.get('model', 'lite')
    adapter_kind = data.get('adapter', 'depth_sd15')
    width = int(data.get('width', 512))
    height = int(data.get('height', 512))
    default_steps = 4 if MODEL_REGISTRY.get(model_key, {}).get('turbo') else 30
    steps = int(data.get('steps', default_steps))
    if MODEL_REGISTRY.get(model_key, {}).get('turbo'):
        steps = max(1, min(steps, 4))
    guidance = float(data.get('guidance_scale', 7.5))
    cond_scale = float(data.get('adapter_conditioning_scale', 1.0))
    cond_factor = float(data.get('adapter_conditioning_factor', 1.0))
    seed = data.get('seed', None)
    if seed is None:
        seed = torch.randint(0, 2**32, (1,)).item()
    lora_name = data.get('lora', '')
    lora_scale = data.get('lora_scale', 0.9)

    try:
        base_entry = load_pipeline(model_key)

        try:
            if lora_name and (lora_name != current_lora['name'] or lora_scale != current_lora['scale']):
                load_lora_to_pipeline(base_entry, lora_name, lora_scale)
            elif not lora_name and current_lora['name']:
                load_lora_to_pipeline(base_entry, '', 0.0)
        except Exception as lora_err:
            error_msg = str(lora_err)
            print(f"⚠️  Chyba pri načítaní LoRA pre adapter: {error_msg}")
            return jsonify({'error': f'Chyba pri načítaní LoRA: {error_msg}'}), 500

        src_image = _b64_to_pil(data['image']).resize((width, height), Image.LANCZOS)

        if 'adapter_image' in data and data['adapter_image']:
            adapter_image = _b64_to_pil(data['adapter_image']).resize((width, height), Image.LANCZOS)
        else:
            kind_root = adapter_kind.split('_')[0]   # depth_sd15 -> depth
            proc = get_preprocessor(kind_root)
            adapter_image = proc(src_image)
            if not isinstance(adapter_image, Image.Image):
                adapter_image = Image.fromarray(np.array(adapter_image))
            adapter_image = adapter_image.resize((width, height), Image.LANCZOS)

        pipe = load_adapter_pipeline(model_key, adapter_kind)
        adapter_image = adapter_image.convert(_adapter_conditioning_mode(pipe))

        generator = torch.Generator(device=pipe.device).manual_seed(int(seed))

        pipe_kwargs = {
            'prompt': prompt,
            'negative_prompt': negative_prompt or None,
            'image': adapter_image,
            'width': width,
            'height': height,
            'num_inference_steps': steps,
            'guidance_scale': guidance,
            'adapter_conditioning_scale': cond_scale,
            'generator': generator,
        }
        if 'adapter_conditioning_factor' in inspect.signature(pipe.__call__).parameters:
            pipe_kwargs['adapter_conditioning_factor'] = cond_factor

        result = pipe(**pipe_kwargs).images[0]

        return jsonify({
            'image': f"data:image/png;base64,{_pil_to_b64_png(result)}",
            'adapter_image': f"data:image/png;base64,{_pil_to_b64_png(adapter_image)}",
            'prompt': prompt,
            'seed': int(seed) if seed is not None else None,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/generate-with-controlnet', methods=['POST'])
def generate_with_controlnet():
    """Generate an image conditioned with ControlNet (depth/canny/sketch/lineart)."""
    data = request.get_json(silent=True) or {}
    prompt = data.get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': "'prompt' is required"}), 400
    if 'image' not in data:
        return jsonify({'error': "'image' (base64) is required"}), 400

    negative_prompt = data.get('negative_prompt', '')
    model_key = data.get('model', 'lite')
    controlnet_kind = data.get('controlnet', data.get('adapter', 'depth_sd15'))
    width = int(data.get('width', 512))
    height = int(data.get('height', 512))
    steps = int(data.get('steps', 30))
    guidance = float(data.get('guidance_scale', 7.5))
    cond_scale = float(data.get('controlnet_conditioning_scale', data.get('adapter_conditioning_scale', 1.0)))
    seed = data.get('seed', None)
    if seed is None:
        seed = torch.randint(0, 2**32, (1,)).item()
    lora_name = data.get('lora', '')
    lora_scale = data.get('lora_scale', 0.9)

    try:
        base_entry = load_pipeline(model_key)

        try:
            if lora_name and (lora_name != current_lora['name'] or lora_scale != current_lora['scale']):
                load_lora_to_pipeline(base_entry, lora_name, lora_scale)
            elif not lora_name and current_lora['name']:
                load_lora_to_pipeline(base_entry, '', 0.0)
        except Exception as lora_err:
            error_msg = str(lora_err)
            print(f"⚠️  Chyba pri načítaní LoRA pre ControlNet: {error_msg}")
            return jsonify({'error': f'Chyba pri načítaní LoRA: {error_msg}'}), 500

        source_with_alpha = _b64_to_pil_preserve_alpha(data['image']).resize((width, height), Image.LANCZOS)
        src_image = _composite_on_background(source_with_alpha, (255, 255, 255))
        control_image = _make_conditioning_image(data, src_image, controlnet_kind, width, height).convert('RGB')

        # Optional user-painted noise mask — adds entropy to flat regions so
        # img2img has room to generate details (windows/doors) there without
        # disturbing the global composition. Mask is in client (canvas) pixel
        # space; we resize it to the working resolution.
        noise_mask_b64 = data.get('noise_mask') or data.get('noiseMask')
        if noise_mask_b64:
            noise_strength = float(data.get('noise_mask_strength', 1.0))
            # 1) inject high-entropy multi-scale noise into the init image
            src_image = _apply_noise_mask(src_image, noise_mask_b64, noise_strength)
            # 2) and — crucially — weaken the ControlNet hint in the same region
            #    so the depth/canny map doesn't pull the UNet back to a flat surface.
            cn_weaken = float(data.get('noise_mask_control_weaken', 1.0))
            if cn_weaken > 0.0:
                control_image = _weaken_control_image(
                    control_image, noise_mask_b64, controlnet_kind, cn_weaken
                )

        # img2img + ControlNet: pass the source image as `image` and the depth/canny map
        # as `control_image`. This preserves colours/shadows from the 3D scene while the
        # ControlNet only enforces the geometry. Falls back to txt2img-with-ControlNet
        # only if the caller explicitly opts out by setting use_img2img=false.
        use_img2img = bool(data.get('use_img2img', True))
        strength = float(data.get('strength', 0.55))
        # ControlNet je aktívny len na začiatku denoisingu — uzamkne tvar,
        # potom sa vypne a posledné kroky model voľne dopĺňa detaily.
        # Default 0.0..0.45 = prvých 45 % krokov drží štruktúru, zvyšok modél
        # voľne dopĺňa detaily a farby.
        cn_guidance_start = float(data.get('controlnet_guidance_start', 0.0))
        cn_guidance_end = float(data.get('controlnet_guidance_end', 0.45))
        pipe = load_controlnet_pipeline(model_key, controlnet_kind, img2img=use_img2img)
        generator = torch.Generator(device=pipe.device).manual_seed(int(seed))

        if data.get('transparent_background', False):
            prompt, negative_prompt = _with_background_constraints(prompt, negative_prompt)

        if use_img2img:
            # ControlNet+img2img potrebuje viac iterácií ako čistý SD-Turbo img2img,
            # inak nestihne v posledných (CN-free) krokoch dorobiť detaily.
            min_cn_steps = 8
            requested_steps = max(steps, min_cn_steps)
            # diffusers requires effective steps (num_inference_steps * strength) >= 1.
            i2i_steps = max(requested_steps, int(round(1 / max(strength, 0.05))) + 1)
            print(f"⚙️  ControlNet+img2img: steps={i2i_steps}, strength={strength:.2f}, "
                  f"cn_scale={cond_scale}, cn_window={cn_guidance_start:.2f}..{cn_guidance_end:.2f}")
            result = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                image=src_image,
                control_image=control_image,
                strength=strength,
                width=width,
                height=height,
                num_inference_steps=i2i_steps,
                guidance_scale=guidance,
                controlnet_conditioning_scale=cond_scale,
                control_guidance_start=cn_guidance_start,
                control_guidance_end=cn_guidance_end,
                generator=generator,
            ).images[0]
        else:
            result = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                image=control_image,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                controlnet_conditioning_scale=cond_scale,
                control_guidance_start=cn_guidance_start,
                control_guidance_end=cn_guidance_end,
                generator=generator,
            ).images[0]

        if data.get('transparent_background', False):
            result = _apply_source_alpha(result, source_with_alpha)

        return jsonify({
            'image': f"data:image/png;base64,{_pil_to_b64_png(result)}",
            'control_image': f"data:image/png;base64,{_pil_to_b64_png(control_image)}",
            'adapter_image': f"data:image/png;base64,{_pil_to_b64_png(control_image)}",
            'prompt': prompt,
            'seed': int(seed),
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/list-adapters', methods=['GET'])
def list_adapters():
    return jsonify({
        'adapters': list(ADAPTER_REGISTRY.keys()),
        'loaded': list(adapters.keys()),
    })


@app.route('/list-controlnets', methods=['GET'])
def list_controlnets():
    return jsonify({
        'controlnets': CONTROLNET_REGISTRY,
        'loaded': list(controlnets.keys()),
    })


@app.route('/health', methods=['GET'])
def health():
    loaded = list(pipelines.keys())
    available_loras = get_available_loras()
    return jsonify({
        'status': 'ok',
        'models_loaded': loaded,
        'device': 'cuda' if torch.cuda.is_available() else 'cpu',
        'loras_available': available_loras,
        'current_lora': current_lora['name'],
    })

@app.route('/generate', methods=['POST'])
def generate():
    # model selection: 'lite' or 'full' (default: lite)
    model_key = (request.json or {}).get('model', 'lite')

    try:
        model_entry = load_pipeline(model_key)
    except Exception as e:
        return jsonify({'error': f'Nepodarilo sa načítať požadovaný model: {e}'}), 500
    
    try:
        data = request.json
        prompt = data.get('prompt', '')
        negative_prompt = data.get('negative_prompt', '')
        input_image = data.get('input_image', '')  # Base64 obrázok
        target_color = data.get('target_color', '')  # Hexadecimálna farba (napr. #FF0000)
        
        # LoRA podpora
        lora_name = data.get('lora', '')  # Názov LoRA (bez prípony)
        lora_scale = data.get('lora_scale', 0.9)  # 0.0 - 1.0
        
        # Načítaj LoRA ak je zadaná
        try:
            if lora_name and lora_name != current_lora['name']:
                load_lora_to_pipeline(model_entry, lora_name, lora_scale)
            elif not lora_name and current_lora['name']:
                # Unfuse ak už nie je potrebná
                load_lora_to_pipeline(model_entry, '', 0.0)
        except Exception as lora_err:
            error_msg = str(lora_err)
            print(f"⚠️  Chyba pri načítaní LoRA: {error_msg}")
            
            # Špecifická správa pre nekompatibilné target modules
            if 'not found in the base model' in error_msg or 'Target modules' in error_msg:
                return jsonify({
                    'error': f'LoRA model "{lora_name}" nie je kompatibilný s modelom "{model_key}". Tento LoRA je pravdepodobne pre SDXL alebo inú architektúru. Skúste iný LoRA model alebo zmeňte základný model.'
                }), 400
            
            # Size mismatch chyby - LoRA má inú architektúru než base model
            if 'size mismatch' in error_msg:
                # Detekuj či je to SD 1.5 LoRA s inym modelom
                if '768' in error_msg and '1024' in error_msg:
                    return jsonify({
                        'error': f'LoRA model "{lora_name}" je pre SD 1.5 (text encoder 768), ale model "{model_key}" používa inú architektúru (1024). Použite tento LoRA s modelmi: lite, full, dreamshaper, realistic. Alebo vypnite LoRA pre texture model.'
                    }), 400
                else:
                    return jsonify({
                        'error': f'LoRA model "{lora_name}" nie je kompatibilný s modelom "{model_key}". Architektúra LoRA nezodpovedá základnému modelu.'
                    }), 400
            
            return jsonify({'error': f'Chyba pri načítaní LoRA: {error_msg}'}), 500
        
        # Limit steps for lite by default, but allow full to use higher default
        if MODEL_REGISTRY.get(model_key, {}).get('turbo'):
            num_inference_steps = max(1, min(data.get('num_inference_steps', 4), 4))
            guidance_scale = data.get('guidance_scale', 0.0)
        elif model_key == 'lite':
            num_inference_steps = min(data.get('num_inference_steps', 30), 30)
            guidance_scale = data.get('guidance_scale', 7.5)
        else:
            num_inference_steps = data.get('num_inference_steps', 50)
            guidance_scale = data.get('guidance_scale', 7.5)
        strength = float(data.get('strength', 0.75))  # Pre img2img - ako moc zmeniť obrázok
        # Pre SD-Turbo PyTorch img2img používame webgpu_compatible_img2img,
        # ktorá podporuje ľubovoľné `steps * strength` (rovnako ako WebGPU).
        # Pre ne-turbo modely zachovaj pôvodné správanie diffusers img2img.
        if input_image and not MODEL_REGISTRY.get(model_key, {}).get('turbo') and int(num_inference_steps * strength) < 1:
            required_steps = int(np.ceil(1.0 / max(strength, 0.001)))
            num_inference_steps = max(num_inference_steps, required_steps)
            print(f"⚙️  Upravené img2img kroky: steps={num_inference_steps}, strength={strength:.3f}")
        
        # Rozmery obrázka (width, height)
        width = data.get('width', 512)
        height = data.get('height', 512)
        
        # Seed pre reprodukovateľnosť
        seed = data.get('seed', None)
        if seed is None:
            # Vygeneruj náhodný seed ak nie je zadaný
            seed = torch.randint(0, 2**32, (1,)).item()
        
        # Zaokrúhli na násobok 8 (požiadavka SD)
        width = int(width // 8 * 8)
        height = int(height // 8 * 8)
        
        # Nastav generator so seed
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        generator = torch.Generator(device=device).manual_seed(int(seed))
        print(f"🎲 Seed: {seed}")
        
        if not prompt:
            return jsonify({'error': 'Prompt je povinný'}), 400
        
        # Image-to-Image ak je nahratý obrázok
        if input_image:
            print(f"🖼️ Image-to-Image ({model_key}): {prompt[:50]}...")

            # Dekóduj base64 obrázok
            if ',' in input_image:
                input_image = input_image.split(',')[1]

            image_data = base64.b64decode(input_image)
            init_image = Image.open(io.BytesIO(image_data))
            
            # Zachovaj alpha kanál pre neskoršie použitie
            has_alpha = False
            alpha_channel = None
            
            print(f"🖼️  Vstup: {init_image.mode}")
            if init_image.mode == 'RGBA':
                has_alpha = True
                alpha_channel = init_image.split()[3]  # Ulož alpha kanál
                print("   └─ Detekovaná priehľadnosť (RGBA)")
                # Konvertuj na RGB pre SD (s bielym pozadím pre preview)
                rgb_image = Image.new('RGB', init_image.size, (255, 255, 255))
                rgb_image.paste(init_image, mask=alpha_channel)
                init_image = rgb_image
            elif init_image.mode != 'RGB':
                init_image = init_image.convert('RGB')

            # Zmeniť veľkosť podľa požadovaných rozmerov
            target_size = (width, height)
            init_image = init_image.resize(target_size)
            if has_alpha:
                alpha_channel = alpha_channel.resize(target_size, Image.Resampling.LANCZOS)

            # Optional user-painted noise mask — applied after resize so the
            # mask matches the working resolution.
            noise_mask_b64 = data.get('noise_mask') or data.get('noiseMask')
            if noise_mask_b64:
                noise_strength = float(data.get('noise_mask_strength', 1.0))
                init_image = _apply_noise_mask(init_image, noise_mask_b64, noise_strength)

            # Use the requested img2img pipeline
            img2img_pipe = model_entry.get('img2img')
            if img2img_pipe is None:
                return jsonify({'error': 'Img2Img pipeline nie je dostupná pre požadovaný model'}), 500

            is_turbo = bool(MODEL_REGISTRY.get(model_key, {}).get('turbo'))
            if is_turbo:
                # Use the WebGPU-compatible Euler loop so PyTorch SD-Turbo behaves
                # bit-for-bit like the in-browser ONNX/WebGPU pipeline.
                # Honour the user's `num_inference_steps` and `strength` directly —
                # NO automatic step-bumping (that was what made strength=0.85 look
                # different here vs. WebGPU).
                requested_steps = max(1, int(data.get('num_inference_steps', 1)))
                image = webgpu_compatible_img2img(
                    img2img_pipe,
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    init_image=init_image,
                    strength=strength,
                    num_steps=requested_steps,
                    width=width,
                    height=height,
                    generator=generator,
                    guidance_scale=guidance_scale,
                )
            else:
                with torch.inference_mode():
                    image = img2img_pipe(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        image=init_image,
                        strength=strength,
                        num_inference_steps=num_inference_steps,
                        guidance_scale=guidance_scale,
                        generator=generator,
                    ).images[0]
            
            # Automaticky odstráň čierne pozadie a vytvor priehľadnosť
            if has_alpha:
                print("🔄 Odstraňujem čierne pozadie a vytvárám priehľadnosť...")
                # Odstráň čierne pozadie z vygenerovaného RGB obrázka
                image = remove_black_background(image, threshold=30)
            else:
                print("💡 Tip: Pre priehľadné pozadie nahrajte PNG s priehľadnosťou")
        
        # Text-to-Image ak nie je obrázok
        else:
            print(f"🎨 Text-to-Image ({model_key}): {prompt[:50]}... [{width}x{height}]")
            pipe = model_entry.get('pipe')
            if pipe is None:
                return jsonify({'error': 'Text-to-Image pipeline nie je dostupná pre požadovaný model'}), 500

            with torch.inference_mode():
                image = pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    num_inference_steps=num_inference_steps,
                    guidance_scale=guidance_scale,
                    width=width,
                    height=height,
                    generator=generator,
                ).images[0]
        
        # Aplikuj farebný tint ak je zadaný
        if target_color:
            print(f"🎨 Aplikujem farebný tint: {target_color}")
            image = apply_color_tint(image, target_color, intensity=0.5)
        
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Hotovo!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}',
            'prompt': prompt,
            'seed': int(seed)  # Vráť použitý seed
        })
        
    except Exception as e:
        print(f"❌ Chyba: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/remove-background', methods=['POST'])
def remove_background_endpoint():
    """Odstráni pozadie z obrázka pomocou remove_black_background metódy"""
    try:
        data = request.json
        image_data = data.get('image')
        threshold = data.get('threshold', 30)  # Pre remove_black_background metódu
        
        if not image_data:
            return jsonify({'error': 'Chýba obrázok'}), 400
        
        # Dekóduj base64 obrázok
        if 'base64,' in image_data:
            image_data = image_data.split('base64,')[1]
        
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))
        
        # Konvertuj na RGB ak je potrebné
        if image.mode == 'RGBA':
            rgb_image = Image.new('RGB', image.size, (255, 255, 255))
            rgb_image.paste(image, mask=image.split()[3])
            image = rgb_image
        elif image.mode != 'RGB':
            image = image.convert('RGB')
        
        print(f"🔄 Odstraňujem čierne pozadie (prah: {threshold})...")
        result_image = remove_black_background(image, threshold=threshold)
        
        # Konvertuj späť na base64
        buffer = io.BytesIO()
        result_image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Pozadie odstránené!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}'
        })
        
    except Exception as e:
        print(f"❌ Chyba pri odstraňovaní pozadia: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/adjust-hue', methods=['POST'])
def adjust_hue_endpoint():
    """Zmení farebný odtieň obrázka bez straty kvality"""
    try:
        data = request.json
        image_data = data.get('image')
        hue_shift = data.get('hue_shift', 0)  # -180 až +180 stupňov
        
        if not image_data:
            return jsonify({'error': 'Chýba obrázok'}), 400
        
        # Dekóduj base64 obrázok
        if 'base64,' in image_data:
            image_data = image_data.split('base64,')[1]
        
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))
        
        print(f"🎨 Mením farebný odtieň (posun: {hue_shift}°)...")
        
        # Zmeň odtieň
        result_image = shift_hue(image, hue_shift)
        
        # Konvertuj späť na base64
        buffer = io.BytesIO()
        result_image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Odtieň zmenený!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}'
        })
        
    except Exception as e:
        print(f"❌ Chyba pri zmene odtieňa: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/generate-character', methods=['POST'])
def generate_character():
    """
    Generuje sériu obrázkov postavy z rôznych uhlov pohľadu.
    Vráti 4 obrázky: front, side, back, 3/4 view
    """
    try:
        data = request.json
        base_prompt = data.get('prompt', '')
        negative_prompt = data.get('negative_prompt', 'blurry, low quality, distorted, ugly, deformed, disfigured, realistic photo, photorealistic, 3d render, modern, futuristic')
        reference_image = data.get('reference_image', '')  # Base64 obrázok (voliteľný)
        model_key = data.get('model', 'dreamshaper')  # Default: dreamshaper pre characters
        
        if not base_prompt:
            return jsonify({'error': 'Prompt je povinný'}), 400
        
        # Načítaj model
        try:
            model_entry = load_pipeline(model_key)
        except Exception as e:
            return jsonify({'error': f'Nepodarilo sa načítať model: {e}'}), 500
        
        # Seed pre konzistentnosť naprieč všetkými views
        seed = data.get('seed', None)
        if seed is None:
            seed = torch.randint(0, 2**32, (1,)).item()
        
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        
        # Rozmery
        width = data.get('width', 512)
        height = data.get('height', 512)
        width = int(width // 8 * 8)
        height = int(height // 8 * 8)
        
        # Definuj views s izometrickými promptmi pre game sprites
        views = [
            {
                'name': 'south',
                'prompt': f"isometric pixel art game sprite, {base_prompt}, facing down, south view, top-down isometric angle, low poly style, clean flat colors, game asset, transparent background, simple shading, 45 degree angle",
                'seed_offset': 0
            },
            {
                'name': 'east',
                'prompt': f"isometric pixel art game sprite, {base_prompt}, facing right, east view, top-down isometric angle, low poly style, clean flat colors, game asset, transparent background, simple shading, 45 degree angle",
                'seed_offset': 1
            },
            {
                'name': 'north',
                'prompt': f"isometric pixel art game sprite, {base_prompt}, facing up, north view, top-down isometric angle, low poly style, clean flat colors, game asset, transparent background, simple shading, 45 degree angle",
                'seed_offset': 2
            },
            {
                'name': 'west',
                'prompt': f"isometric pixel art game sprite, {base_prompt}, facing left, west view, top-down isometric angle, low poly style, clean flat colors, game asset, transparent background, simple shading, 45 degree angle",
                'seed_offset': 3
            }
        ]
        
        generated_images = []
        
        # Ak je reference_image, použij img2img, inak txt2img
        use_img2img = bool(reference_image)
        init_image = None
        
        if use_img2img:
            print(f"🎭 Character Generation (img2img): {base_prompt[:50]}...")
            
            # Dekóduj reference image
            if ',' in reference_image:
                reference_image = reference_image.split(',')[1]
            
            image_data = base64.b64decode(reference_image)
            init_image = Image.open(io.BytesIO(image_data))
            
            # Konvertuj na RGB
            if init_image.mode == 'RGBA':
                rgb_image = Image.new('RGB', init_image.size, (255, 255, 255))
                rgb_image.paste(init_image, mask=init_image.split()[3])
                init_image = rgb_image
            elif init_image.mode != 'RGB':
                init_image = init_image.convert('RGB')
            
            init_image = init_image.resize((width, height))
            img2img_pipe = model_entry.get('img2img')
        else:
            print(f"🎭 Character Generation (txt2img): {base_prompt[:50]}...")
            pipe = model_entry.get('pipe')
        
        # Generuj každý view
        for view in views:
            view_seed = seed + view['seed_offset']
            generator = torch.Generator(device=device).manual_seed(view_seed)
            
            print(f"   └─ Generujem {view['name']} view (seed={view_seed})...")
            
            with torch.inference_mode():
                if use_img2img:
                    image = img2img_pipe(
                        prompt=view['prompt'],
                        negative_prompt=negative_prompt,
                        image=init_image,
                        strength=0.65,  # Menej strength pre zachovanie štýlu
                        num_inference_steps=40,
                        guidance_scale=7.5,
                        generator=generator,
                    ).images[0]
                else:
                    image = pipe(
                        prompt=view['prompt'],
                        negative_prompt=negative_prompt,
                        num_inference_steps=40,
                        guidance_scale=7.5,
                        width=width,
                        height=height,
                        generator=generator,
                    ).images[0]
            
            # Konvertuj na base64
            buffer = io.BytesIO()
            image.save(buffer, format='PNG')
            img_base64 = base64.b64encode(buffer.getvalue()).decode()
            
            generated_images.append({
                'view': view['name'],
                'image': f'data:image/png;base64,{img_base64}',
                'prompt': view['prompt'],
                'seed': view_seed
            })
        
        print("✅ Character views vygenerované!")
        
        return jsonify({
            'images': generated_images,
            'base_prompt': base_prompt,
            'base_seed': seed,
            'model': model_key
        })
        
    except Exception as e:
        print(f"❌ Chyba pri generovaní characteru: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Stable Diffusion Backend (multi-model, on-demand)")
    print("=" * 60)
    # Pokusíme sa prednačítať LITE model pre rýchlejší start (ak je to možné)
    try:
        load_pipeline('lite')
        print("\n🌐 Prednačítaný LITE model (ak bol úspešne stiahnutý)")
    except Exception as e:
        print(f"\n⚠️  Nepodarilo sa prednačítať LITE model: {e}")

    print("\n🌐 Server pripravený!")
    print("📍 URL: http://localhost:5000")
    print("⚡ Podpora pre 'lite' a 'full' modely (na požiadanie)")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=False)
