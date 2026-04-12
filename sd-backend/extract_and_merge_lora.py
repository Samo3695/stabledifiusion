"""
Pipeline: Extract LoRA from Isometric Dreams SD2.1 → Merge into SD Turbo → Export ONNX

Steps:
  1. Pre-download models from HuggingFace
  2. Load base SD 2.1 + Isometric Dreams UNets
  3. Extract LoRA via SVD decomposition
  4. Merge extracted LoRA into SD Turbo
  5. Export merged model to ONNX
  6. Quantize to INT4 (optional)

Usage:
  python extract_and_merge_lora.py --step 1   # Download models
  python extract_and_merge_lora.py --step 2   # Extract LoRA
  python extract_and_merge_lora.py --step 3   # Merge into SD Turbo
  python extract_and_merge_lora.py --step 4   # Export to ONNX
  python extract_and_merge_lora.py --step all  # Run all steps
"""

import argparse
import gc
import os
import sys
from pathlib import Path

import torch
import numpy as np
from safetensors.torch import save_file, load_file

# Paths
WORK_DIR = Path(__file__).parent / "lora_extraction"
EXTRACTED_LORA_PATH = WORK_DIR / "isometric_dreams_lora.safetensors"
MERGED_MODEL_DIR = WORK_DIR / "sd_turbo_isometric"
ONNX_OUTPUT_DIR = WORK_DIR / "sd_turbo_isometric_onnx"

# HuggingFace model IDs
ISOMETRIC_DREAMS_ID = "EnD-Diffusers/isometric-dreams"  # SD 2.1 based, diffusers format
BASE_SD21_ID = "Manojb/stable-diffusion-2-1-base"  # Community mirror (original stabilityai repo is gated)
SD_TURBO_ID = "stabilityai/sd-turbo"

# LoRA extraction settings
LORA_RANK = 64  # Higher rank = more detail preserved from Isometric Dreams
LORA_ALPHA = 64
CLAMP_QUANTILE = 0.99  # Outlier clamping for stability


def step1_download():
    """Download model files to HuggingFace cache (without loading into RAM)."""
    print("=" * 60)
    print("STEP 1: Pre-download models from HuggingFace")
    print("=" * 60)

    from huggingface_hub import hf_hub_download

    models = [
        (ISOMETRIC_DREAMS_ID, "unet/config.json", None),
        (ISOMETRIC_DREAMS_ID, "unet/diffusion_pytorch_model.bin", None),
        (BASE_SD21_ID, "unet/config.json", None),
        (BASE_SD21_ID, "unet/diffusion_pytorch_model.safetensors", None),
        (SD_TURBO_ID, "unet/config.json", None),
        (SD_TURBO_ID, "unet/diffusion_pytorch_model.safetensors", None),
    ]

    for repo_id, filename, _ in models:
        print(f"Downloading {repo_id} / {filename}...")
        try:
            hf_hub_download(repo_id=repo_id, filename=filename)
            print("  Done")
        except Exception as e:
            print(f"  Error: {e}")
            sys.exit(1)

    print("\nAll model files downloaded to HuggingFace cache!")


