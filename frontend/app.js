"use strict";

const $ = (id) => document.getElementById(id);
const pill = $("statusPill");
const canvas = $("mockCanvas");
const video = $("liveVideo");

function setStatus(text, cls) {
  pill.textContent = text;
  pill.className = "pill " + (cls || "");
}

/* ---------------- PTZ ---------------- */
const ptz = { x: 0, y: 0 }; // crosshair offset used by the mock feed
const STEP = 30;

// Requests are chained so a "stop" can never overtake its "move".
let ptzQueue = Promise.resolve();

function postPtz(direction) {
  ptzQueue = ptzQueue.then(async () => {
    try {
      const res = await fetch("/api/ptz/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) console.warn("PTZ request failed:", direction, res.status);
    } catch (err) {
      console.warn("PTZ request error:", err);
    }
  });
  return ptzQueue;
}

function updateMockCrosshair(direction) {
  if (direction === "left") ptz.x = Math.max(-200, ptz.x - STEP);
  if (direction === "right") ptz.x = Math.min(200, ptz.x + STEP);
  if (direction === "up") ptz.y = Math.max(-110, ptz.y - STEP);
  if (direction === "down") ptz.y = Math.min(110, ptz.y + STEP);
  if (direction === "stop") { ptz.x = 0; ptz.y = 0; }
}

// Press and hold = move, release = stop. A quick tap still moves for at
// least MIN_MOVE_MS (a small nudge) before stopping.
const MIN_MOVE_MS = 200;
let activeMove = null; // { direction, startedAt, pointerId }

function endMove() {
  if (!activeMove) return;
  const { startedAt } = activeMove;
  activeMove = null;
  const wait = Math.max(0, MIN_MOVE_MS - (performance.now() - startedAt));
  setTimeout(() => {
    // A new press may have started meanwhile; it will send its own stop.
    if (!activeMove) postPtz("stop");
  }, wait);
}

document.querySelectorAll("[data-dir]").forEach((btn) => {
  const dir = btn.dataset.dir;
  if (dir === "stop") {
    btn.addEventListener("click", () => {
      activeMove = null;
      updateMockCrosshair("stop");
      postPtz("stop");
    });
    return;
  }
  btn.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    try { btn.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
    if (activeMove) return; // ignore a second finger while moving
    activeMove = { direction: dir, startedAt: performance.now(), pointerId: ev.pointerId };
    updateMockCrosshair(dir);
    postPtz(dir);
  });
  const release = (ev) => {
    if (activeMove && activeMove.pointerId === ev.pointerId) endMove();
  };
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
  btn.addEventListener("contextmenu", (ev) => ev.preventDefault());
});

// Never leave the camera spinning if the page loses focus mid-press.
window.addEventListener("blur", endMove);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") endMove();
});

/* ---------------- Audio UI ---------------- */
const muteBtn = $("muteBtn");
const meterBar = $("meterBar");
let muted = true;
let mockMode = true;
let analyser = null;

const ICON_MUTED = '<path d="M3 10h3l4-4v12l-4-4H3z"/><path d="M16 9l5 6m0-6l-5 6" stroke="currentColor" stroke-width="2" fill="none"/>';
const ICON_ON = '<path d="M3 10h3l4-4v12l-4-4H3zm13-2a5 5 0 010 8l-1-1.5a3 3 0 000-5z"/>';

function renderMute() {
  $("muteIcon").innerHTML = muted ? ICON_MUTED : ICON_ON;
  $("muteLabel").textContent = muted ? "Unmute" : "Mute";
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.classList.toggle("on", !muted);
  video.muted = muted;
}
muteBtn.addEventListener("click", () => {
  muted = !muted;
  renderMute();
  if (!mockMode && !muted) setupAudioMeter();
});
renderMute();

/* Meter: simulated in mock mode, Web Audio API in real mode. */
let meterLevel = 0;
function setupAudioMeter() {
  if (analyser || !video.srcObject || !video.srcObject.getAudioTracks().length) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(video.srcObject);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser); // not connected to destination: <video> plays the sound
}
function updateMeter(t) {
  let level = 0;
  if (mockMode) {
    level = 0.12 + 0.1 * Math.sin(t / 700) + 0.06 * Math.sin(t / 130)
      + (Math.random() < 0.01 ? 0.4 : 0);
  } else if (analyser) {
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
    level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
  }
  meterLevel += (Math.max(0, Math.min(1, level)) - meterLevel) * 0.3;
  meterBar.style.width = (meterLevel * 100).toFixed(0) + "%";
}

/* ---------------- Wake Lock ---------------- */
// Primary: native Screen Wake Lock API (secure contexts only).
// Fallback: hidden looping silent video (NoSleep technique) for plain
// http://<lan-ip> where the native API is blocked. The inline MP4 comes from
// NoSleep.js (MIT License, (c) Rich Tibbett), so no network request is needed.
const NOSLEEP_MP4 = "data:video/mp4;base64,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";

