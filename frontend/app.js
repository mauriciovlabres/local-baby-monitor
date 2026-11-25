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

async function sendPtz(direction) {
  if (direction === "left") ptz.x = Math.max(-200, ptz.x - STEP);
  if (direction === "right") ptz.x = Math.min(200, ptz.x + STEP);
  if (direction === "up") ptz.y = Math.max(-110, ptz.y - STEP);
  if (direction === "down") ptz.y = Math.min(110, ptz.y + STEP);
  if (direction === "stop") { ptz.x = 0; ptz.y = 0; }
  try {
    const res = await fetch("/api/ptz/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    if (!res.ok) console.warn("PTZ request failed:", res.status);
  } catch (err) {
    console.warn("PTZ request error:", err);
  }
}

document.querySelectorAll("[data-dir]").forEach((btn) => {
  btn.addEventListener("click", () => sendPtz(btn.dataset.dir));
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
const wakeBtn = $("wakeBtn");
let wakeLock = null;
let wakeWanted = false;

function renderWake() {
  const on = !!wakeLock;
  $("wakeLabel").textContent = "Keep Screen On: " + (on ? "ON" : "OFF");
  $("wakeDot").classList.toggle("on", on);
  wakeBtn.setAttribute("aria-pressed", String(on));
  wakeBtn.classList.toggle("on", on);
}
async function acquireWake() {
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; renderWake(); });
  } catch (err) {
    console.warn("Wake Lock failed:", err);
    wakeLock = null;
    wakeWanted = false;
  }
  renderWake();
}
if (!("wakeLock" in navigator)) {
  wakeBtn.disabled = true;
  $("wakeLabel").textContent = "Keep Screen On: N/A";
  $("wakeHint").hidden = false;
} else {
  wakeBtn.addEventListener("click", async () => {
    if (wakeLock) {
      wakeWanted = false;
      await wakeLock.release();
    } else {
      wakeWanted = true;
      await acquireWake();
    }
  });
  // The lock is released when the tab is hidden; re-acquire on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeWanted && !wakeLock) acquireWake();
  });
}
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
