# Quick Disclaimer

This is a one-person project for a portfolio and probably won't be a public repository. So, if you have access to this, please, use cautiously as this doesn't have any type of security measure. This was made with the sole intent of challenging myself with my abilities and not make a full applicable and usable app.

# SpotiPy_Nicolas

A non-exact, Spotify-flavored web app built on top of the [spotipy](https://spotipy.readthedocs.io/) library. Log in with your real Spotify account and browse your top tracks, top artists, recently played, your playlists, and search the catalog — all in a Spotify-style dark UI with 30-second preview playback.

## Features

- Spotify OAuth login (your real Spotify account)
- Home: recently played, top tracks/artists this month, new releases
- Search across tracks, artists, albums, and playlists
- Browse your playlists, liked songs, and top items
- Artist and album detail pages
- 30-second preview playback in a Spotify-style now-playing bar

## Setup

### 1. Python and node versions needed to use the program

Python: 3.13.1
node: 18.17.0

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

- Playback uses the 30-second `preview_url` returned by the Spotify API. Not every track has a preview — when missing, the play button is hidden for that row.
- Full-track playback would require Spotify Premium and the Web Playback SDK — out of scope for this replica.
- Spotify deprecated several endpoints (recommendations, related artists, audio features) for new apps in late 2024. This project intentionally avoids those.
- Built with Flask, spotipy, and vanilla HTML/CSS/JS — no build step.

## Rights & Legal

This project is an **unofficial, non-commercial fan replica** built for educational and portfolio purposes only. It is not affiliated with, endorsed by, or sponsored by Spotify AB.

### Spotify

All music data, artwork, track metadata, and audio previews are served directly from the **Spotify Web API** and remain the intellectual property of Spotify AB and the respective rights holders (artists, labels, distributors). Use of the Spotify API is governed by the [Spotify Developer Terms of Service](https://developer.spotify.com/terms) and the [Spotify Platform Rules](https://developer.spotify.com/documentation/design-and-branding/). This project complies with those terms by:

- Using OAuth 2.0 as required — no credentials are stored server-side beyond the session token.
- Limiting playback to the 30-second `preview_url` clips provided by the API (full-track streaming is not implemented).
- Not reselling, redistributing, or caching Spotify content beyond what the API permits.
- Displaying Spotify branding and attribution where content is sourced from Spotify.

### Spotipy

This app uses the [spotipy](https://spotipy.readthedocs.io/) Python library, which is licensed under the **MIT License**. spotipy is an independent, community-maintained wrapper and is not an official Spotify product.

### This project

The source code in this repository is released for **personal and educational use only**. It is not intended for commercial deployment, and no warranty is provided. If you fork or adapt this code, ensure your own usage remains compliant with the Spotify Developer Terms of Service.

## Project layout

```
app.py                 Flask app and routes
templates/             Jinja templates (base, login, home, search, playlist, album, artist, library)
templates/_macros.html Reusable card and track-row macros
static/css/style.css   Spotify-like dark theme
static/js/player.js    30-second preview audio player
```
