import json
import os
import time
from datetime import timedelta
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

import requests
import spotipy
from spotipy.cache_handler import CacheFileHandler
from spotipy.oauth2 import SpotifyOAuth

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

TOKEN_CACHE_PATH = os.path.join(os.path.dirname(__file__), ".cache")

# ---- In-memory cache -------------------------------------------------------
_cache: dict = {}

def _cget(key: str):
    entry = _cache.get(key)
    if entry and time.time() < entry["exp"]:
        return entry["val"]
    _cache.pop(key, None)
    return None

def _cset(key: str, value, ttl: int):
    _cache[key] = {"val": value, "exp": time.time() + ttl}

def _cdel_prefix(prefix: str):
    for k in list(_cache):
        if k.startswith(prefix):
            del _cache[k]
# ---------------------------------------------------------------------------
CUSTOM_DIR = os.path.join(os.path.dirname(__file__), "static", "custom")


def _get_custom_bg():
    for ext in ("jpg", "jpeg", "png", "webp"):
        if os.path.exists(os.path.join(CUSTOM_DIR, f"bg.{ext}")):
            return f"/static/custom/bg.{ext}"
    return None
PINS_PATH = os.path.join(os.path.dirname(__file__), ".pins.json")


def _load_pins():
    try:
        with open(PINS_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def _save_pins(data):
    with open(PINS_PATH, "w") as f:
        json.dump(data, f)

SCOPES = " ".join([
    "user-read-private",
    "user-read-email",
    "user-top-read",
    "user-library-read",
    "user-read-recently-played",
    "playlist-read-private",
    "playlist-read-collaborative",
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
])


@app.before_request
def make_session_permanent():
    session.permanent = True


def get_auth_manager():
    return SpotifyOAuth(
        client_id=os.environ["SPOTIPY_CLIENT_ID"],
        client_secret=os.environ["SPOTIPY_CLIENT_SECRET"],
        redirect_uri=os.environ["SPOTIPY_REDIRECT_URI"],
        scope=SCOPES,
        cache_handler=CacheFileHandler(cache_path=TOKEN_CACHE_PATH),
        show_dialog=False,
    )


def get_spotify():
    auth_manager = get_auth_manager()
    token = auth_manager.cache_handler.get_cached_token()
    if not auth_manager.validate_token(token):
        return None
    return spotipy.Spotify(auth_manager=auth_manager)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        sp = get_spotify()
        if sp is None:
            return redirect(url_for("login"))
        return view(sp, *args, **kwargs)

    return wrapped


@app.template_filter("duration")
def format_duration(ms):
    if not ms:
        return "0:00"
    seconds = ms // 1000
    return f"{seconds // 60}:{seconds % 60:02d}"


@app.context_processor
def inject_custom():
    return {"custom_bg": _get_custom_bg()}


@app.context_processor
def inject_sidebar():
    sp = get_spotify()
    user = None
    user_playlists = []
    if sp is not None:
        user_id = session.get("user_id", "_anon")
        cached = _cget(f"sb:{user_id}")
        if cached:
            user, user_playlists = cached
        else:
            try:
                user = sp.current_user()
                session["user_id"] = user["id"]
                user_id = user["id"]
                user_playlists = sp.current_user_playlists(limit=10).get("items", [])
                _cset(f"sb:{user_id}", (user, user_playlists), ttl=60)
            except spotipy.SpotifyException:
                pass
    user_id = session.get("user_id", "_default")
    pinned_ids = set(_load_pins().get(user_id, []))
    pinned   = [pl for pl in user_playlists if pl["id"] in pinned_ids]
    unpinned = [pl for pl in user_playlists if pl["id"] not in pinned_ids]
    return {
        "current_user": user,
        "sidebar_playlists": pinned + unpinned,
        "pinned_ids": pinned_ids,
    }


@app.route("/playlist/<playlist_id>/edit", methods=["POST"])
@login_required
def edit_playlist(sp, playlist_id):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="name required"), 400
    try:
        sp.playlist_change_details(playlist_id, name=name)
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400
    return "", 204


@app.route("/playlist/<playlist_id>/image", methods=["POST"])
@login_required
def edit_playlist_image(sp, playlist_id):
    data = request.get_json(silent=True) or {}
    image_b64 = data.get("image_b64")
    if not image_b64:
        return jsonify(error="no image"), 400
    try:
        sp.playlist_upload_cover_image(playlist_id, image_b64)
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400
    return "", 204


