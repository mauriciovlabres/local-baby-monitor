"""Local Baby Monitor - Flask backend.

Serves the static frontend and exposes a small REST API.
Configuration is read from config/.env (optional; sane defaults apply).
"""

import atexit
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

import onvif_ptz
import whitenoise
from onvif_ptz import OnvifError

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

    Credentials are read from the environment inside onvif_ptz and never
    reach the frontend. Raises OnvifError on failure.
    """
    onvif_ptz.move(direction)


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
    except OnvifError as exc:
        log.error("PTZ '%s' failed: %s", direction, exc)
        return jsonify({"status": "error", "message": "PTZ command failed"}), exc.http_status
    except Exception:  # noqa: BLE001 - never leak camera details to the client
        log.exception("PTZ command failed")
        return jsonify({"status": "error", "message": "PTZ command failed"}), 500
    return jsonify({"status": "ok", "mock": False, "direction": direction}), 200


@app.get("/api/whitenoise")
def whitenoise_status():
    return jsonify(whitenoise.status())


@app.post("/api/whitenoise")
def whitenoise_action():
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    actions = {"play": whitenoise.play, "stop": whitenoise.stop,
               "toggle": whitenoise.toggle}
    if action not in actions:
        return jsonify({"status": "error",
                        "message": "action must be one of: play, stop, toggle"}), 400
    try:
        actions[action]()
    except whitenoise.WhiteNoiseError as exc:
        log.error("White noise '%s' failed: %s", action, exc)
        state = whitenoise.status()
        state.update({"status": "error", "message": str(exc)})
        return jsonify(state), 503
    except Exception:  # noqa: BLE001
        log.exception("White noise failed")
        return jsonify({"status": "error", "message": "White noise failed"}), 500
    state = whitenoise.status()
    state["status"] = "ok"
    return jsonify(state), 200


if __name__ == "__main__":
    atexit.register(whitenoise.stop)
    log.info("Starting Local Baby Monitor on 0.0.0.0:%d (mock_mode=%s)", SERVER_PORT, MOCK_MODE)
    app.run(host="0.0.0.0", port=SERVER_PORT, debug=False)
