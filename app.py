import os
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

import spotipy
from spotipy.cache_handler import FlaskSessionCacheHandler
from spotipy.oauth2 import SpotifyOAuth

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

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


def get_auth_manager():
    return SpotifyOAuth(
        client_id=os.environ["SPOTIPY_CLIENT_ID"],
        client_secret=os.environ["SPOTIPY_CLIENT_SECRET"],
        redirect_uri=os.environ["SPOTIPY_REDIRECT_URI"],
        scope=SCOPES,
        cache_handler=FlaskSessionCacheHandler(session),
        show_dialog=True,
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
def inject_sidebar():
    sp = get_spotify()
    user = None
    user_playlists = []
    if sp is not None:
        try:
            user = sp.current_user()
            user_playlists = sp.current_user_playlists(limit=30).get("items", [])
        except spotipy.SpotifyException:
            pass
    pinned_ids = set(session.get("pinned_playlists", []))
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
    pinned = list(session.get("pinned_playlists", []))
    if playlist_id in pinned:
        pinned.remove(playlist_id)
    else:
        pinned.insert(0, playlist_id)
    session["pinned_playlists"] = pinned
    session.modified = True
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
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def home(sp):
    new_releases = []
    top_tracks = []
    top_artists = []
    recent = []
    try:
        new_releases = sp.new_releases(limit=12).get("albums", {}).get("items", [])
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
        recent = [item["track"] for item in recent_raw if item.get("track")]
    except spotipy.SpotifyException:
        pass

    return render_template(
        "home.html",
        new_releases=new_releases,
        top_tracks=top_tracks,
        top_artists=top_artists,
        recent=recent,
    )


@app.route("/search")
@login_required
def search(sp):
    q = (request.args.get("q") or "").strip()
    results = None
    if q:
        results = sp.search(q=q, type="track,artist,album,playlist", limit=12)
    return render_template("search.html", q=q, results=results)


@app.route("/playlist/<playlist_id>")
@login_required
def playlist(sp, playlist_id):
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
    return render_template("playlist.html", playlist=pl, tracks=tracks, total=total)


@app.route("/album/<album_id>")
@login_required
def album(sp, album_id):
    al = sp.album(album_id)
    return render_template("album.html", album=al)


@app.route("/artist/<artist_id>")
@login_required
def artist(sp, artist_id):
    ar = sp.artist(artist_id)
    top = sp.artist_top_tracks(artist_id).get("tracks", [])
    albums_raw = sp.artist_albums(artist_id, album_type="album,single", limit=12).get("items", [])
    seen = set()
    albums = []
    for al in albums_raw:
        key = al["name"].lower()
        if key in seen:
            continue
        seen.add(key)
        albums.append(al)
    return render_template("artist.html", artist=ar, top_tracks=top, albums=albums)


@app.route("/library")
@login_required
def library(sp):
    playlists = sp.current_user_playlists(limit=50).get("items", [])
    top_artists = []
    top_tracks = []
    saved = []
    try:
        top_artists = sp.current_user_top_artists(limit=10, time_range="medium_term").get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        top_tracks = sp.current_user_top_tracks(limit=10, time_range="medium_term").get("items", [])
    except spotipy.SpotifyException:
        pass
    try:
        saved_raw = sp.current_user_saved_tracks(limit=20).get("items", [])
        saved = [item["track"] for item in saved_raw if item.get("track")]
    except spotipy.SpotifyException:
        pass
    return render_template(
        "library.html",
        playlists=playlists,
        top_artists=top_artists,
        top_tracks=top_tracks,
        saved=saved,
    )


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
