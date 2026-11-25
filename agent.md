# Agent Rules

Strict architectural rules for all future development.

1. **Low Resource Footprint** – The project runs on an old Android phone via Termux: no root, no Docker, no heavy C/Rust builds.
2. **No Cloud Dependency** – Serve all CSS, JS and icons locally. No external CDNs; everything must work offline on the LAN.
3. **Frontend Simplicity** – Vanilla HTML5, CSS3 and ES6+ JavaScript. No React/Next.js or any build step.
4. **Security First** – Never hardcode IPs or credentials. Always read them from `.env` or `config/go2rtc.yaml`.
5. **Standards** – English only (code, comments, docs). OLED dark mode (`#000000` / `#121212`), large touch buttons, and `navigator.wakeLock` support.
