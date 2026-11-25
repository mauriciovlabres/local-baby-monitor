# Project Skills

## 1. Mock Camera Development (Offline Mode)
With `MOCK_MODE=true`, the backend and UI must work on a PC without the physical Tapo C200: test the UI, Screen Wake Lock and PTZ endpoints against a simulated camera (e.g. a sample video and stubbed PTZ responses).

## 2. ONVIF PTZ Integration
- Target ONVIF port `2020`.
- Expose clean REST endpoints on the Python backend, e.g. `POST /api/ptz/move`.
- Credentials stay in the backend and must never reach the frontend.

## 3. Termux Compatibility Check
Before adding a package to `backend/requirements.txt`, verify it is pure Python or ships `aarch64` wheels usable in Termux.

## 4. Phase 2 Readiness (White Noise Module)
Keep backend and UI modular (separate blueprints/modules and UI components) so a future `/api/whitenoise` endpoint controlling audio on the host Android device can be plugged in easily.