def extract_lora_from_weights(base_state_dict, tuned_state_dict, rank=64, clamp_quantile=0.99):
    """
    Extract LoRA weights by computing diff and applying SVD decomposition.
    Returns a dict of LoRA weights (lora_down + lora_up for each layer).
    """
    lora_weights = {}
    processed = 0
    skipped = 0

    # Only process matching keys
    target_keys = [k for k in base_state_dict.keys() if k in tuned_state_dict]
    print(f"  Found {len(target_keys)} matching weight keys")

    for key in target_keys:
        base_w = base_state_dict[key].float()
        tuned_w = tuned_state_dict[key].float()

        # Skip if shapes don't match
        if base_w.shape != tuned_w.shape:
            skipped += 1
            continue

        # Skip non-2D weights (biases, norms, etc.) - LoRA only applies to linear/conv layers
        if len(base_w.shape) < 2:
            skipped += 1
            continue

        # Compute diff
        diff = tuned_w - base_w

        # Skip if diff is negligible
        if torch.abs(diff).max() < 1e-8:
            skipped += 1
            continue

        # For Conv2d weights (4D), reshape to 2D for SVD
        original_shape = diff.shape
        if len(diff.shape) == 4:
            diff_2d = diff.reshape(diff.shape[0], -1)
        else:
            diff_2d = diff

        # Clamp outliers for numerical stability (use percentile-based via sorting)
        abs_vals = torch.abs(diff_2d).flatten()
        k = max(1, int(abs_vals.numel() * (1.0 - clamp_quantile)))
        max_val = abs_vals.kthvalue(abs_vals.numel() - k).values.item()
        if max_val > 0:
            diff_2d = torch.clamp(diff_2d, -max_val, max_val)

        # SVD decomposition on GPU if available
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        actual_rank = min(rank, min(diff_2d.shape))
        try:
            diff_gpu = diff_2d.float().to(device)
            U, S, Vh = torch.linalg.svd(diff_gpu, full_matrices=False)
            U, S, Vh = U.cpu(), S.cpu(), Vh.cpu()
            del diff_gpu
        except Exception as e:
            print(f"  SVD failed for {key}: {e}")
            skipped += 1
            continue

        # Take top-r components
        U_r = U[:, :actual_rank]
        S_r = S[:actual_rank]
        Vh_r = Vh[:actual_rank, :]

        # Split S between up and down: up = U * sqrt(S), down = sqrt(S) * Vh
        sqrt_S = torch.sqrt(S_r)
        lora_up = U_r * sqrt_S.unsqueeze(0)     # [out_dim, rank]
        lora_down = sqrt_S.unsqueeze(1) * Vh_r   # [rank, in_dim]

        # For Conv2d, reshape lora_down back to include kernel dims
        if len(original_shape) == 4:
            lora_down = lora_down.reshape(actual_rank, original_shape[1], original_shape[2], original_shape[3])
            lora_up = lora_up.unsqueeze(-1).unsqueeze(-1)  # [out, rank, 1, 1]

        # Convert key to LoRA naming convention
        # e.g., "down_blocks.0.attentions.0.transformer_blocks.0.attn1.to_q.weight"
        # → "lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_q"
        lora_key = key.replace(".", "_").replace("_weight", "")

        lora_weights[f"{lora_key}.lora_down.weight"] = lora_down.half()
        lora_weights[f"{lora_key}.lora_up.weight"] = lora_up.half()
        lora_weights[f"{lora_key}.alpha"] = torch.tensor(LORA_ALPHA, dtype=torch.float16)

        processed += 1

        if processed % 20 == 0:
            print(f"  Processed {processed} layers...")

    print(f"  Done: {processed} layers extracted, {skipped} skipped")
    return lora_weights


def step2_extract_lora():
    """Load both UNets from HuggingFace and extract LoRA via SVD."""
    print("=" * 60)
    print("STEP 2: Extract LoRA from Isometric Dreams")
    print("=" * 60)

    if EXTRACTED_LORA_PATH.exists():
        size_mb = EXTRACTED_LORA_PATH.stat().st_size / (1024**2)
        print(f"LoRA already extracted: {EXTRACTED_LORA_PATH} ({size_mb:.1f} MB)")
        return

    from diffusers import UNet2DConditionModel

    # Load Isometric Dreams UNet in FP16 to save RAM (~1.7 GB instead of 3.4 GB)
    print("Loading Isometric Dreams UNet (FP16)...")
    iso_unet = UNet2DConditionModel.from_pretrained(
        ISOMETRIC_DREAMS_ID, subfolder="unet", torch_dtype=torch.float16,
        use_safetensors=False, low_cpu_mem_usage=True
    )
    iso_unet_state = {k: v.clone() for k, v in iso_unet.state_dict().items()}
    del iso_unet
    gc.collect()
    print(f"  Loaded {len(iso_unet_state)} keys")

    # Load base SD 2.1 UNet in FP16
    print("Loading base SD 2.1 UNet (FP16)...")
    base_unet = UNet2DConditionModel.from_pretrained(
        BASE_SD21_ID, subfolder="unet", torch_dtype=torch.float16,
        low_cpu_mem_usage=True
    )
    base_unet_state = {k: v.clone() for k, v in base_unet.state_dict().items()}
    del base_unet
    gc.collect()
    print(f"  Loaded {len(base_unet_state)} keys")

    # Extract LoRA
    print(f"Extracting LoRA (rank={LORA_RANK})...")
    lora_weights = extract_lora_from_weights(
        base_unet_state, iso_unet_state,
        rank=LORA_RANK, clamp_quantile=CLAMP_QUANTILE
    )

    del base_unet_state, iso_unet_state
    gc.collect()

    # Save LoRA
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    lora_weights = {k: v.contiguous() for k, v in lora_weights.items()}
    save_file(lora_weights, str(EXTRACTED_LORA_PATH))
    size_mb = EXTRACTED_LORA_PATH.stat().st_size / (1024**2)
    print(f"LoRA saved: {EXTRACTED_LORA_PATH} ({size_mb:.1f} MB)")


