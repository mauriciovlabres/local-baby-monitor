"""Procedural white noise generator and host-side playback.

Standard library only (Termux-safe). The noise WAV is generated on first use
and cached in config/whitenoise.wav (git-ignored). Audio plays on the HOST
running the server, not in the browser.
"""

import logging
import os
import platform
import random
import shutil
import struct
import subprocess
import threading
import wave
from pathlib import Path

log = logging.getLogger("baby-monitor.whitenoise")

WAV_PATH = Path(__file__).resolve().parent.parent / "config" / "whitenoise.wav"
SAMPLE_RATE = 22050
DURATION_S = 10
CROSSFADE_S = 1.0

_lock = threading.RLock()
_proc = None            # subprocess.Popen for mpv / sox
_loop_thread = None     # re-trigger thread for players without loop support
_loop_stop = threading.Event()
_winsound_playing = False


class WhiteNoiseError(Exception):
    """Raised when audio cannot be generated or played."""


def generate_wav(path=WAV_PATH):
    """Create a seamless, gentle brown/pink-tinted noise loop."""
    n = SAMPLE_RATE * DURATION_S
    fade = int(SAMPLE_RATE * CROSSFADE_S)
    rng = random.Random()
    total = n + fade

    # Brown component (leaky integrator) + white + one-pole low-passed white
    # (rough pink tint), then normalise.
    brown = pink = 0.0
    raw = []
    for _ in range(total):
        w = rng.uniform(-1.0, 1.0)
        brown = (brown + 0.02 * w) * 0.998
        pink = pink * 0.9 + w * 0.1
        raw.append(brown * 6.0 + pink * 1.6 + w * 0.25)

    # Seamless loop: blend the extra tail into the head so end -> start is smooth.
    out = raw[:n]
    for i in range(fade):
        t = i / fade
        out[i] = raw[i] * t + raw[n + i] * (1.0 - t)

    peak = max(abs(s) for s in out) or 1.0
    scale = 0.5 * 32767 / peak  # keep it gentle: half of full scale
    frames = b"".join(struct.pack("<h", int(s * scale)) for s in out)

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(frames)
    os.replace(tmp, path)
    log.info("Generated %s", path)


def ensure_wav():
    if not WAV_PATH.exists():
        generate_wav()
    return str(WAV_PATH)


def _detect_backend():
    """Return the name of the first usable playback backend, or None."""
    if platform.system() == "Windows":
        try:
            import winsound  # noqa: F401
            return "winsound"
        except ImportError:
            return None
    if shutil.which("mpv"):
        return "mpv"
    if shutil.which("play"):
        return "sox"
    if shutil.which("termux-media-player"):
        return "termux-media-player"
    return None


def status():
    backend = _detect_backend()
    return {"playing": is_playing(), "supported": backend is not None,
            "backend": backend or "none"}


def is_playing():
    with _lock:
        if _winsound_playing:
            return True
        if _proc is not None and _proc.poll() is None:
            return True
        if _loop_thread is not None and _loop_thread.is_alive():
            return True
        return False


def _termux_loop(path):
    # termux-media-player has no loop flag: re-trigger once per cycle.
    while not _loop_stop.is_set():
        subprocess.run(["termux-media-player", "play", path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if _loop_stop.wait(DURATION_S - 0.05):
            break


def play():
    global _proc, _loop_thread, _winsound_playing
    backend = _detect_backend()
    if backend is None:
        raise WhiteNoiseError("No audio player available on this host "
                              "(install mpv or sox, or termux-api)")
    with _lock:
        if is_playing():
            return
        try:
            path = ensure_wav()
        except OSError as exc:
            raise WhiteNoiseError(f"Could not generate noise file: {exc}") from exc

        try:
            if backend == "winsound":
                import winsound
                winsound.PlaySound(path, winsound.SND_FILENAME
                                   | winsound.SND_ASYNC | winsound.SND_LOOP)
                _winsound_playing = True
            elif backend == "mpv":
                _proc = subprocess.Popen(
                    ["mpv", "--loop=inf", "--no-video", "--really-quiet", path],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            elif backend == "sox":
                _proc = subprocess.Popen(
                    ["play", "-q", path, "repeat", "999999"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:  # termux-media-player
                _loop_stop.clear()
                _loop_thread = threading.Thread(target=_termux_loop, args=(path,),
                                                daemon=True)
                _loop_thread.start()
        except (OSError, RuntimeError) as exc:
            raise WhiteNoiseError(f"Could not start audio playback: {exc}") from exc
    log.info("White noise started (%s)", backend)


def stop():
    global _proc, _loop_thread, _winsound_playing
    with _lock:
        if _winsound_playing:
            import winsound
            winsound.PlaySound(None, winsound.SND_PURGE)
            _winsound_playing = False
        if _proc is not None:
            if _proc.poll() is None:
                _proc.terminate()
                try:
                    _proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    _proc.kill()
            _proc = None
        if _loop_thread is not None:
            _loop_stop.set()
            if shutil.which("termux-media-player"):
                subprocess.run(["termux-media-player", "stop"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _loop_thread = None
    log.info("White noise stopped")


def toggle():
    if is_playing():
        stop()
    else:
        play()
