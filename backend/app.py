"""Local Baby Monitor - Flask backend.

Serves the static frontend and exposes a small REST API.
Configuration is read from config/.env (optional; sane defaults apply).
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
ENV_FILE = BASE_DIR / "config" / ".env"

# Missing .env is fine: load_dotenv simply returns False.
load_dotenv(ENV_FILE)


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


MOCK_MODE = env_bool("MOCK_MODE", True)
GO2RTC_URL = os.getenv("GO2RTC_URL", "http://localhost:1984")
try:
    SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
except ValueError:
    SERVER_PORT = 8000

VALID_DIRECTIONS = {"up", "down", "left", "right", "stop"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("baby-monitor")

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")


def send_onvif_ptz(direction: str) -> None:
    """Send a PTZ command to the Tapo C200 via ONVIF.

    TODO: Implement using CAMERA_IP, CAMERA_USER, CAMERA_PASSWORD and
    ONVIF_PORT (default 2020) read from the environment. Credentials must
    stay in the backend and never be exposed to the frontend.
    Suggested mapping: up/down/left/right -> ContinuousMove with a velocity
    vector; stop -> Stop.
    """
    raise NotImplementedError("ONVIF PTZ is not implemented yet")


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/config")
def get_config():
    return jsonify({"mock_mode": MOCK_MODE, "go2rtc_url": GO2RTC_URL})


@app.post("/api/ptz/move")
def ptz_move():
    data = request.get_json(silent=True) or {}
    direction = data.get("direction")
    if direction not in VALID_DIRECTIONS:
        return jsonify({"status": "error",
                        "message": "direction must be one of: "
                                   + ", ".join(sorted(VALID_DIRECTIONS))}), 400

    if MOCK_MODE:
        log.info("[MOCK] PTZ move: %s", direction)
        return jsonify({"status": "ok", "mock": True, "direction": direction}), 200

    try:
        send_onvif_ptz(direction)
    except NotImplementedError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 501
    except Exception:  # noqa: BLE001 - never leak camera details to the client
        log.exception("PTZ command failed")
        return jsonify({"status": "error", "message": "PTZ command failed"}), 502
    return jsonify({"status": "ok", "mock": False, "direction": direction}), 200


if __name__ == "__main__":
    log.info("Starting Local Baby Monitor on 0.0.0.0:%d (mock_mode=%s)", SERVER_PORT, MOCK_MODE)
    app.run(host="0.0.0.0", port=SERVER_PORT, debug=False)