def step3_merge_into_sd_turbo():
    """Merge extracted LoRA into SD Turbo base weights."""
    print("=" * 60)
    print("STEP 3: Merge LoRA into SD Turbo")
    print("=" * 60)

    if MERGED_MODEL_DIR.exists() and (MERGED_MODEL_DIR / "unet" / "diffusion_pytorch_model.safetensors").exists():
        print(f"Merged model already exists: {MERGED_MODEL_DIR}")
        return

    if not EXTRACTED_LORA_PATH.exists():
        print(f"ERROR: LoRA not found at {EXTRACTED_LORA_PATH}")
        print("Run step 2 first.")
        sys.exit(1)

    from diffusers import AutoPipelineForText2Image

    # Load SD Turbo
    print("Loading SD Turbo from HuggingFace...")
    turbo_pipe = AutoPipelineForText2Image.from_pretrained(
        SD_TURBO_ID,
        torch_dtype=torch.float32,
        safety_checker=None,
    )

    # Load extracted LoRA weights
    print("Loading extracted LoRA weights...")
    lora_weights = load_file(str(EXTRACTED_LORA_PATH))

    # Get SD Turbo UNet state dict
    turbo_unet_state = turbo_pipe.unet.state_dict()

    # Apply LoRA: w_new = w_original + (lora_up @ lora_down) * (alpha / rank)
    print("Merging LoRA into SD Turbo UNet...")
    merged_count = 0
    failed_count = 0
    scale = LORA_ALPHA / LORA_RANK

    # Group LoRA weights by layer
    lora_layers = {}
    for key in lora_weights:
        if key.endswith(".alpha"):
            continue
        # Extract layer base name
        if ".lora_down.weight" in key:
            layer_name = key.replace(".lora_down.weight", "")
        elif ".lora_up.weight" in key:
            layer_name = key.replace(".lora_up.weight", "")
        else:
            continue
        if layer_name not in lora_layers:
            lora_layers[layer_name] = {}
        if ".lora_down.weight" in key:
            lora_layers[layer_name]["down"] = lora_weights[key].float()
        else:
            lora_layers[layer_name]["up"] = lora_weights[key].float()

    print(f"  Found {len(lora_layers)} LoRA layers to merge")

    for lora_key, weights in lora_layers.items():
        if "down" not in weights or "up" not in weights:
            continue

        # Convert LoRA key back to original weight key
        # "lora_unet_down_blocks_0_attentions_0_..." → "down_blocks.0.attentions.0...."
        original_key = lora_key.replace("_", ".") + ".weight"

        # Try to find matching key in turbo UNet
        if original_key not in turbo_unet_state:
            # Try alternative key patterns
            found = False
            for turbo_key in turbo_unet_state:
                turbo_key_normalized = turbo_key.replace(".", "_").replace("_weight", "")
                if turbo_key_normalized == lora_key:
                    original_key = turbo_key
                    found = True
                    break
            if not found:
                failed_count += 1
                continue

        lora_down = weights["down"]
        lora_up = weights["up"]

        # Compute delta: up @ down (handle conv2d case)
        if len(lora_up.shape) == 4 and len(lora_down.shape) == 4:
            # Conv2d: up is [out, rank, 1, 1], down is [rank, in, kH, kW]
            delta = torch.einsum("orij,rckl->ocij", lora_up.float(), lora_down.float())
            # Actually for our format: up=[out,rank,1,1] down=[rank,in,kH,kW]
            # We need: out_channels x in_channels x kH x kW
            delta = torch.zeros_like(turbo_unet_state[original_key].float())
            for i in range(lora_down.shape[0]):  # rank
                delta += lora_up[:, i, :, :].unsqueeze(1) * lora_down[i, :, :, :].unsqueeze(0)
        elif len(lora_up.shape) == 2 and len(lora_down.shape) == 2:
            # Linear: up is [out, rank], down is [rank, in]
            delta = lora_up @ lora_down
        else:
            # Shape mismatch between up and down
            failed_count += 1
            continue

        # Verify shape match
        if delta.shape != turbo_unet_state[original_key].shape:
            failed_count += 1
            continue

        # Merge: original + delta * scale
        turbo_unet_state[original_key] = (
            turbo_unet_state[original_key].float() + delta * scale
        ).to(turbo_unet_state[original_key].dtype)

        merged_count += 1

    print(f"  Merged {merged_count} layers, {failed_count} failed/skipped")

    # Save merged UNet back
    turbo_pipe.unet.load_state_dict(turbo_unet_state)

    # Save the full pipeline
    MERGED_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Saving merged model to {MERGED_MODEL_DIR}...")
    turbo_pipe.save_pretrained(str(MERGED_MODEL_DIR))
    print("Merged model saved!")

    del turbo_pipe, turbo_unet_state, lora_weights
    gc.collect()
    torch.cuda.empty_cache()


