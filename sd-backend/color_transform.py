from PIL import Image
import numpy as np
import colorsys

def shift_hue(image, hue_shift):
    """
    Zmení farebný odtieň (hue) obrázka bez straty kvality.
    Zachováva sýtosť (saturation) a jas (value/brightness).
    
    Args:
        image: PIL Image objekt (RGB alebo RGBA)
        hue_shift: Posun odtieňa v stupňoch (-180 až +180)
                   0 = bez zmeny
                   +60 = posun smerom k žltej/zelenej
                   -60 = posun smerom k modrej/fialovej
    
    Returns:
        PIL Image objekt s posunutým odtieňom (rovnaký mode ako vstup)
    """
    # Ulož alpha kanál ak existuje
    has_alpha = image.mode == 'RGBA'
    if has_alpha:
        alpha_channel = image.split()[3]
        image = image.convert('RGB')
    
    # Konvertuj na numpy array a normalizuj na 0-1
    img_array = np.array(image).astype(np.float32) / 255.0
    
    # Konvertuj RGB na HSV
    hsv_array = np.zeros_like(img_array)
    for i in range(img_array.shape[0]):
        for j in range(img_array.shape[1]):
            r, g, b = img_array[i, j]
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            
            # Posun hue (odtieň) - musí byť v rozsahu 0-1
            h = (h + hue_shift / 360.0) % 1.0
            
            hsv_array[i, j] = [h, s, v]
    
    # Konvertuj HSV späť na RGB
    rgb_array = np.zeros_like(img_array)
    for i in range(hsv_array.shape[0]):
        for j in range(hsv_array.shape[1]):
            h, s, v = hsv_array[i, j]
            r, g, b = colorsys.hsv_to_rgb(h, s, v)
            rgb_array[i, j] = [r, g, b]
    
    # Konvertuj späť na 0-255 a vytvor PIL Image
    rgb_array = (rgb_array * 255).astype(np.uint8)
    result = Image.fromarray(rgb_array, 'RGB')
    
    # Obnoviť alpha kanál ak bol
    if has_alpha:
        r, g, b = result.split()
        result = Image.merge('RGBA', (r, g, b, alpha_channel))
    
    return result

def adjust_saturation(image, saturation_factor):
    """
    Upraví sýtosť farieb bez zmeny odtieňa a jasu.
    
    Args:
        image: PIL Image objekt (RGB alebo RGBA)
        saturation_factor: Násobiteľ sýtosti (0.0 - 2.0)
                          0.0 = čiernobiely
                          1.0 = pôvodná sýtosť
                          2.0 = dvojnásobná sýtosť
    
    Returns:
        PIL Image objekt s upravenou sýtosťou
    """
    has_alpha = image.mode == 'RGBA'
    if has_alpha:
        alpha_channel = image.split()[3]
        image = image.convert('RGB')
    
    img_array = np.array(image).astype(np.float32) / 255.0
    
    hsv_array = np.zeros_like(img_array)
    for i in range(img_array.shape[0]):
        for j in range(img_array.shape[1]):
            r, g, b = img_array[i, j]
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            
            # Upraviť saturation (sýtosť)
            s = min(s * saturation_factor, 1.0)
            
            hsv_array[i, j] = [h, s, v]
    
    rgb_array = np.zeros_like(img_array)
    for i in range(hsv_array.shape[0]):
        for j in range(hsv_array.shape[1]):
            h, s, v = hsv_array[i, j]
            r, g, b = colorsys.hsv_to_rgb(h, s, v)
            rgb_array[i, j] = [r, g, b]
    
    rgb_array = (rgb_array * 255).astype(np.uint8)
    result = Image.fromarray(rgb_array, 'RGB')
    
    if has_alpha:
        r, g, b = result.split()
        result = Image.merge('RGBA', (r, g, b, alpha_channel))
    
    return result

def apply_color_tint(image, target_hex, intensity=0.6):
    """
    Aplikuje farebný tint na obrázok podľa hexadecimálnej farby.
    
    Args:
        image: PIL Image objekt (RGB alebo RGBA)
        target_hex: Hexadecimálna farba (napr. '#FF0000' alebo 'FF0000')
        intensity: Intenzita tint efektu (0.0 - 1.0)
                   0.0 = žiadny efekt
                   1.0 = plný color overlay
                   0.6 = odporúčané (zachováva detaily)
    
    Returns:
        PIL Image objekt s aplikovaným farebným tintom
    """
    # Ulož alpha kanál ak existuje
    has_alpha = image.mode == 'RGBA'
    if has_alpha:
        alpha_channel = image.split()[3]
        image = image.convert('RGB')
    
    # Konvertuj hex farbu na RGB
    hex_color = target_hex.lstrip('#')
    target_r = int(hex_color[0:2], 16)
    target_g = int(hex_color[2:4], 16)
    target_b = int(hex_color[4:6], 16)
    
    # Konvertuj target RGB na HSV
    target_h, target_s, target_v = colorsys.rgb_to_hsv(
        target_r / 255.0,
        target_g / 255.0,
        target_b / 255.0
    )
    
    # Konvertuj obrázok na numpy array
    img_array = np.array(image).astype(np.float32) / 255.0
    
    # Aplikuj color tint - posun hue a zväčši saturation smerom k target farbe
    result_array = np.zeros_like(img_array)
    for i in range(img_array.shape[0]):
        for j in range(img_array.shape[1]):
            r, g, b = img_array[i, j]
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            
            # Blend hue smerom k target hue
            h = h * (1 - intensity) + target_h * intensity
            
            # Zväčši saturation aby farba bola výraznejšia
            s = min(s + (target_s - s) * intensity, 1.0)
            
            # Konvertuj späť na RGB
            r, g, b = colorsys.hsv_to_rgb(h, s, v)
            result_array[i, j] = [r, g, b]
    
    # Konvertuj späť na 0-255
    result_array = (result_array * 255).astype(np.uint8)
    result = Image.fromarray(result_array, 'RGB')
    
    # Obnoviť alpha kanál
    if has_alpha:
        r, g, b = result.split()
        result = Image.merge('RGBA', (r, g, b, alpha_channel))
    
    return result

# Test
if __name__ == "__main__":
    test_img = Image.new('RGB', (100, 100), (255, 0, 0))  # Červená
    result = shift_hue(test_img, 120)  # Posun o 120° -> zelená
    print(f"✅ Test úspešný: {result.mode}, veľkosť {result.size}")
