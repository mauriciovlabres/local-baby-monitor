"""Minimal ONVIF PTZ client (standard library + requests only).

Termux-safe: no zeep / onvif-zeep / lxml. Talks SOAP 1.2 with WS-Security
UsernameToken (PasswordDigest) to a TP-Link Tapo C200.

Configuration comes from the environment (config/.env):
    CAMERA_IP, CAMERA_USER, CAMERA_PASSWORD, ONVIF_PORT (default 2020)
"""

import base64
import hashlib
import logging
import os
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from xml.sax.saxutils import escape

import requests

log = logging.getLogger("baby-monitor.onvif")

DEFAULT_PROFILE_TOKEN = "profile_1"
REQUEST_TIMEOUT = 4  # seconds
SPEED = 0.4          # gentle velocity, range is -1.0 .. 1.0

# direction -> (pan, tilt)
VELOCITIES = {
    "up": (0.0, SPEED),
    "down": (0.0, -SPEED),
    "left": (-SPEED, 0.0),
    "right": (SPEED, 0.0),
}

NS_SOAP = "http://www.w3.org/2003/05/soap-envelope"
NS_TPTZ = "http://www.onvif.org/ver20/ptz/wsdl"
NS_TRT = "http://www.onvif.org/ver10/media/wsdl"
NS_TT = "http://www.onvif.org/ver10/schema"
NS_WSSE = ("http://docs.oasis-open.org/wss/2004/01/"
           "oasis-200401-wss-wssecurity-secext-1.0.xsd")
NS_WSU = ("http://docs.oasis-open.org/wss/2004/01/"
          "oasis-200401-wss-wssecurity-utility-1.0.xsd")
PW_DIGEST = ("http://docs.oasis-open.org/wss/2004/01/"
             "oasis-200401-wss-username-token-profile-1.0#PasswordDigest")
NONCE_ENC = ("http://docs.oasis-open.org/wss/2004/01/"
             "oasis-200401-wss-soap-message-security-1.0#Base64Binary")


class OnvifError(Exception):
    """ONVIF failure. `http_status` is the status the API should return."""

    def __init__(self, message, http_status=502):
        super().__init__(message)
        self.http_status = http_status


_profile_token = None
_lock = threading.Lock()


def _settings():
    ip = os.getenv("CAMERA_IP", "").strip()
    user = os.getenv("CAMERA_USER", "")
    password = os.getenv("CAMERA_PASSWORD", "")
    try:
        port = int(os.getenv("ONVIF_PORT", "2020"))
    except ValueError:
        port = 2020
    if not ip or not user:
        raise OnvifError("CAMERA_IP / CAMERA_USER are not configured", 500)
    return ip, port, user, password


def _security_header(user, password):
    """Build a WS-Security UsernameToken with PasswordDigest."""
    nonce = os.urandom(16)
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    digest = base64.b64encode(
        hashlib.sha1(nonce + created.encode() + password.encode()).digest()
    ).decode()
    return (
        f'<Security xmlns="{NS_WSSE}" xmlns:wsu="{NS_WSU}" '
        f'xmlns:s="{NS_SOAP}" s:mustUnderstand="1">'
        "<UsernameToken>"
        f"<Username>{escape(user)}</Username>"
        f'<Password Type="{PW_DIGEST}">{digest}</Password>'
        f'<Nonce EncodingType="{NONCE_ENC}">'
        f"{base64.b64encode(nonce).decode()}</Nonce>"
        f"<wsu:Created>{created}</wsu:Created>"
        "</UsernameToken></Security>"
    )


def _soap(body, user, password):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<s:Envelope xmlns:s="{NS_SOAP}">'
        f"<s:Header>{_security_header(user, password)}</s:Header>"
        f"<s:Body>{body}</s:Body></s:Envelope>"
    )


def _fault_text(xml_text):
    """Extract a readable message from a SOAP Fault, if there is one."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return xml_text[:300]
    parts = [(el.text or "").strip() for el in root.iter()
             if el.tag.endswith("}Text") or el.tag.endswith("}Value")]
    return " | ".join(p for p in parts if p) or xml_text[:300]


def _call(body):
    ip, port, user, password = _settings()
    url = f"http://{ip}:{port}/onvif/service"
    try:
        resp = requests.post(
            url,
            data=_soap(body, user, password).encode("utf-8"),
            headers={"Content-Type": "application/soap+xml; charset=utf-8"},
            timeout=REQUEST_TIMEOUT,
        )
    except requests.Timeout as exc:
        log.error("ONVIF timeout talking to %s", url)
        raise OnvifError("Camera did not respond (timeout)", 504) from exc
    except requests.RequestException as exc:
        log.error("ONVIF connection error to %s: %s", url, exc)
        raise OnvifError("Could not reach the camera", 502) from exc

    if resp.status_code != 200:
        fault = _fault_text(resp.text)
        log.error("ONVIF error HTTP %s: %s", resp.status_code, fault)
        raise OnvifError(f"Camera rejected the command ({resp.status_code}): {fault}", 502)
    return resp.text


def get_profile_token():
    """Return the PTZ profile token (cached; falls back to 'profile_1')."""
    global _profile_token
    with _lock:
        if _profile_token:
            return _profile_token
        try:
            xml_text = _call(f'<GetProfiles xmlns="{NS_TRT}"/>')
            root = ET.fromstring(xml_text)
            for el in root.iter(f"{{{NS_TRT}}}Profiles"):
                token = el.get("token")
                if token:
                    _profile_token = token
                    log.info("ONVIF profile token: %s", token)
                    return token
        except (OnvifError, ET.ParseError) as exc:
            log.warning("GetProfiles failed (%s); using %s", exc, DEFAULT_PROFILE_TOKEN)
        # Do not cache a failure: try GetProfiles again next time.
        return DEFAULT_PROFILE_TOKEN


def continuous_move(pan, tilt):
    token = get_profile_token()
    body = (
        f'<ContinuousMove xmlns="{NS_TPTZ}">'
        f"<ProfileToken>{escape(token)}</ProfileToken>"
        f'<Velocity><PanTilt xmlns="{NS_TT}" x="{pan}" y="{tilt}"/></Velocity>'
        "</ContinuousMove>"
    )
    _call(body)


def stop():
    token = get_profile_token()
    body = (
        f'<Stop xmlns="{NS_TPTZ}">'
        f"<ProfileToken>{escape(token)}</ProfileToken>"
        "<PanTilt>true</PanTilt><Zoom>false</Zoom></Stop>"
    )
    _call(body)


def move(direction):
    """Public entry point: 'up' | 'down' | 'left' | 'right' | 'stop'."""
    started = time.monotonic()
    if direction == "stop":
        stop()
    elif direction in VELOCITIES:
        pan, tilt = VELOCITIES[direction]
        continuous_move(pan, tilt)
    else:
        raise OnvifError(f"Unknown direction: {direction}", 400)
    log.info("ONVIF %s ok (%.0f ms)", direction, (time.monotonic() - started) * 1000)
