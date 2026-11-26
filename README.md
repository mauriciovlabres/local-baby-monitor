# Local Baby Monitor (Android Edge Server)

Repurpose an old Android smartphone (running Termux, **no root required**) into a 100% local, zero-cloud WebRTC streaming server for a TP-Link Tapo C200 camera.

## Features

- ⚡ Ultra-low latency WebRTC streaming via [`go2rtc`](https://github.com/AlexxIT/go2rtc)
- 🔒 100% local and private: no cloud, no accounts, no telemetry
- 🌙 OLED night-friendly dark UI with Screen Wake Lock
- 🔁 Auto-reconnect when the stream drops
- 🎛️ ONVIF PTZ control (pan/tilt) through a secure backend
- 📱 Runs on repurposed Android edge hardware

## Architecture

```text
[Tapo C200 Camera] ──(RTSP / ONVIF)──▶ [Old Android (Termux)]
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                                [go2rtc]         [Python Backend]
                              (WebRTC Stream)    (UI + ONVIF API)
                                    │                   │
                                    └─────────┬─────────┘
                                              ▼
                               [Phone / Tablet / PC Browser]


## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/<your-user>/local-baby-monitor.git
   cd local-baby-monitor
   ```
2. **Copy the example config files**
   ```bash
   cp config/.env.example config/.env
   cp config/go2rtc.example.yaml config/go2rtc.yaml
   ```
3. **Configure** – edit `config/.env` and `config/go2rtc.yaml` with your camera IP and the camera account (created in the Tapo app under Advanced Settings > Camera Account). Set `MOCK_MODE=false` to use the real camera.
4. **Install backend dependencies**
   ```bash
   pip install -r backend/requirements.txt
   ```
5. **Run go2rtc** (download the binary for your platform and place it in the project root)
   ```bash
   ./go2rtc -config config/go2rtc.yaml
   ```
6. **Run the backend**
   ```bash
   python backend/app.py
   ```
7. Open `http://<android-ip>:8000` from any browser on your LAN.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `CAMERA_IP` | Camera LAN IP | `192.168.0.100` |
| `CAMERA_USER` | Camera account user | – |
| `CAMERA_PASSWORD` | Camera account password | – |
| `ONVIF_PORT` | ONVIF port | `2020` |
| `GO2RTC_URL` | go2rtc API URL | `http://localhost:1984` |
| `SERVER_PORT` | Backend port | `8000` |
| `MOCK_MODE` | Simulate the camera (no hardware needed) | `true` |

## Roadmap

- [x] Project architecture
- [x] Termux setup
- [x] WebRTC dark-mode frontend with Wake Lock & auto-reconnect
- [x] Local ONVIF PTZ (Pan/Tilt) controls
- [ ] Audio level meter
- [ ] Phase 2: Remote-controlled White Noise generator

## Credits

- [`go2rtc`](https://github.com/AlexxIT/go2rtc) by Alexey Khit for WebRTC streaming.
- The silent MP4 used by the Wake Lock fallback comes from [NoSleep.js](https://github.com/richtr/NoSleep.js) by Rich Tibbett (MIT License).

## License

Released under the [MIT License](LICENSE).