@app.route("/pin/<playlist_id>", methods=["POST"])
def toggle_pin(playlist_id):
    user_id = session.get("user_id", "_default")
    data = _load_pins()
    pinned = data.get(user_id, [])
    if playlist_id in pinned:
        pinned.remove(playlist_id)
    else:
        pinned.insert(0, playlist_id)
    data[user_id] = pinned
    _save_pins(data)
    return "", 204


@app.route("/login")
def login():
    auth_manager = get_auth_manager()
    auth_url = auth_manager.get_authorize_url()
    return render_template("login.html", auth_url=auth_url)


@app.route("/callback")
def callback():
    auth_manager = get_auth_manager()
    code = request.args.get("code")
    if not code:
        return redirect(url_for("login"))
    auth_manager.get_access_token(code, as_dict=False)
    return redirect(url_for("home"))


@app.route("/logout")
def logout():
    _cdel_prefix(f"sb:{session.get('user_id', '')}")
    _cdel_prefix(f"home:{session.get('user_id', '')}")
    _cdel_prefix(f"lib:{session.get('user_id', '')}")
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def home(sp):
    uid = session.get("user_id", "_anon")
    cached = _cget(f"home:{uid}")
    if cached:
        return render_template("home.html", **cached)

    new_releases, top_tracks, top_artists, recent_contexts = [], [], [], []
    try:
        new_releases = sp.new_releases(limit=10).get("albums", {}).get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        top_tracks = sp.current_user_top_tracks(limit=10, time_range="short_term").get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        top_artists = sp.current_user_top_artists(limit=10, time_range="short_term").get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        recent_raw = sp.current_user_recently_played(limit=10).get("items", [])
        seen_ids = set()
        for item in recent_raw:
            if len(recent_contexts) >= 8:
                break
            ctx = item.get("context")
            if not ctx:
                continue
            ctx_type = ctx.get("type")
            ctx_id = ctx["uri"].split(":")[-1]
            if ctx_id in seen_ids:
                continue
            seen_ids.add(ctx_id)
            if ctx_type == "playlist":
                try:
                    recent_contexts.append(sp.playlist(ctx_id, fields="id,name,images,description,owner,uri,type"))
                except Exception:
                    pass
            elif ctx_type == "artist":
                try:
                    recent_contexts.append(sp.artist(ctx_id))
                except Exception:
                    pass
    except spotipy.SpotifyException:
        pass

    data = dict(new_releases=new_releases, top_tracks=top_tracks,
                top_artists=top_artists, recent_contexts=recent_contexts)
    _cset(f"home:{uid}", data, ttl=120)
    return render_template("home.html", **data)


@app.route("/search")
@login_required
def search(sp):
    q = (request.args.get("q") or "").strip()
    results = None
    if q:
        results = {}
        for type_ in ("track", "artist", "album", "playlist"):
            try:
                results.update(sp.search(q=q, type=type_, limit=10))
            except spotipy.SpotifyException:
                pass
    return render_template("search.html", q=q, results=results)


@app.route("/playlist/<playlist_id>")
@login_required
def playlist(sp, playlist_id):
    cached = _cget(f"pl:{playlist_id}")
    if cached:
        return render_template("playlist.html", **cached)
    pl = sp.playlist(playlist_id)
    try:
        result = sp.playlist_tracks(playlist_id)
        tracks = []
        while result:
            tracks += [item["item"] for item in result.get("items", []) if item.get("item")]
            result = sp.next(result) if result.get("next") else None
        total = len(tracks)
    except spotipy.SpotifyException:
        tracks = []
        total = 0
    data = dict(playlist=pl, tracks=tracks, total=total)
    _cset(f"pl:{playlist_id}", data, ttl=60)
    return render_template("playlist.html", **data)


@app.route("/album/<album_id>")
@login_required
def album(sp, album_id):
    cached = _cget(f"al:{album_id}")
    if cached:
        return render_template("album.html", **cached)
    al = sp.album(album_id)
    data = dict(album=al)
    _cset(f"al:{album_id}", data, ttl=300)
    return render_template("album.html", **data)


@app.route("/artist/<artist_id>")
@login_required
def artist(sp, artist_id):
    cached = _cget(f"ar:{artist_id}")
    if cached:
        return render_template("artist.html", **cached)
    ar = sp.artist(artist_id)
    artist_name = ar["name"]
    try:
        top = sp.search(q=artist_name, type="track", limit=10).get("tracks", {}).get("items", [])[:5]
    except Exception:
        top = []
    try:
        albums_raw = sp.search(q=artist_name, type="album", limit=10).get("albums", {}).get("items", [])
    except Exception:
        albums_raw = []
    seen, albums = set(), []
    for al in albums_raw:
        key = al["name"].lower()
        if key not in seen:
            seen.add(key)
            albums.append(al)
    data = dict(artist=ar, top_tracks=top, albums=albums)
    _cset(f"ar:{artist_id}", data, ttl=300)
    return render_template("artist.html", **data)


