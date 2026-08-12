# Quick Disclaimer

This is a one-person project for a portfolio and probably won't be a public repository. So, if you have access to this, please, use cautiously as this doesn't have any type of security measure. This was made with the sole intent of challenging myself with my abilities and not make a full applicable and usable app.

# SpotiPy_Nicolas

A non-exact, Spotify-flavored web app built on top of the [spotipy](https://spotipy.readthedocs.io/) library. Log in with your real Spotify account and browse your top tracks, top artists, recently played, your playlists, and search the catalog — all in a Spotify-style dark UI with full-track playback through the Spotify Web Playback SDK.

## Features

- Spotify OAuth login (your real Spotify account)
- Home: recently played, top tracks/artists this month, new releases
- Search across tracks, artists, albums, and playlists
- Browse your playlists, liked songs, and top items
- Artist and album detail pages
- **Full-track playback** via the Spotify Web Playback SDK — requires **Spotify Premium**
- Now-playing bar with shuffle, repeat, seek, and volume
- Right panel with Now Playing, Queue, and time-synced lyrics
- Playlist renaming, cover-image upload, and pinning to the sidebar
- Optional custom background image (drop one into `static/custom/`)

## Setup

### 1. Requirements

Python: 3.13.1

Spotify **Premium** is required — the Web Playback SDK will not stream audio on a free account.
No Node.js is needed; there is no JavaScript build step.

### 2. Create a Spotify app

Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), click **Create app**, and grab the **Client ID** and **Client Secret**.

In the app's settings, add this **Redirect URI**:

```
http://127.0.0.1:5000/callback
```

> Spotify no longer accepts `http://localhost` for new apps — use `127.0.0.1`.

### 3. Install dependencies

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

### 4. Configure environment

Copy `.env.example` to `.env` and fill in your credentials:

```
SPOTIPY_CLIENT_ID=your_client_id_here
SPOTIPY_CLIENT_SECRET=your_client_secret_here
SPOTIPY_REDIRECT_URI=http://127.0.0.1:5000/callback
FLASK_SECRET_KEY=change_me_to_a_random_string
```

Generate a Flask secret key with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 5. Run

```bash
python app.py
```

Open <http://127.0.0.1:5000> in your browser, log in with Spotify, and explore.

## Notes

- Playback is full-track via the Spotify Web Playback SDK, which registers the browser as a Spotify Connect device named "Spotipy Web Player". Spotify Premium is required; on a free account the player silently does nothing.
- The OAuth token is held in the signed Flask session, so each browser session is its own login.
- Lyrics come from [lrclib.net](https://lrclib.net), not Spotify — Spotify's API does not expose lyrics.
- Spotify deprecated several endpoints (recommendations, related artists, audio features, featured playlists, and `preview_url`) for apps in Development Mode in late 2024. This project cannot use those and does not attempt to.
- Built with Flask, spotipy, and vanilla HTML/CSS/JS — no build step.

## Rights & Legal

This project is an **unofficial, non-commercial fan replica** built for educational and portfolio purposes only. It is not affiliated with, endorsed by, or sponsored by Spotify AB.

### Spotify

All music data, artwork, track metadata, and audio previews are served directly from the **Spotify Web API** and remain the intellectual property of Spotify AB and the respective rights holders (artists, labels, distributors). Use of the Spotify API is governed by the [Spotify Developer Terms of Service](https://developer.spotify.com/terms) and the [Spotify Platform Rules](https://developer.spotify.com/documentation/design-and-branding/). This project complies with those terms by:

- Using OAuth 2.0 as required. Access and refresh tokens are kept in the signed Flask session cookie and are never written to disk or shared between users.
- Streaming audio only through Spotify's official Web Playback SDK, which enforces Premium entitlement and reports playback to Spotify. No audio is proxied, downloaded, or re-hosted.
- Not reselling, redistributing, or caching Spotify content beyond what the API permits.
- Displaying Spotify branding and attribution where content is sourced from Spotify.

### Spotipy

This app uses the [spotipy](https://spotipy.readthedocs.io/) Python library, which is licensed under the **MIT License**. spotipy is an independent, community-maintained wrapper and is not an official Spotify product.

### This project

The source code in this repository is released for **personal and educational use only**. It is not intended for commercial deployment, and no warranty is provided. If you fork or adapt this code, ensure your own usage remains compliant with the Spotify Developer Terms of Service.

## Project layout

```
app.py                 Flask app, routes, OAuth, and the in-memory TTL cache
templates/             Jinja templates (base, login, home, search, playlist,
                       album, artist, library, error)
templates/_macros.html Reusable card and track-row macros
static/css/style.css   Spotify-like dark theme
static/js/player.js    Web Playback SDK player, PJAX navigation, lyrics,
                       queue panel, and resizable layout
static/custom/         Drop bg.jpg here for a custom background (gitignored)
```