const wakeBtn = $("wakeBtn");
let wakeLock = null;       // native WakeLockSentinel, if held
let wakeWanted = false;    // user toggle state
let wakeMode = null;       // "native" | "fallback" | null
let wakeVideo = null;

function getWakeVideo() {
  if (wakeVideo) return wakeVideo;
  const v = document.createElement("video");
  v.className = "wake-video";
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.setAttribute("aria-hidden", "true");
  v.setAttribute("tabindex", "-1");
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.src = NOSLEEP_MP4;
  document.body.appendChild(v);
  wakeVideo = v;
  return v;
}

function renderWake() {
  const on = wakeWanted;
  let label = "Keep Screen On";
  if (on) label = wakeMode === "fallback" ? "Screen On (HTTP Fallback)" : "Screen On";
  $("wakeLabel").textContent = label;
  $("wakeDot").classList.toggle("on", on);
  wakeBtn.setAttribute("aria-pressed", String(on));
  wakeBtn.classList.toggle("on", on);
  wakeBtn.title = on
    ? (wakeMode === "fallback" ? "Using hidden-video fallback (insecure context)" : "Using native Wake Lock")
    : "Tap to keep the screen on";
}

function nativeAvailable() {
  return window.isSecureContext && "wakeLock" in navigator;
}

async function acquireNative() {
  if (!nativeAvailable()) return false;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
    return true;
  } catch (err) {
    console.warn("Native Wake Lock failed, using fallback:", err);
    wakeLock = null;
    return false;
  }
}

// Must be called synchronously from the click handler (user gesture).
function startFallbackVideo() {
  const p = getWakeVideo().play();
  if (p && typeof p.catch === "function") {
    p.catch((err) => console.warn("Fallback video play blocked:", err));
  }
}

async function enableWake() {
  wakeWanted = true;
  startFallbackVideo(); // synchronous, inside the user gesture
  wakeMode = "fallback";
  renderWake();
  if (await acquireNative()) {
    wakeMode = "native";
    if (wakeVideo) wakeVideo.pause(); // native lock is enough
  }
  renderWake();
}

async function disableWake() {
  wakeWanted = false;
  wakeMode = null;
  if (wakeVideo) wakeVideo.pause();
  if (wakeLock) {
    try { await wakeLock.release(); } catch (err) { console.warn(err); }
    wakeLock = null;
  }
  renderWake();
}

wakeBtn.addEventListener("click", () => {
  if (wakeWanted) disableWake();
  else enableWake(); // play() runs synchronously before the first await
});

// Native locks are released when the tab is hidden and fallback video may be
// paused by the browser: re-acquire / resume when the user comes back.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !wakeWanted) return;
  if (await acquireNative()) {
    wakeMode = "native";
    if (wakeVideo) wakeVideo.pause();
  } else {
    wakeMode = "fallback";
    startFallbackVideo();
  }
  renderWake();
});
renderWake();

/* ---------------- Mock feed ---------------- */
function startMockFeed() {
  canvas.hidden = false;
  setStatus("MOCK MODE", "mock");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const noise = ctx.createImageData(W, H);

  function frame(t) {
    // Night-vision base: dark green with a slow breathing glow.
    const g = 18 + 6 * Math.sin(t / 2000);
    ctx.fillStyle = `rgb(4, ${g.toFixed(0)}, 6)`;
    ctx.fillRect(0, 0, W, H);

    // Simple "crib" silhouette, panned opposite to the PTZ offset.
    const ox = -ptz.x * 0.6, oy = -ptz.y * 0.6;
    ctx.fillStyle = "rgba(70, 110, 80, 0.35)";
    ctx.fillRect(160 + ox, 180 + oy, 320, 110);
    ctx.fillStyle = "rgba(90, 140, 100, 0.35)";
    ctx.beginPath();
    ctx.arc(320 + ox, 200 + oy + 2 * Math.sin(t / 900), 28, 0, Math.PI * 2);
    ctx.fill();

    // Sensor grain.
    const d = noise.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 40;
      d[i] = v * 0.3; d[i + 1] = v; d[i + 2] = v * 0.3; d[i + 3] = 28;
    }
    ctx.putImageData(noise, 0, 0);

    // Crosshair shifts with PTZ.
    const cx = W / 2 + ptz.x, cy = H / 2 + ptz.y;
    ctx.strokeStyle = "rgba(120, 200, 140, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy);
    ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20);
    ctx.stroke();
    ctx.strokeRect(cx - 40, cy - 40, 80, 80);

    // Timestamp and motion indicator.
    ctx.font = "16px monospace";
    ctx.fillStyle = "rgba(120, 200, 140, 0.8)";
    ctx.fillText(new Date().toLocaleString(), 12, H - 14);
    const motion = Math.sin(t / 3000) > 0.6;
    ctx.fillStyle = motion ? "rgba(200, 120, 80, 0.9)" : "rgba(80, 100, 85, 0.6)";
    ctx.beginPath(); ctx.arc(W - 90, 22, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(motion ? "MOTION" : "IDLE", W - 78, 28);

    updateMeter(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ---------------- Real feed (go2rtc WebRTC) ---------------- */
const STREAM_NAME = "baby_cam";
const RECONNECT_MS = 3000;
let pc = null;
let reconnectTimer = null;

function resolveGo2rtcUrl(url) {
  // "localhost" in the config refers to the server, not to this browser.
  const u = new URL(url);
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(u.hostname)) {
    u.hostname = window.location.hostname;
  }
  return u.origin;
}

function scheduleReconnect(base) {
  if (reconnectTimer) return;
  setStatus("RECONNECTING...", "warn");
  if (pc) { pc.close(); pc = null; }
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWebRTC(base); }, RECONNECT_MS);
}

