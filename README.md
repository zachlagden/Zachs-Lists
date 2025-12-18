<div align="center">

<!-- ![Zach's Lists Banner](./assets/banner.png) -->

# Zach's Lists

**Custom blocklists. Built fast. Updated automatically.**

[![License](https://img.shields.io/github/license/zachlagden/Zachs-Lists?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/zachlagden/Zachs-Lists?style=flat-square)](https://github.com/zachlagden/Zachs-Lists/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/zachlagden/Zachs-Lists?style=flat-square)](https://github.com/zachlagden/Zachs-Lists/commits/main)
[![Issues](https://img.shields.io/github/issues/zachlagden/Zachs-Lists?style=flat-square)](https://github.com/zachlagden/Zachs-Lists/issues)

![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-1.75-CE422B?style=flat-square&logo=rust&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=flat-square&logo=flask&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7.0-47A248?style=flat-square&logo=mongodb&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3.3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

[**Try it live**](https://lists.zachlagden.uk) · [Documentation](https://lists.docs.zachlagden.uk) · [Report Bug](https://github.com/zachlagden/Zachs-Lists/issues) · [Request Feature](https://github.com/zachlagden/Zachs-Lists/issues)

</div>

---

## What is Zach's Lists?

A modern blocklist aggregator that lets you build your own curated DNS blocklists from multiple sources. Stop using one-size-fits-all blocklists — create exactly what you need.

- **Combine** 40+ blocklist sources into one unified list
- **Filter** with smart whitelisting (regex, wildcards, subdomains)
- **Export** in hosts, plain text, or Adblock format
- **Automate** with weekly rebuilds that keep your lists fresh

Powered by a Rust backend that processes millions of domains in seconds.

---

## Features

| | Feature | Description |
|---|---------|-------------|
| 🎯 | **Custom Curation** | Pick and choose from dozens of blocklist sources to build your perfect list |
| ⚡ | **Rust-Powered** | Parallel downloads and processing means lists built in seconds, not minutes |
| 🔄 | **Auto Updates** | Set it and forget it — weekly automatic rebuilds keep everything fresh |
| 📋 | **Multi-Format** | Export as hosts file, plain text, or Adblock syntax for any blocker |
| 🛡️ | **Smart Whitelisting** | Powerful pattern matching: exact, wildcard, subdomain, and full regex |
| 📊 | **Real-time Progress** | Watch your list build live with WebSocket-powered progress tracking |
| 🌍 | **Public Lists** | Browse and use community-curated blocklists, or share your own |
| 🔐 | **GitHub Login** | One-click authentication — no passwords to remember |

---

## Quick Start

Getting started takes less than a minute:

### 1. Sign in
Head to [lists.zachlagden.uk](https://lists.zachlagden.uk) and sign in with your GitHub account.

### 2. Configure
Add your blocklist sources (one URL per line) and set up your whitelist patterns.

### 3. Build & Use
Hit "Build Now" and grab your personalized blocklist URL:

```bash
# Pi-hole / AdGuard Home (hosts format)
https://lists.zachlagden.uk/u/yourname/all_domains.txt?format=hosts

# uBlock Origin / AdBlock Plus
https://lists.zachlagden.uk/u/yourname/all_domains.txt?format=adblock

# Plain domain list
https://lists.zachlagden.uk/u/yourname/all_domains.txt?format=plain
```

That's it. Your blocklist will auto-update weekly.

---

## How It Works

```
 +-----------+      +-----------+      +-----------+      +-------------+
 |  Sources  |  ->  |  Download |  ->  | Whitelist |  ->  |  Generate   |
 | (40+ URLs)|      | (Parallel)|      |  (Filter) |      | (3 formats) |
 +-----------+      +-----------+      +-----------+      +-------------+
```

**1. Sources** — You define which blocklists to combine. Popular choices, niche lists, whatever you need.

**2. Download** — The Rust worker fetches all sources in parallel (10 concurrent downloads). Smart caching means unchanged sources aren't re-downloaded.

**3. Whitelist** — Your whitelist patterns filter out false positives. Support for exact matches, `*.wildcard.com`, `@@subdomain` matching, and `/regex/` patterns.

**4. Generate** — Deduplicated domains are output in three formats: hosts file (Pi-hole native), plain text, and Adblock syntax.

---

## Why Zach's Lists?

| Feature | Zach's Lists | Traditional Lists | DIY Scripts |
|---------|:------------:|:-----------------:|:-----------:|
| Custom sources | ✅ You choose | ❌ Fixed | ✅ Manual work |
| Whitelist filtering | ✅ Built-in UI | ❌ None | ⚠️ Roll your own |
| Auto updates | ✅ Weekly | ✅ Varies | ⚠️ Cron setup |
| Real-time progress | ✅ WebSocket | ❌ | ❌ |
| Multiple formats | ✅ 3 formats | ⚠️ Usually 1 | ⚠️ Extra code |
| Performance | ✅ Rust + parallel | N/A | ⚠️ Depends |
| Web UI | ✅ Full dashboard | ❌ | ❌ |

**The bottom line:** Traditional blocklists give you no control. DIY scripts require maintenance. Zach's Lists gives you the flexibility of custom lists with the convenience of a managed service.

---

## Tech Stack

### Frontend
- **React 18 + TypeScript** — Type-safe, component-based UI
- **Tailwind CSS** — Custom cyberpunk-inspired theme
- **Socket.io** — Real-time job progress updates
- **Framer Motion** — Smooth animations and transitions

### Backend
- **Flask 3 + MongoDB** — Flexible REST API with document storage
- **APScheduler** — Automated weekly rebuilds
- **GitHub OAuth** — Secure, passwordless authentication
- **GeoIP2** — Analytics and geographic insights

### Worker
- **Rust + Tokio** — Async runtime for maximum performance
- **10 concurrent downloads** — Parallel source fetching
- **7-day intelligent caching** — Only download what's changed
- **~4M domains** processed in seconds

---

## Compatibility

Works with any DNS blocker or browser extension that accepts blocklists:

| Platform | Formats |
|----------|---------|
| **Pi-hole** | hosts, plain |
| **AdGuard Home** | hosts, plain, adblock |
| **uBlock Origin** | adblock |
| **AdBlock Plus** | adblock |
| **Blocky** | plain |
| **NextDNS** | plain |
| **ControlD** | plain |

If it accepts a URL to a blocklist, it'll work with Zach's Lists.

---

## Screenshots

<details>
<summary>📸 Click to expand</summary>

### Dashboard
<!-- ![Dashboard](./assets/screenshots/dashboard.png) -->
*Your command center — usage stats, recent jobs, and quick actions*

### Configuration Editor
<!-- ![Config](./assets/screenshots/config.png) -->
*Add sources, configure whitelists, and trigger builds*

### Real-time Job Progress
<!-- ![Jobs](./assets/screenshots/jobs.png) -->
*Watch your list build live with per-source progress*

### Browse Public Lists
<!-- ![Browse](./assets/screenshots/browse.png) -->
*Discover community-curated blocklists*

</details>

---

## Star History

<a href="https://star-history.com/#zachlagden/Zachs-Lists&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=zachlagden/Zachs-Lists&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=zachlagden/Zachs-Lists&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=zachlagden/Zachs-Lists&type=Date" />
 </picture>
</a>

---

## Self-Hosting

Want to run your own instance? Full deployment instructions (Docker + manual) are available in the documentation:

**[Self-Hosting Guide →](https://lists.docs.zachlagden.uk/zachs-lists/self-hosting)**

---

## Support

If Zach's Lists helps keep your network clean, consider supporting development:

<a href="https://github.com/sponsors/zachlagden">
  <img src="https://img.shields.io/badge/Sponsor_on_GitHub-ea4aaa?style=for-the-badge&logo=github&logoColor=white" alt="Sponsor on GitHub" />
</a>

Your support helps cover hosting costs and keeps the project actively maintained.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**[Website](https://lists.zachlagden.uk)** · **[Docs](https://lists.docs.zachlagden.uk)** · **[Report Bug](https://github.com/zachlagden/Zachs-Lists/issues)** · **[Request Feature](https://github.com/zachlagden/Zachs-Lists/issues)**

Made with ☕ and 🦀 by [Zach Lagden](https://github.com/zachlagden)

</div>
