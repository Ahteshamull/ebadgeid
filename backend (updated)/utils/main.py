from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from PIL import Image, ImageDraw, ImageFont
import qrcode
import requests
from io import BytesIO
import os
import re
import logging
import hmac
from urllib.parse import urlparse

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

MAX_REMOTE_BYTES = 15 * 1024 * 1024
MAX_FONT_BYTES = 5 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000

if os.getenv("NODE_ENV") == "production":
    if len(os.getenv("CERTIFICATE_INTERNAL_KEY", "")) < 32:
        raise RuntimeError("CERTIFICATE_INTERNAL_KEY must contain at least 32 characters")
    if not os.getenv("TEMPLATE_ALLOWED_HOSTS", "").strip():
        raise RuntimeError("TEMPLATE_ALLOWED_HOSTS is required")

# ------------------ Models ------------------

class FontAttributes(BaseModel):
    font_family: str = Field(min_length=1, max_length=80)
    font_size: int = Field(ge=6, le=512)
    font_color: str = Field(pattern=r"^#?[0-9A-Fa-f]{6}$")
    font_weight: Optional[str] = Field(default="", max_length=20)
    # Pixels added between characters (can be negative to tighten). Optional
    # and defaults to 0 so designs saved before this field existed render
    # exactly as they did before — same single draw.text() call, no per-
    # character loop, when this is 0.
    letter_spacing: Optional[float] = Field(default=0, ge=-20, le=100)
    # Multiplier of font_size for the gap between lines (CSS line-height
    # convention), only visible when `text` contains a newline. Defaults to
    # 1.2, a reasonable single-line-unaffected default.
    line_height: Optional[float] = Field(default=1.2, ge=0.5, le=5)
    # An org-uploaded custom font (see models/organizationAsset.js) resolved
    # to its storage URL by certificateController.js before this request is
    # ever sent -- this service never looks anything up by name itself, it
    # only ever fetches from an explicitly approved host (same allowlist as
    # load_template_image), same as template_url always has.
    font_url: Optional[str] = Field(default=None, max_length=2048)


class Position(BaseModel):
    X: int = Field(ge=-10000, le=10000)
    Y: int = Field(ge=-10000, le=10000)


class TextAttribute(BaseModel):
    text_title: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=1000)
    font_attributes: List[FontAttributes] = Field(min_length=1, max_length=10)
    positions: Position


class QRCodeAttributes(BaseModel):
    ecoding_data: str = Field(min_length=1, max_length=2048)
    X: int = Field(ge=-10000, le=10000)
    Y: int = Field(ge=-10000, le=10000)


# Simple vector primitives -- mirrors models/designSchema.js's shapeSchema
# field-for-field. No path/bezier editing, matching how far the editor
# itself goes.
class ShapeAttribute(BaseModel):
    shape_type: str = Field(pattern=r"^(rectangle|line|circle)$")
    X: int = Field(ge=-10000, le=10000)
    Y: int = Field(ge=-10000, le=10000)
    width: int = Field(ge=0, le=10000)
    height: int = Field(ge=0, le=10000)
    stroke_color: str = Field(default="#000000", pattern=r"^#?[0-9A-Fa-f]{6}$")
    fill_color: str = Field(default="", max_length=7)
    stroke_width: int = Field(default=2, ge=0, le=100)
    rotation: float = Field(default=0, ge=-360, le=360)