@app.route("/library")
@login_required
def library(sp):
    uid = session.get("user_id", "_anon")
    cached = _cget(f"lib:{uid}")
    if cached:
        return render_template("library.html", **cached)
    playlists, top_artists, top_tracks, saved = [], [], [], []
    try:
        playlists = sp.current_user_playlists(limit=10).get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        top_artists = sp.current_user_top_artists(limit=10, time_range="medium_term").get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        top_tracks = sp.current_user_top_tracks(limit=10, time_range="medium_term").get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        saved_raw = sp.current_user_saved_tracks(limit=10).get("items", [])
        saved = [item["track"] for item in saved_raw if item.get("track")]
    except spotipy.SpotifyException:
        pass
    data = dict(playlists=playlists, top_artists=top_artists, top_tracks=top_tracks, saved=saved)
    _cset(f"lib:{uid}", data, ttl=120)
    return render_template("library.html", **data)


@app.route("/api/lyrics")
@login_required
def api_lyrics(_sp):
    track = request.args.get("track", "").strip()
    artist = request.args.get("artist", "").strip()
    album = request.args.get("album", "").strip()
    duration = request.args.get("duration", "").strip()
    if not track or not artist:
        return jsonify(error="missing params"), 400
    cache_key = f"lrc:{track}:{artist}"
    cached = _cget(cache_key)
    if cached:
        return jsonify(cached)
    params = {"track_name": track, "artist_name": artist}
    if album:
        params["album_name"] = album
    if duration:
        params["duration"] = duration
    try:
        resp = requests.get(
            "https://lrclib.net/api/get",
            params=params,
            headers={"Lrclib-Client": "SpotiPy-Nicolas v1.0"},
            timeout=5,
        )
        if resp.status_code == 404:
            result = dict(synced="", plain="", instrumental=False)
            _cset(cache_key, result, ttl=3600)
            return jsonify(result)
        resp.raise_for_status()
        data = resp.json()
        result = dict(
            synced=data.get("syncedLyrics") or "",
            plain=data.get("plainLyrics") or "",
            instrumental=bool(data.get("instrumental")),
        )
        _cset(cache_key, result, ttl=3600)
        return jsonify(result)
    except Exception:
        return jsonify(synced="", plain="", instrumental=False)


@app.route("/token")
@login_required
def get_token(sp):
    token_info = sp.auth_manager.cache_handler.get_cached_token()
    if not token_info:
        return jsonify(error="no token"), 401
    if sp.auth_manager.is_token_expired(token_info):
        token_info = sp.auth_manager.refresh_access_token(token_info["refresh_token"])
    return jsonify(access_token=token_info["access_token"])


@app.route("/play", methods=["POST"])
@login_required
def play_track(sp):
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    uris = data.get("uris", [])
    context_uri = data.get("context_uri")
    offset = data.get("offset")
    try:
        if context_uri is not None:
            kwargs = dict(device_id=device_id, context_uri=context_uri)
            if offset is not None:
                kwargs["offset"] = {"position": offset}
            sp.start_playback(**kwargs)
        elif uris:
            sp.start_playback(device_id=device_id, uris=uris)
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400
    return "", 204


@app.route("/api/queue")
@login_required
def api_queue(sp):
    try:
        return jsonify(sp.queue())
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400


@app.route("/api/artist/<artist_id>")
@login_required
def api_artist(sp, artist_id):
    try:
        return jsonify(sp.artist(artist_id))
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400


@app.route("/queue", methods=["POST"])
@login_required
def add_to_queue(sp):
    data = request.get_json(silent=True) or {}
    uri = data.get("uri")
    device_id = data.get("device_id")
    if not uri:
        return jsonify(error="no uri"), 400
    try:
        sp.add_to_queue(uri, device_id=device_id)
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400
    return "", 204


@app.route("/shuffle", methods=["POST"])
@login_required
def toggle_shuffle(sp):
    data = request.get_json(silent=True) or {}
    state = data.get("state", False)
    device_id = data.get("device_id")
    try:
        sp.shuffle(state=state, device_id=device_id)
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400
    return "", 204


@app.route("/repeat", methods=["POST"])
@login_required
def set_repeat(sp):
    data = request.get_json(silent=True) or {}
    state = data.get("state", "off")
    device_id = data.get("device_id")
    try:
        sp.repeat(state=state, device_id=device_id)
    except spotipy.SpotifyException as e:
        return jsonify(error=str(e)), 400
    return "", 204


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