def step4_export_onnx():
    """Export merged UNet to ONNX FP16 using torch.onnx.export directly."""
    print("=" * 60)
    print("STEP 4: Export UNet to ONNX (FP16)")
    print("=" * 60)

    if not MERGED_MODEL_DIR.exists():
        print(f"ERROR: Merged model not found at {MERGED_MODEL_DIR}")
        print("Run step 3 first.")
        sys.exit(1)

    unet_onnx_dir = ONNX_OUTPUT_DIR / "unet"
    unet_onnx_dir.mkdir(parents=True, exist_ok=True)
    unet_onnx_path = unet_onnx_dir / "model.onnx"

    if unet_onnx_path.exists():
        size_mb = unet_onnx_path.stat().st_size / (1024 * 1024)
        print(f"UNet ONNX already exists: {unet_onnx_path} ({size_mb:.1f} MB)")
        return

    from diffusers import UNet2DConditionModel

    print("Loading merged UNet in FP16...")
    unet = UNet2DConditionModel.from_pretrained(
        str(MERGED_MODEL_DIR / "unet"),
        torch_dtype=torch.float16,
    )
    unet.eval()
    unet = unet.to("cuda")

    # SD Turbo UNet inputs: sample (latent), timestep, encoder_hidden_states
    # sample_size=64 → 512x512 images → latent 64x64, but SD Turbo uses 512x512 → 64x64
    # For the ONNX model to match schmuell/sd-turbo-ort-web: batch=1, channels=4, h=64, w=64
    batch_size = 1
    latent_h, latent_w = 64, 64
    hidden_dim = 1024  # SD 2.1 cross_attention_dim
    seq_len = 77  # CLIP max tokens

    print("Creating dummy inputs...")
    dummy_sample = torch.randn(batch_size, 4, latent_h, latent_w, dtype=torch.float16, device="cuda")
    dummy_timestep = torch.tensor([1], dtype=torch.long, device="cuda")
    dummy_encoder_hidden_states = torch.randn(batch_size, seq_len, hidden_dim, dtype=torch.float16, device="cuda")

    print(f"Exporting UNet to ONNX: {unet_onnx_path}")
    torch.onnx.export(
        unet,
        (dummy_sample, dummy_timestep, dummy_encoder_hidden_states),
        str(unet_onnx_path),
        input_names=["sample", "timestep", "encoder_hidden_states"],
        output_names=["out_sample"],
        dynamic_axes={
            "sample": {0: "batch", 2: "height", 3: "width"},
            "encoder_hidden_states": {0: "batch", 1: "sequence"},
            "out_sample": {0: "batch", 2: "height", 3: "width"},
        },
        opset_version=17,
        do_constant_folding=True,
    )

    size_mb = unet_onnx_path.stat().st_size / (1024 * 1024)
    print(f"UNet ONNX exported: {unet_onnx_path} ({size_mb:.1f} MB)")

    del unet
    gc.collect()
    torch.cuda.empty_cache()
    print("Done!")


