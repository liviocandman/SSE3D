#!/usr/bin/env python
import ssl
from urllib.request import urlopen
from pathlib import Path

OUTPUT_DIR = Path("kernels/spk")

# The Golden List (Deterministic and immune to changes in NASA's HTML)
KERNELS_TO_DOWNLOAD = {
    "mar099.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/mar099.bsp",
    "jup365.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/jup365.bsp",
    "sat441.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/sat441.bsp",
    "ura111.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/a_old_versions/ura111.bsp",
    "nep081.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/a_old_versions/nep081.bsp",
    "plu060.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/plu060.bsp",
}

def download_kernel(filename: str, url: str):
    dest = OUTPUT_DIR / filename
    
    if dest.exists():
        print(f"⏭️  {filename} already exists locally. Skipping...")
        return filename

    print(f"📥 Downloading {filename}...")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with urlopen(url, context=ctx) as response, dest.open("wb") as output:
            downloaded = 0
            while True:
                chunk = response.read(1024 * 1024 * 5) # 5MB chunks
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                print(f"  ... {downloaded / (1024*1024):.1f} MB", end="\r")
        print(f"\n🚀 {filename} completed!")
        return filename
    except Exception as e:
        print(f"\n❌ Error downloading {filename}: {e}")
        return None

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    for filename, url in KERNELS_TO_DOWNLOAD.items():
        download_kernel(filename, url)
            
    print("\n🎉 Deterministic download completed!")