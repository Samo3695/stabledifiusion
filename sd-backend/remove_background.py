from PIL import Image
import numpy as np
from scipy import ndimage

def remove_black_background(image, threshold=30):
    """
    Odstráni čierne pozadie z RGB obrázka pomocou flood-fill algoritmu.
    Zachová čierne farby vo vnútri objektov (uzavreté oblasti).
    
    Args:
        image: PIL Image objekt (RGB)
        threshold: Prahová hodnota (0-255). Pixely tmavšie ako táto hodnota budú priehľadné.
    
    Returns:
        PIL Image objekt (RGBA) s priehľadným čiernym pozadím
    """
    # Konvertuj na numpy array
    img_array = np.array(image)
    
    # Vypočítaj jas každého pixelu (priemer RGB hodnôt)
    brightness = img_array.mean(axis=2)
    
    # Nájdi tmavé pixely (potenciálne pozadie)
    dark_mask = brightness <= threshold
    
    # Flood-fill z okrajov obrázka - nájdi len pozadie, nie uzavreté tmavé oblasti
    background_mask = np.zeros_like(dark_mask, dtype=bool)
    
    # Skúmaj všetky 4 okraje
    h, w = dark_mask.shape
    
    # Flood fill pomocou scipy ndimage
    # Vytvor masku ktorá označí všetky tmavé pixely spojené s okrajmi
    seed_mask = np.zeros_like(dark_mask, dtype=bool)
    
    # Označíme okraje ako seed pointy
    seed_mask[0, :] = dark_mask[0, :]  # Horný okraj
    seed_mask[-1, :] = dark_mask[-1, :]  # Dolný okraj
    seed_mask[:, 0] = dark_mask[:, 0]  # Ľavý okraj
    seed_mask[:, -1] = dark_mask[:, -1]  # Pravý okraj
    
    # Binary dilation - rozšír seed_mask len cez tmavé oblasti
    structure = np.ones((3, 3), dtype=bool)
    
    # Iteratívne rozširovanie kým sa nedosiahne všetko spojené pozadie
    prev_mask = seed_mask.copy()
    for _ in range(max(h, w)):  # Max iterácií = väčší rozmer obrázka
        # Rozšír masku o 1 pixel vo všetkých smeroch
        expanded = ndimage.binary_dilation(prev_mask, structure=structure)
        # Obmedz len na tmavé oblasti
        background_mask = expanded & dark_mask
        
        # Ak sa nič nezmenilo, sme hotoví
        if np.array_equal(background_mask, prev_mask):
            break
        prev_mask = background_mask.copy()
    
    # Vytvor alpha kanál: pozadie = 0 (priehľadné), ostatné = 255 (nepriesvitné)
    alpha = np.where(background_mask, 0, 255).astype(np.uint8)
    
    # Pridaj alpha kanál k RGB
    rgba = np.dstack((img_array, alpha))
    
    return Image.fromarray(rgba, 'RGBA')

def remove_background_by_color(image, target_color=(0, 0, 0), tolerance=30):
    """
    Odstráni špecifickú farbu z RGB obrázka (napr. čiernu, bielu).
    
    Args:
        image: PIL Image objekt (RGB)
        target_color: Farba na odstránenie (R, G, B)
        tolerance: Tolerancia farbového rozdielu (0-255)
    
    Returns:
        PIL Image objekt (RGBA) s priehľadným pozadím
    """
    img_array = np.array(image)
    
    # Vypočítaj vzdialenosť každého pixelu od cieľovej farby
    diff = np.abs(img_array - target_color).sum(axis=2)
    
    # Vytvor alpha kanál
    alpha = np.where(diff <= tolerance * 3, 0, 255).astype(np.uint8)
    
    # Pridaj alpha kanál
    rgba = np.dstack((img_array, alpha))
    
    return Image.fromarray(rgba, 'RGBA')

# Test
if __name__ == "__main__":
    # Test príklad
    test_img = Image.new('RGB', (100, 100), (0, 0, 0))
    result = remove_black_background(test_img)
    print(f"✅ Test úspešný: {result.mode}, veľkosť {result.size}")
