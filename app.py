import os
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, redirect, render_template, request, session, url_for

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
    return {"current_user": user, "sidebar_playlists": user_playlists}


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
    tracks = [
        item["track"]
        for item in pl.get("tracks", {}).get("items", [])
        if item.get("track") and item["track"].get("type") == "track"
    ]
    return render_template("playlist.html", playlist=pl, tracks=tracks)


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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