# An icon/sticker/AI-generated image placed on the canvas -- url must
# resolve through the same TEMPLATE_ALLOWED_HOSTS allowlist as
# template_url (see load_template_image), since it's always a
# storage.js-hosted asset, never an arbitrary external URL.
class ImageElementAttribute(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    X: int = Field(ge=-10000, le=10000)
    Y: int = Field(ge=-10000, le=10000)
    width: int = Field(ge=1, le=10000)
    height: int = Field(ge=1, le=10000)
    rotation: float = Field(default=0, ge=-360, le=360)
    opacity: float = Field(default=1, ge=0, le=1)


class CertificateRequest(BaseModel):
    certificate_code: str = Field(pattern=r"^CRED-[A-F0-9]{16}$")
    template_url: str = Field(min_length=1, max_length=2048)
    text_attributes: List[TextAttribute] = Field(max_length=100)
    shapes: List[ShapeAttribute] = Field(default_factory=list, max_length=100)
    images: List[ImageElementAttribute] = Field(default_factory=list, max_length=50)
    QR_CODE: QRCodeAttributes


# ------------------ Helper Functions ------------------

# Define fallback fonts in order of preference
FALLBACK_FONTS = [
    "Arial",
    "Helvetica", 
    "Times New Roman",
    "Georgia",
    "Verdana",
    "Trebuchet MS",
    "Comic Sans MS",
    "Impact"
]

# Common Google Fonts that usually work well
RELIABLE_GOOGLE_FONTS = [
    "Open Sans",
    "Roboto",
    "Lato",
    "Montserrat",
    "Source Sans Pro",
    "Raleway",
    "PT Sans",
    "Lora",
    "Merriweather",
    "Nunito"
]

FONT_CACHE_DIR = os.getenv("FONT_CACHE_DIR", "fonts")
os.makedirs(FONT_CACHE_DIR, exist_ok=True)


def clean_font_name(font_name: str) -> str:
    """Clean and normalize font name for URL usage"""
    return font_name.replace(" ", "+").replace("_", "+")


def try_google_font_download(font_name: str, font_weight: str = "Regular") -> Optional[str]:
    """
    Attempt to download a font from Google Fonts
    Returns the local path if successful, None if failed
    """
    clean_name = clean_font_name(font_name)
    
    # Try different weight variations
    weight_mappings = {
        "Regular": "400",
        "Bold": "700",
        "Light": "300",
        "Medium": "500",
        "SemiBold": "600",
        "ExtraBold": "800",
        "Black": "900"
    }
    
    weight_value = weight_mappings.get(font_weight, "400")
    css_url = f"https://fonts.googleapis.com/css2?family={clean_name}:wght@{weight_value}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    try:
        logger.info(f"Attempting to download font: {font_name} from {css_url}")
        
        # Get the font CSS
        css_response = requests.get(css_url, headers=headers, timeout=10)
        css_response.raise_for_status()

        # Parse the TTF/WOFF2 URL - try multiple patterns
        patterns = [
            r'url\((https://fonts.gstatic.com/[^)]+\.(?:ttf|woff2))\)',
            r'url\((https://fonts.gstatic.com/[^)]+)\)',
            r'src:\s*url\((https://fonts.gstatic.com/[^)]+)\)'
        ]
        
        font_file_url = None
        for pattern in patterns:
            match = re.search(pattern, css_response.text)
            if match:
                font_file_url = match.group(1)
                break
        
        if not font_file_url:
            logger.warning(f"Could not parse font URL for '{font_name}' from CSS response")
            return None

        # Determine file extension
        if font_file_url.endswith('.ttf'):
            ext = 'ttf'
        elif font_file_url.endswith('.woff2'):
            ext = 'woff2'
        else:
            ext = 'ttf'  # Default fallback
            
        font_filename = f"{clean_name}_{weight_value}.{ext}"
        local_path = os.path.join(FONT_CACHE_DIR, font_filename)

        # Download if not cached
        if not os.path.exists(local_path):
            logger.info(f"Downloading font file from: {font_file_url}")
            font_file = requests.get(font_file_url, headers=headers, timeout=15)
            font_file.raise_for_status()
            
            with open(local_path, "wb") as f:
                f.write(font_file.content)
            logger.info(f"Font cached successfully: {local_path}")

        return local_path

    except Exception as e:
        logger.warning(f"Failed to download Google Font '{font_name}': {e}")
        return None


def try_system_font(font_name: str) -> Optional[str]:
    """
    Try to find a system font by name
    Returns the font name if successful, None if not found
    """
    try:
        # Try to load the system font directly
        test_font = ImageFont.truetype(font_name, 12)
        logger.info(f"Found system font: {font_name}")
        return font_name
    except (OSError, IOError):
        # Try common system font paths
        common_paths = [
            f"/System/Library/Fonts/{font_name}.ttf",  # macOS
            f"/usr/share/fonts/truetype/{font_name.lower()}/{font_name}.ttf",  # Linux
            f"C:\\Windows\\Fonts\\{font_name}.ttf",  # Windows
            f"/usr/share/fonts/{font_name}.ttf",  # Linux alternative
        ]
        
        for path in common_paths:
            if os.path.exists(path):
                logger.info(f"Found system font at: {path}")
                return path
        
        logger.warning(f"System font '{font_name}' not found")
        return None


def get_or_download_font(font_name: str, font_weight: str = "Regular") -> str:
    """Resolve only pre-bundled fonts; certificate rendering never downloads code or assets."""
    normalized = re.sub(r"[^A-Za-z0-9+ _-]", "", font_name).strip().lower()
    weight = re.sub(r"[^A-Za-z0-9]", "", font_weight or "Regular").lower()
    for filename in sorted(os.listdir(FONT_CACHE_DIR)):
        candidate = os.path.join(FONT_CACHE_DIR, filename)
        stem = os.path.splitext(filename)[0].lower().replace("+", " ").replace("_", " ")
        if normalized and normalized.replace("+", " ").replace("_", " ") in stem:
            if weight in {"", "regular"} or weight in stem:
                return candidate
    for fallback in ("Roboto.ttf", "Helvetica_400.ttf", "Georgia_700.ttf"):
        candidate = os.path.join(FONT_CACHE_DIR, fallback)
        if os.path.isfile(candidate):
            return candidate
    return None


_CUSTOM_FONT_CACHE: dict = {}
_CUSTOM_FONT_CACHE_MAX = 50


def load_font_from_url(url: str) -> Optional[bytes]:
    """
    Fetches a custom font's raw bytes from an explicitly approved storage
    host only -- the exact same TEMPLATE_ALLOWED_HOSTS allowlist, size cap,
    and no-redirect-following as load_template_image, because a font_url is
    exactly as untrusted as a template_url (both are storage.js-hosted
    files this service was told to fetch, never an arbitrary external URL
    -- certificate rendering still never downloads code or assets from
    anywhere it wasn't explicitly told to trust).
    """
    if url in _CUSTOM_FONT_CACHE:
        return _CUSTOM_FONT_CACHE[url]
    try:
        parsed = urlparse(url)
        allowed_hosts = {value.strip().lower() for value in os.getenv("TEMPLATE_ALLOWED_HOSTS", "").split(",") if value.strip()}
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.hostname.lower() not in allowed_hosts:
            logger.warning("Rejected custom font URL: host not allowed")
            return None
        response = requests.get(url, timeout=(5, 15), stream=True, allow_redirects=False)
        response.raise_for_status()
        declared_size = int(response.headers.get("content-length", "0") or 0)
        if declared_size > MAX_FONT_BYTES:
            logger.warning("Rejected custom font: too large")
            return None
        content = bytearray()
        for chunk in response.iter_content(64 * 1024):
            content.extend(chunk)
            if len(content) > MAX_FONT_BYTES:
                logger.warning("Rejected custom font: too large")
                return None
        font_bytes = bytes(content)
        if len(_CUSTOM_FONT_CACHE) >= _CUSTOM_FONT_CACHE_MAX:
            _CUSTOM_FONT_CACHE.pop(next(iter(_CUSTOM_FONT_CACHE)))
        _CUSTOM_FONT_CACHE[url] = font_bytes
        return font_bytes
    except Exception:
        logger.warning("Failed to fetch a custom font")
        return None


def get_font(font_family: str, font_size: int, font_weight: str = "", font_url: Optional[str] = None):
    """
    Get a font with robust error handling and fallbacks
    """
    if font_url:
        font_bytes = load_font_from_url(font_url)
        if font_bytes:
            try:
                return ImageFont.truetype(BytesIO(font_bytes), font_size)
            except Exception as e:
                logger.warning(f"Custom font at font_url failed to load, falling back to bundled fonts: {e}")
    try:
        font_path = get_or_download_font(font_family, font_weight)

        if font_path:
            return ImageFont.truetype(font_path, font_size)
        else:
            # Use PIL's default font
            logger.info(f"Using PIL default font for size {font_size}")
            return ImageFont.load_default()
            
    except Exception as e:
        logger.error(f"Error loading font '{font_family}': {e}")
        # Return default font as absolute fallback
        try:
            return ImageFont.load_default()
        except:
            # If even default font fails, create a minimal font
            logger.error("Even default font failed, using minimal fallback")
            return ImageFont.load_default()


def load_template_image(url: str) -> Image.Image:
    """Load a template only from explicitly approved storage hosts."""
    try:
        parsed = urlparse(url)
        allowed_hosts = {value.strip().lower() for value in os.getenv("TEMPLATE_ALLOWED_HOSTS", "").split(",") if value.strip()}
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.hostname.lower() not in allowed_hosts:
            raise HTTPException(status_code=400, detail="Template host is not allowed")
        logger.info(f"Loading template image from: {url}")
        response = requests.get(url, timeout=(5, 20), stream=True, allow_redirects=False)
        response.raise_for_status()
        declared_size = int(response.headers.get("content-length", "0") or 0)
        if declared_size > MAX_REMOTE_BYTES:
            raise HTTPException(status_code=413, detail="Template is too large")
        content = bytearray()
        for chunk in response.iter_content(64 * 1024):
            content.extend(chunk)
            if len(content) > MAX_REMOTE_BYTES:
                raise HTTPException(status_code=413, detail="Template is too large")
        image = Image.open(BytesIO(content))
        image.verify()
        image = Image.open(BytesIO(content))
        # Ensure image is in RGBA mode for proper text overlay
        if image.mode != "RGBA":
            image = image.convert("RGBA")
        
        logger.info(f"Template image loaded successfully: {image.size}")
        return image
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to load an approved template")
        raise HTTPException(status_code=400, detail="Failed to load template")


def draw_text_attribute(draw: ImageDraw.ImageDraw, text: str, x0: int, y0: int, font, color: str, letter_spacing: float, line_height: float, font_size: int) -> None:
    """
    Draws `text` at (x0, y0), one draw.text() call per line. Multi-line
    (text containing \\n) advances Y by font_size * line_height per line —
    the CSS line-height convention, so a value of 1.0 packs lines tight and
    2.0 double-spaces them. Letter spacing has no native support in
    Pillow's draw.text(), so it's only done character-by-character (each
    char's real advance width via font.getlength(), which accounts for the
    font's own kerning/metrics rather than assuming a fixed width) when
    non-zero — the common case (letter_spacing == 0) stays exactly the
    original single-call-per-line path, so existing designs that never set
    this field render pixel-identical to before this was added.
    """
    line_advance = round(font_size * line_height)
    for index, line in enumerate(text.split("\n")):
        y = y0 + index * line_advance
        if not letter_spacing:
            draw.text((x0, y), line, fill=color, font=font)
            continue
        x = x0
        for character in line:
            draw.text((x, y), character, fill=color, font=font)
            x += font.getlength(character) + letter_spacing


def draw_shape(image: Image.Image, shape) -> None:
    """
    Draws one vector primitive (rectangle/line/circle) onto `image` in
    place. Pillow's ImageDraw has no native rotation, so a non-zero
    rotation is done by drawing the shape unrotated onto its own small
    transparent layer, rotating that layer, then pasting it back onto the
    main image (using the layer's own alpha channel as the paste mask)
    centered on the shape's original center point -- rotation=0 (the
    common case) still goes through this same path since it's just a
    0-degree rotate, keeping one code path instead of two.
    """
    stroke = shape.stroke_color if shape.stroke_color.startswith('#') else f"#{shape.stroke_color}"
    fill = None
    if shape.fill_color:
        fill = shape.fill_color if shape.fill_color.startswith('#') else f"#{shape.fill_color}"
    stroke_width = max(shape.stroke_width, 0)
    outline = stroke if stroke_width > 0 else None
    pad = stroke_width + 2

    layer = Image.new("RGBA", (shape.width + pad * 2, shape.height + pad * 2), (0, 0, 0, 0))
    layer_draw = ImageDraw.Draw(layer)
    box = [pad, pad, pad + shape.width, pad + shape.height]
    if shape.shape_type == "rectangle":
        layer_draw.rectangle(box, outline=outline, fill=fill, width=max(stroke_width, 1))
    elif shape.shape_type == "circle":
        layer_draw.ellipse(box, outline=outline, fill=fill, width=max(stroke_width, 1))
    elif shape.shape_type == "line":
        layer_draw.line(box, fill=stroke, width=max(stroke_width, 1))

    if shape.rotation:
        layer = layer.rotate(-shape.rotation, expand=True, resample=Image.BICUBIC)

    center_x = shape.X + shape.width / 2
    center_y = shape.Y + shape.height / 2
    paste_x = round(center_x - layer.width / 2)
    paste_y = round(center_y - layer.height / 2)
    image.paste(layer, (paste_x, paste_y), layer)


def draw_image_element(image: Image.Image, element) -> None:
    """
    Places one icon/sticker/asset-library image onto `image`. Reuses
    load_template_image for the actual fetch -- same trusted-host
    allowlist, size cap, and no-redirect-following a template background
    already gets, since an image element's url is always a storage.js-
    hosted asset, never an arbitrary external URL -- then resizes,
    optionally rotates (same "rotate the layer, recenter on paste"
    technique as draw_shape), and applies opacity before compositing.
    """
    asset = load_template_image(element.url)
    resized = asset.resize((max(element.width, 1), max(element.height, 1)), Image.Resampling.LANCZOS)
    if element.opacity < 1:
        alpha = resized.getchannel("A").point(lambda a: int(a * element.opacity))
        resized.putalpha(alpha)
    if element.rotation:
        resized = resized.rotate(-element.rotation, expand=True, resample=Image.BICUBIC)
    center_x = element.X + element.width / 2
    center_y = element.Y + element.height / 2
    paste_x = round(center_x - resized.width / 2)
    paste_y = round(center_y - resized.height / 2)
    image.paste(resized, (paste_x, paste_y), resized)


def generate_qr_code(data: str, size: int = 150) -> Image.Image:
    """Generate QR code with error handling"""
    try:
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_H,
            box_size=10,
            border=1,
        )
        qr.add_data(data)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
        return img.resize((size, size), Image.Resampling.LANCZOS)
        
    except Exception as e:
        logger.error(f"Failed to generate QR code: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate QR code: {e}")


