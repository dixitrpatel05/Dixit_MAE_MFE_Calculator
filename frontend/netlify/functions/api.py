import os
import sys
from pathlib import Path

from mangum import Mangum


CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = (CURRENT_DIR / "../../../backend").resolve()
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("APP_ENV", "production")
os.environ.setdefault("APP_DEBUG", "false")

from app.main import app  # noqa: E402


asgi_handler = Mangum(app, lifespan="off", api_gateway_base_path="/.netlify/functions")


def handler(event, context):
    return asgi_handler(event, context)
