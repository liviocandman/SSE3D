import subprocess
import os
import ssl
from urllib.request import urlopen
from pathlib import Path

SPKMERGE_EXE = Path("scripts/spkmerge.exe")
SPK_DIR = Path("kernels/spk")
LEAP_SECONDS = Path("kernels/naif0012.tls")

# Window of 100 years
START_DATE = "1950-01-01T00:00:00"
END_DATE = "2050-01-01T00:00:00"

# List updated with nep081.bsp
GIANTS = [
    "mar099.bsp", "jup365.bsp", "sat441.bsp", 
    "ura111.bsp", "nep081.bsp", "plu060.bsp"
]

def ensure_lsk():
    """Ensures the Leap Seconds Kernel exists for date calculations."""
    if not LEAP_SECONDS.exists():
        print(f"📥 Downloading Leap Seconds Kernel ({LEAP_SECONDS.name})...")
        url = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls"
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        LEAP_SECONDS.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(url, context=ctx) as response, LEAP_SECONDS.open("wb") as out:
            out.write(response.read())
        print("✅ Leap Seconds Kernel ready!\n")

def minify_kernels():
    if not SPKMERGE_EXE.exists():
        print(f"❌ Error: spkmerge.exe not found at {SPKMERGE_EXE}")
        return
        
    ensure_lsk()

    for giant in GIANTS:
        input_path = SPK_DIR / giant
        output_name = giant.replace(".bsp", "_min.bsp")
        output_path = SPK_DIR / output_name

        if not input_path.exists():
            print(f"⚠️ Warning: Original file {giant} not found. Skipping...")
            continue
        if output_path.exists():
            print(f"⏭️  {output_name} already exists.")
            continue

        print(f"✂️  Reducing {giant} with spkmerge...")

        req_file = Path("scripts/merge_setup.req")
        with open(req_file, "w") as f:
            f.write(f"LEAPSECONDS_KERNEL  = {LEAP_SECONDS.absolute().as_posix()}\n")
            f.write(f"SPK_KERNEL          = {output_path.absolute().as_posix()}\n")
            f.write(f"  SOURCE_SPK_KERNEL = {input_path.absolute().as_posix()}\n")
            f.write(f"    BEGIN_TIME      = {START_DATE}\n")
            f.write(f"    END_TIME        = {END_DATE}\n")

        try:
            subprocess.run(
                [str(SPKMERGE_EXE), str(req_file)],
                check=True,
                capture_output=True,
                text=True
            )
            
            if output_path.exists():
                new_size = output_path.stat().st_size / (1024 * 1024)
                print(f"   ✨ Success! Created {output_name} ({new_size:.1f} MB)")
            else:
                print(f"   ❌ Failed: The file {output_name} was not generated.")
            
        except subprocess.CalledProcessError as e:
            print(f"   ❌ Error in spkmerge for {giant}:\n{e.stderr or e.stdout}")
        finally:
            if req_file.exists():
                os.remove(req_file)

if __name__ == "__main__":
    minify_kernels()
    print("\n All files have been processed!")