# ------------------ Endpoint ------------------

@app.post("/generate-certificate")
async def generate_certificate(payload: CertificateRequest, x_internal_key: str = Header(default="")):
    """
    Generate certificate with robust font handling and comprehensive error recovery
    """
    try:
        expected_key = os.getenv("CERTIFICATE_INTERNAL_KEY", "")
        if not expected_key or not hmac.compare_digest(x_internal_key, expected_key):
            raise HTTPException(status_code=401, detail="Unauthorized")
        if not re.fullmatch(r"CRED-[A-F0-9]{16}", payload.certificate_code):
            raise HTTPException(status_code=400, detail="Invalid certificate code")
        if len(payload.text_attributes) > 100:
            raise HTTPException(status_code=400, detail="Too many text elements")
        # Load template image
        image = load_template_image(payload.template_url)
        draw = ImageDraw.Draw(image)

        # Draw shapes first so they sit behind the text/QR layers, same
        # stacking order the editor uses (shapes as background elements).
        for shape in payload.shapes:
            try:
                draw_shape(image, shape)
                logger.info("Certificate shape element rendered")
            except Exception as e:
                logger.error("Certificate shape element rejected")
                raise HTTPException(status_code=422, detail="A certificate shape element is invalid")

        # Placed icon/sticker/AI-generated images -- after shapes, still
        # behind text, same background-layer stacking order.
        for element in payload.images:
            try:
                draw_image_element(image, element)
                logger.info("Certificate image element rendered")
            except Exception as e:
                logger.error("Certificate image element rejected")
                raise HTTPException(status_code=422, detail="A certificate image element is invalid")

        # Draw text with font fallbacks
        for item in payload.text_attributes:
            for font_attr in item.font_attributes:
                try:
                    font = get_font(font_attr.font_family, font_attr.font_size, font_attr.font_weight, font_attr.font_url)

                    # Validate color format
                    color = font_attr.font_color
                    if not color.startswith('#'):
                        color = f"#{color}"

                    draw_text_attribute(
                        draw,
                        item.text,
                        item.positions.X,
                        item.positions.Y,
                        font,
                        color,
                        font_attr.letter_spacing or 0,
                        font_attr.line_height or 1.2,
                        font_attr.font_size,
                    )

                    logger.info("Certificate text element rendered")
                    
                except Exception as e:
                    logger.error("Certificate text element rejected")
                    raise HTTPException(status_code=422, detail="A certificate text element is invalid")

        # Add QR Code
        try:
            qr_img = generate_qr_code(payload.QR_CODE.ecoding_data)
            image.paste(qr_img, (payload.QR_CODE.X, payload.QR_CODE.Y), qr_img)
            logger.info(f"QR code added at ({payload.QR_CODE.X}, {payload.QR_CODE.Y})")
        except Exception as e:
            logger.error(f"Error adding QR code: {e}")
            raise HTTPException(status_code=422, detail="The certificate QR code could not be generated")

        # Save to BytesIO
        buffer = BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        buffer.seek(0)

        logger.info("Certificate generated successfully")
        
        return StreamingResponse(
            buffer, 
            media_type="image/png", 
            headers={
                "Content-Disposition": f"inline; filename={payload.certificate_code}.png"
            }
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("Unexpected certificate generation failure")
        raise HTTPException(status_code=500, detail="Failed to generate certificate")


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


# Font testing endpoint
@app.get("/test-font/{font_name}")
async def test_font(font_name: str, x_internal_key: str = Header(default="")):
    """Test if a font can be loaded successfully"""
    try:
        expected_key = os.getenv("CERTIFICATE_INTERNAL_KEY", "")
        if not expected_key or not hmac.compare_digest(x_internal_key, expected_key):
            raise HTTPException(status_code=401, detail="Unauthorized")
        font_path = get_or_download_font(font_name)
        if font_path:
            return {"status": "success", "font_path": font_path, "font_name": font_name}
        else:
            return {"status": "fallback", "message": f"Font '{font_name}' not available, would use default"}
    except Exception as e:
        return {"status": "error", "error": str(e), "font_name": font_name}
