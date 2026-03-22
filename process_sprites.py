import os
from PIL import Image

def process_conservative():
    in_path = 'frontend/public/assets/sprites/mp_conservative.png'
    out_sheet_path = 'frontend/public/assets/sprites/mp_conservative_sheet.png'
    
    with open(in_path, 'rb') as f:
        in_bytes = f.read()
    
    # 1. Remove background with rembg
    from rembg import remove, new_session
    print("Removing background with rembg...")
    session = new_session("u2net")
    out_bytes = remove(in_bytes, session=session)
    
    import io
    img = Image.open(io.BytesIO(out_bytes)).convert('RGBA')
    width, height = img.size
    
    pixels = img.load()
    
    # 2. Cleanup stray low-opacity pixels to zero to avoid artifacts
    min_x, max_x, min_y, max_y = width, 0, height, 0
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] < 30:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
                
    if max_x < min_x: 
        print("Empty image after bg removal?")
        return
        
    print(f"Global Bounding Box: {min_x},{min_y} - {max_x},{max_y}")
    
    # Create x profile
    x_profile = [0] * width
    for x in range(min_x, max_x + 1):
        for y in range(min_y, max_y + 1):
            if pixels[x, y][3] > 0:
                x_profile[x] += 1
                
    segments = []
    in_seg = False
    start_x = 0
    for x in range(width):
        if x_profile[x] > 0 and not in_seg:
            in_seg = True
            start_x = x
        elif x_profile[x] == 0 and in_seg:
            in_seg = False
            if x - start_x > 5:
                segments.append((start_x, x - 1))
                
    if in_seg and width - start_x > 5:
        segments.append((start_x, width - 1))
        
    if len(segments) >= 3:
        segments.sort(key=lambda s: s[1]-s[0], reverse=True)
        segments = sorted(segments[:3], key=lambda s: s[0])
    else:
        print("Could not find 3 distinct segments. Splitting global bbox by 3.")
        w_third = (max_x - min_x + 1) // 3
        segments = [
            (min_x, min_x + w_third - 1),
            (min_x + w_third, min_x + 2*w_third - 1),
            (min_x + 2*w_third, max_x)
        ]
        
    frames = []
    for seg in segments:
        s_min_x, s_max_x = seg
        s_min_y, s_max_y = height, 0
        has_pixels = False
        for y in range(min_y, max_y + 1):
            for x in range(s_min_x, s_max_x + 1):
                if pixels[x, y][3] > 0:
                    has_pixels = True
                    if y < s_min_y: s_min_y = y
                    if y > s_max_y: s_max_y = y
        if has_pixels:
            frames.append((s_min_x, s_min_y, s_max_x, s_max_y))
        else:
            frames.append((s_min_x, min_y, s_max_x, max_y)) # fallback

    max_w = max((f[2] - f[0] + 1) for f in frames)
    max_h = max((f[3] - f[1] + 1) for f in frames)
    
    # Give a bit of margin
    max_w += 4
    max_h += 4
    
    out_w = max_w * 3
    out_h = max_h
    out = Image.new('RGBA', (out_w, out_h), (0,0,0,0))
    
    for i, f_b in enumerate(frames):
        f_min_x, f_min_y, f_max_x, f_max_y = f_b
        w = f_max_x - f_min_x + 1
        h = f_max_y - f_min_y + 1
        
        c = img.crop((f_min_x, f_min_y, f_max_x + 1, f_max_y + 1))
        
        x_offset = i * max_w + (max_w - w) // 2
        y_offset = max_h - h - 2
        
        out.paste(c, (x_offset, y_offset))
        
    out.save(out_sheet_path)
    print(f"Saved cons sheet: {out_w}x{out_h}, frameWidth: {max_w}")

def process_radical():
    in_path = 'frontend/public/assets/sprites/mp_radical.png'
    out_sheet_path = 'frontend/public/assets/sprites/mp_radical_sheet.png'
    
    with open(in_path, 'rb') as f:
        in_bytes = f.read()
        
    from rembg import remove, new_session
    print("Removing background with rembg for radical...")
    session = new_session("u2net")
    out_bytes = remove(in_bytes, session=session)
    
    import io
    img = Image.open(io.BytesIO(out_bytes)).convert('RGBA')
    width, height = img.size
    pixels = img.load()
    
    min_x, max_x, min_y, max_y = width, 0, height, 0
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] < 30:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
                
    if max_x < min_x: 
        min_x, max_x = 0, width-1
        min_y, max_y = 0, height-1
        
    grid_w = (max_x - min_x + 1) / 5.0
    grid_h = (max_y - min_y + 1) / 2.0
    
    print(f"Rad MP global BBox: {min_x},{min_y} - {max_x},{max_y}")
    
    regions = [
        (min_x, min_y, min_x + grid_w, min_y + grid_h),
        (min_x + grid_w, min_y, min_x + grid_w*2, min_y + grid_h),
        (min_x + grid_w, min_y + grid_h, min_x + grid_w*2, min_y + grid_h*2)
    ]
    
    frames = []
    for (r_min_x, r_min_y, r_max_x, r_max_y) in regions:
        r_min_x, r_min_y = int(r_min_x), int(r_min_y)
        r_max_x, r_max_y = int(r_max_x), int(r_max_y)
        f_min_x, f_max_x = r_max_x, r_min_x
        f_min_y, f_max_y = r_max_y, r_min_y
        has_pixels = False
        
        for y in range(r_min_y, min(r_max_y, height)):
            for x in range(r_min_x, min(r_max_x, width)):
                if pixels[x, y][3] > 0:
                    has_pixels = True
                    if x < f_min_x: f_min_x = x
                    if x > f_max_x: f_max_x = x
                    if y < f_min_y: f_min_y = y
                    if y > f_max_y: f_max_y = y
                    
        if has_pixels:
            frames.append((f_min_x, f_min_y, f_max_x, f_max_y))
        else:
            frames.append((r_min_x, r_min_y, r_max_x, r_max_y))
            
    max_w = max((f[2] - f[0] + 1) for f in frames)
    max_h = max((f[3] - f[1] + 1) for f in frames)
    
    max_w = (max_w + 1) // 2 * 2 + 4
    max_h = (max_h + 1) // 2 * 2 + 4
    
    out_w = max_w * 3
    out_h = max_h
    out = Image.new('RGBA', (out_w, out_h), (0,0,0,0))
    
    for i, f_b in enumerate(frames):
        f_min_x, f_min_y, f_max_x, f_max_y = f_b
        w = f_max_x - f_min_x + 1
        h = f_max_y - f_min_y + 1
        c = img.crop((f_min_x, f_min_y, f_max_x + 1, f_max_y + 1))
        
        x_offset = i * max_w + (max_w - w) // 2
        y_offset = max_h - h - 2
        
        out.paste(c, (x_offset, y_offset))
        
    out.save(out_sheet_path)
    print(f"Saved rad sheet: {out_w}x{out_h}, frameWidth: {max_w}")

process_conservative()
process_radical()
