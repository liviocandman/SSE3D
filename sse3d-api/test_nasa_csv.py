import asyncio
import httpx

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"

async def test_nasa():
    target_date = "2024-03-16"
    stop_date = "2024-03-17"
    params = {
        "format": "json",
        "COMMAND": "'499'", # Mars
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "'500@10'",
        "START_TIME": f"'{target_date}'",
        "STOP_TIME": f"'{stop_date}'",
        "STEP_SIZE": "'1 d'",
        "VEC_TABLE": "'3'",
        "REF_PLANE": "ECLIPTIC",
        "OUT_UNITS": "'AU-D'",
        "CSV_FORMAT": "YES",
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(HORIZONS_URL, params=params)
        data = response.json()
        result = data.get("result", "")
        
        soe = result.find("$$SOE")
        eoe = result.find("$$EOE")
        if soe != -1 and eoe != -1:
            csv_content = result[soe+5:eoe].strip()
            print(f"CSV Content:\n{csv_content}")
            lines = csv_content.splitlines()
            print(f"Number of lines: {len(lines)}")
            for i, line in enumerate(lines):
                print(f"Line {i}: {line}")

if __name__ == "__main__":
    asyncio.run(test_nasa())