def step5_quantize():
    """Quantize ONNX UNet to INT8 (dynamic quantization)."""
    print("=" * 60)
    print("STEP 5: Quantize UNet to INT8")
    print("=" * 60)

    if not ONNX_OUTPUT_DIR.exists():
        print(f"ERROR: ONNX model not found at {ONNX_OUTPUT_DIR}")
        print("Run step 4 first.")
        sys.exit(1)

    quantized_dir = WORK_DIR / "sd_turbo_isometric_onnx_quantized"
    quantized_unet_dir = quantized_dir / "unet"
    quantized_unet_dir.mkdir(parents=True, exist_ok=True)

    quantized_unet = quantized_unet_dir / "model.onnx"
    if quantized_unet.exists():
        size_mb = quantized_unet.stat().st_size / (1024 * 1024)
        print(f"Quantized UNet already exists: {quantized_unet} ({size_mb:.1f} MB)")
        return

    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        import onnx
        from onnx import numpy_helper, TensorProto
        from onnx.external_data_helper import convert_model_to_external_data

        unet_onnx = ONNX_OUTPUT_DIR / "unet" / "model.onnx"
        if not unet_onnx.exists():
            print(f"UNet ONNX not found at {unet_onnx}")
            sys.exit(1)

        # quantize_dynamic requires FP32 input, so convert FP16 → FP32 first
        # FP32 model is ~3.3GB, exceeds protobuf 2GB limit, so use external data format
        fp32_path = quantized_dir / "unet_fp32_temp.onnx"
        fp32_data_path = quantized_dir / "unet_fp32_temp.onnx.data"
        if fp32_path.exists() and fp32_data_path.exists():
            print(f"FP32 temp model already exists, skipping conversion: {fp32_path}")
        else:
            # Clean up any partial files from previous attempts
            fp32_path.unlink(missing_ok=True)
            fp32_data_path.unlink(missing_ok=True)
            
            print("Converting FP16 → FP32 for quantization...")
            model = onnx.load(str(unet_onnx))

            # 1) Convert all initializers from FP16 to FP32
            for initializer in model.graph.initializer:
                if initializer.data_type == TensorProto.FLOAT16:
                    arr = numpy_helper.to_array(initializer).astype(np.float32)
                    new_init = numpy_helper.from_array(arr, initializer.name)
                    initializer.CopyFrom(new_init)
            
            # 2) Update input/output types to float32
            for inp in model.graph.input:
                if inp.type.tensor_type.elem_type == TensorProto.FLOAT16:
                    inp.type.tensor_type.elem_type = TensorProto.FLOAT
            for out in model.graph.output:
                if out.type.tensor_type.elem_type == TensorProto.FLOAT16:
                    out.type.tensor_type.elem_type = TensorProto.FLOAT
            
            # 3) Clear all value_info so runtime re-infers types
            while len(model.graph.value_info) > 0:
                model.graph.value_info.pop()

            # 4) Convert FP16 tensors inside node attributes (Constant, ConstantOfShape, Cast, etc.)
            def convert_node_attrs_fp16_to_fp32(nodes):
                for node in nodes:
                    for attr in node.attribute:
                        # Cast 'to' attribute
                        if attr.name == 'to' and attr.i == TensorProto.FLOAT16:
                            attr.i = TensorProto.FLOAT
                        # Tensor attributes (Constant value, ConstantOfShape value)
                        if attr.type == onnx.AttributeProto.TENSOR and attr.t.data_type == TensorProto.FLOAT16:
                            arr = numpy_helper.to_array(attr.t).astype(np.float32)
                            new_t = numpy_helper.from_array(arr)
                            attr.t.CopyFrom(new_t)
                        # Repeated tensor attributes
                        if attr.type == onnx.AttributeProto.TENSORS:
                            for i, t in enumerate(attr.tensors):
                                if t.data_type == TensorProto.FLOAT16:
                                    arr = numpy_helper.to_array(t).astype(np.float32)
                                    new_t = numpy_helper.from_array(arr)
                                    t.CopyFrom(new_t)
                        # Sub-graph attributes (If, Loop, Scan nodes)
                        if attr.type == onnx.AttributeProto.GRAPH and attr.g:
                            for init in attr.g.initializer:
                                if init.data_type == TensorProto.FLOAT16:
                                    arr = numpy_helper.to_array(init).astype(np.float32)
                                    new_init = numpy_helper.from_array(arr, init.name)
                                    init.CopyFrom(new_init)
                            for inp in attr.g.input:
                                if inp.type.tensor_type.elem_type == TensorProto.FLOAT16:
                                    inp.type.tensor_type.elem_type = TensorProto.FLOAT
                            for out in attr.g.output:
                                if out.type.tensor_type.elem_type == TensorProto.FLOAT16:
                                    out.type.tensor_type.elem_type = TensorProto.FLOAT
                            convert_node_attrs_fp16_to_fp32(attr.g.node)

            convert_node_attrs_fp16_to_fp32(model.graph.node)
            print("Converted all FP16 references (initializers, inputs, outputs, node attrs)")

            # 5) Ensure ai.onnx opset domain is present (required by quantize_dynamic)
            has_onnx_domain = any(
                op.domain == '' or op.domain == 'ai.onnx'
                for op in model.opset_import
            )
            if not has_onnx_domain:
                opset = model.opset_import.add()
                opset.domain = ''
                opset.version = 17
                print("Added missing ai.onnx opset domain")

            # Save with external data format to avoid 2GB protobuf limit
            convert_model_to_external_data(
                model,
                all_tensors_to_one_file=True,
                location="unet_fp32_temp.onnx.data",
                size_threshold=1024,
            )
            onnx.save(model, str(fp32_path))
            del model
            gc.collect()
            print(f"FP32 temp model saved (external data): {fp32_path}")

        original_size = unet_onnx.stat().st_size / (1024 * 1024)
        
        print(f"Quantizing UNet to INT8 (dynamic)...")
        quantize_dynamic(
            str(fp32_path),
            str(quantized_unet),
            weight_type=QuantType.QUInt8,
            use_external_data_format=False,
        )

        quantized_size = quantized_unet.stat().st_size / (1024 * 1024)
        print(f"UNet: {original_size:.1f} MB → {quantized_size:.1f} MB ({100*quantized_size/original_size:.0f}%)")
        print(f"Quantized UNet saved to: {quantized_unet}")

        # Cleanup temp FP32 files
        fp32_path.unlink(missing_ok=True)
        fp32_data_path.unlink(missing_ok=True)
        print("Cleaned up temp FP32 files.")

    except ImportError as e:
        print(f"Quantization tools not available: {e}")
        print("Install: pip install onnxruntime")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Extract LoRA from Isometric Dreams → Merge into SD Turbo")
    parser.add_argument("--step", type=str, required=True,
                        choices=["1", "2", "3", "4", "5", "all"],
                        help="Which step to run (1-5 or 'all')")
    parser.add_argument("--rank", type=int, default=64,
                        help="LoRA rank for extraction (default: 64)")

    args = parser.parse_args()

    global LORA_RANK, LORA_ALPHA
    LORA_RANK = args.rank
    LORA_ALPHA = args.rank  # alpha = rank for scale factor 1.0

    print(f"Work directory: {WORK_DIR}")
    print(f"LoRA rank: {LORA_RANK}")
    print()

    if args.step == "1" or args.step == "all":
        step1_download()
        print()

    if args.step == "2" or args.step == "all":
        step2_extract_lora()
        print()

    if args.step == "3" or args.step == "all":
        step3_merge_into_sd_turbo()
        print()

    if args.step == "4" or args.step == "all":
        step4_export_onnx()
        print()

    if args.step == "5" or args.step == "all":
        step5_quantize()
        print()

    print("Done!")


if __name__ == "__main__":
    main()