async function connectWebRTC(base) {
  try {
    pc = new RTCPeerConnection();
    const current = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (ev) => {
      if (video.srcObject !== ev.streams[0]) video.srcObject = ev.streams[0];
      if (!muted) setupAudioMeter();
    };
    pc.onconnectionstatechange = () => {
      if (current !== pc) return;
      if (pc.connectionState === "connected") setStatus("LIVE", "live");
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) scheduleReconnect(base);
    };

    await pc.setLocalDescription(await pc.createOffer());
    // Wait for ICE gathering so the offer carries LAN candidates.
    await new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const done = () => { if (pc.iceGatheringState === "complete") resolve(); };
      pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, 2000);
    });

    const res = await fetch(`${base}/api/webrtc?src=${encodeURIComponent(STREAM_NAME)}`, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription.sdp,
    });
    if (!res.ok) throw new Error("go2rtc responded " + res.status);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  } catch (err) {
    console.warn("WebRTC error:", err);
    scheduleReconnect(base);
  }
}

function startLiveFeed(go2rtcUrl) {
  video.hidden = false;
  analyser = null;
  setStatus("CONNECTING...", "warn");
  const base = resolveGo2rtcUrl(go2rtcUrl);
  video.addEventListener("pause", () => video.play().catch(() => {}));
  setInterval(() => updateMeter(performance.now()), 100);
  connectWebRTC(base);
}

/* ---------------- Init ---------------- */
(async function init() {
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    mockMode = !!cfg.mock_mode;
    if (mockMode) startMockFeed();
    else startLiveFeed(cfg.go2rtc_url);
  } catch (err) {
    console.error("Could not load config:", err);
    setStatus("BACKEND OFFLINE", "warn");
  }
})();

/* ---------------- Fullscreen ---------------- */
$("fsBtn").addEventListener("click", () => {
  const wrap = $("videoWrap");
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (wrap.requestFullscreen) {
    wrap.requestFullscreen().catch((err) => console.warn("Fullscreen failed:", err));
  } else if (wrap.webkitRequestFullscreen) {
    wrap.webkitRequestFullscreen();
  } else if (video.webkitEnterFullscreen && !video.hidden) {
    video.webkitEnterFullscreen(); // iOS Safari: only the <video> can go fullscreen
  }
});

/* ---------------- White Noise (plays on the host device) ---------------- */
const wnBtn = $("whiteNoiseBtn");
const wnHint = $("whiteNoiseHint");

function renderWhiteNoise(state) {
  const playing = !!(state && state.playing);
  $("whiteNoiseLabel").textContent = "White Noise: " + (playing ? "ON" : "OFF");
  $("whiteNoiseDot").classList.toggle("on", playing);
  wnBtn.setAttribute("aria-pressed", String(playing));
  wnBtn.classList.toggle("on", playing);
  if (state && state.supported === false) {
    wnBtn.disabled = true;
    wnHint.textContent = "No audio player found on the host (install mpv or sox).";
    wnHint.hidden = false;
  } else if (state && state.status === "error") {
    wnHint.textContent = state.message || "White noise failed.";
    wnHint.hidden = false;
  } else {
    wnHint.hidden = true;
  }
}

async function whiteNoiseRequest(options) {
  try {
    const res = await fetch("/api/whitenoise", options);
    renderWhiteNoise(await res.json());
  } catch (err) {
    console.warn("White noise request failed:", err);
  }
}

wnBtn.addEventListener("click", () => {
  whiteNoiseRequest({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "toggle" }),
  });
});
whiteNoiseRequest(); // sync with the server state on load
