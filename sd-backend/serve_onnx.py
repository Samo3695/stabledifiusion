"""Simple CORS-enabled HTTP server for serving ONNX model files locally."""
import http.server
import os
import sys

MODELS = {
    "fp16": {
        "port": 8766,
        "dir": os.path.join(os.path.dirname(__file__), "lora_extraction", "sd_turbo_isometric_onnx"),
    },
    "quantized": {
        "port": 8767,
        "dir": os.path.join(os.path.dirname(__file__), "lora_extraction", "sd_turbo_isometric_onnx_quantized"),
    },
}

def make_cors_handler(serve_dir):
    class CORSHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=serve_dir, **kwargs)

        def end_headers(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Range")
            self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range")
            super().end_headers()

        def do_OPTIONS(self):
            self.send_response(200)
            self.end_headers()
    return CORSHandler

if __name__ == "__main__":
    model_key = sys.argv[1] if len(sys.argv) > 1 else "fp16"
    if model_key not in MODELS:
        print(f"Usage: python serve_onnx.py [{' | '.join(MODELS.keys())}]")
        sys.exit(1)
    
    config = MODELS[model_key]
    port = config["port"]
    serve_dir = config["dir"]
    
    print(f"Serving {model_key} ONNX files from: {serve_dir}")
    print(f"UNet URL: http://localhost:{port}/unet/model.onnx")
    print(f"Server running at http://localhost:{port}")
    with http.server.HTTPServer(("", port), make_cors_handler(serve_dir)) as httpd:
        httpd.serve_forever()
