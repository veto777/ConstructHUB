import os
import piexif
from PIL import Image
import csv
from openai import OpenAI

# === BUSINESS INFO ===
COMPANY_NAME = "Alpine Exteriors | Siding, Roofing & Windows"
PHONE = "(360) 543-4799"
ADDRESS = "2119 Lincoln St, Bellingham, WA 98225"
COPYRIGHT = "© Alpine Exteriors 2025"
WEBSITE = "https://alpineexteriorswa.com"
SERVICES = "Decking, Siding, Roofing, Windows, Doors, Gutters, Painting, Soffits, Exteriors"

# === OPENAI ===
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY") or "YOUR_OPENAI_KEY_HERE")

# === FIXED PROJECT LOCATION (NOT DISPLAYED IN DESCRIPTION) ===
TARGET_CITY = "Sudden Valley"
TARGET_COUNTY = "Whatcom County, WA"
FIXED_ADDRESS = "24 Clematis Ln, Sudden Valley, WA 98229"

# OPTIONAL GPS (leave None if not embedding coordinates)
FIXED_LAT = None
FIXED_LON = None

# === ROOFING KEYWORDS ===
ROOFING_KEYWORDS = [
    "Roofing Company Near Me",
    "Roofers Near Me",
    "Roofing Contractor",
    "Roof Replacement",
    "Emergency Roof Repair",
    "Residential Roofing",
    "Commercial Roofing Contractor",
    "Roof Leak Repair",
    "GAF Roofing Contractor",
    "GAF Timberline Roofing",
    "GAF Timberline HDZ Roofing",
    "GAF HDZ Roofing Contractor",
    "GAF Timberline HDZ Shingle Installer",
    "GAF Lifetime Roofing System",
    "Certified GAF Roofing Contractor",
    "GAF StormGuard Roofing",
    "GAF Energy Solar Shingles Contractor"
]

# === GPS helper ===
def to_deg(value, ref):
    deg = int(value)
    min_float = (value - deg) * 60
    minute = int(min_float)
    second = round((min_float - minute) * 60 * 100)
    return ((deg, 1), (minute, 1), (second, 100)), ref

# === Generate SEO comment (NO street address allowed) ===
def generate_comment(city, county, keyword, service="roofing"):
    prompt = (
        f"Write a detailed SEO-rich description (at least 250 characters) "
        f"about Alpine Exteriors completing a {service} project in {city}, {county}. "
        f"Do NOT mention any street address. "
        f"Naturally include the keyword '{keyword}' and always include the website {WEBSITE}. "
        f"Make it sound like a customer-facing project highlight."
    )
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=350,
            temperature=0.8
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"⚠️ OpenAI error: {e}")
        return (
            f"Alpine Exteriors completed a roofing project in {city}, {county}. "
            f"Learn more at {WEBSITE}."
        )

# === Embed EXIF Metadata ===
def embed_metadata(image_path, out_path, city, county, address, lat, lon, keyword, service="roofing"):
    try:
        img = Image.open(image_path)
        if img.mode != "RGB":
            img = img.convert("RGB")

        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": None}

        # Visible description (NO STREET ADDRESS)
        description_text = (
            f"{COMPANY_NAME} | Phone: {PHONE} | HQ: {ADDRESS} | "
            f"Project Location: {city}, {county} | "
            f"Services: {SERVICES} | Website: {WEBSITE} | Keyword: {keyword}"
        )

        exif_dict["0th"][piexif.ImageIFD.Artist] = COMPANY_NAME
        exif_dict["0th"][piexif.ImageIFD.Copyright] = COPYRIGHT
        exif_dict["0th"][piexif.ImageIFD.ImageDescription] = description_text

        seo_comment = generate_comment(city, county, keyword, service)
        seo_tag = f"{city}, {county}, {keyword}, Alpine Exteriors, {WEBSITE}"

        exif_dict["0th"][piexif.ImageIFD.XPComment] = seo_comment.encode("utf-16le")
        exif_dict["0th"][piexif.ImageIFD.XPKeywords] = seo_tag.encode("utf-16le")
        exif_dict["0th"][piexif.ImageIFD.Rating] = 99

        # Optional GPS embedding
        if lat is not None and lon is not None:
            lat_deg, lat_ref = to_deg(abs(lat), "N" if lat >= 0 else "S")
            lon_deg, lon_ref = to_deg(abs(lon), "E" if lon >= 0 else "W")
            exif_dict["GPS"][piexif.GPSIFD.GPSLatitude] = lat_deg
            exif_dict["GPS"][piexif.GPSIFD.GPSLatitudeRef] = lat_ref
            exif_dict["GPS"][piexif.GPSIFD.GPSLongitude] = lon_deg
            exif_dict["GPS"][piexif.GPSIFD.GPSLongitudeRef] = lon_ref

        exif_bytes = piexif.dump(exif_dict)
        img.save(out_path, "JPEG", exif=exif_bytes)

        return True, seo_comment

    except Exception as e:
        print(f"❌ Error on {image_path}: {e}")
        return False, None

# === MAIN ===
def main(MAX_OUTPUT=150):
    KEYWORDS = ROOFING_KEYWORDS
    city = TARGET_CITY
    county = TARGET_COUNTY
    address = FIXED_ADDRESS
    lat = FIXED_LAT
    lon = FIXED_LON

    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_folder = script_dir
    output_folder = os.path.join(script_dir, "output_photos")
    os.makedirs(output_folder, exist_ok=True)

    log_file = os.path.join(output_folder, "log_roofing_sudden_valley_hidden_address.csv")

    with open(log_file, "w", newline="", encoding="utf-8") as csvfile:
        logwriter = csv.writer(csvfile)
        logwriter.writerow(["Filename", "City", "County", "Keyword", "Address", "Latitude", "Longitude", "Comment"])

        files = [f for f in os.listdir(input_folder) if f.lower().endswith((".jpg", ".jpeg", ".png"))]

        if not files:
            print("⚠️ No images found.")
            return

        if MAX_OUTPUT:
            files = files[:MAX_OUTPUT]

        total = len(files)
        print(f"ℹ️ Processing {total} photos for roofing in {city} (street hidden)")

        for i, file in enumerate(files, start=1):
            keyword = KEYWORDS[i % len(KEYWORDS)]

            safe_keyword = keyword.replace(" ", "-")
            new_name = f"AlpineExteriorsWA-roofing-{city}-{safe_keyword}-{i}.jpg"

            in_path = os.path.join(input_folder, file)
            out_path = os.path.join(output_folder, new_name)

            success, comment = embed_metadata(
                in_path,
                out_path,
                city,
                county,
                address,
                lat,
                lon,
                keyword,
                "roofing"
            )

            if success:
                logwriter.writerow([new_name, city, county, keyword, address, lat, lon, comment])
                print(f"[{i}/{total}] ✅ {new_name}")

    print(f"✅ Finished! Log saved at {log_file}")

# === RUN ===
if __name__ == "__main__":
    MAX_OUTPUT = 250
    main(MAX_OUTPUT)