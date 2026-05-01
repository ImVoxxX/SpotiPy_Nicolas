(function () {
    const titleEl    = document.getElementById('player-title');
    const artistEl   = document.getElementById('player-artist');
    const artEl      = document.getElementById('player-art');
    const timeEl     = document.getElementById('player-time');
    const durEl      = document.getElementById('player-duration');
    const playBtn    = document.getElementById('player-play');
    const prevBtn    = document.getElementById('player-prev');
    const nextBtn    = document.getElementById('player-next');
    const shuffleBtn = document.getElementById('player-shuffle');
    const repeatBtn  = document.getElementById('player-repeat');
    const seekEl     = document.getElementById('player-seek');
    const volumeEl   = document.getElementById('player-volume');

    let player   = null;
    let deviceId = null;
    let seeking  = false;

    function setSeekPos(pct) {
        seekEl.value = pct;
        seekEl.style.setProperty('--seek-pos', pct + '%');
    }

    const REPEAT_API = ['off', 'context', 'track'];

    function fmt(ms) {
        if (!isFinite(ms) || ms < 0) return '0:00';
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    }

    function setActiveRow(uri) {
        document.querySelectorAll('tr.playing').forEach(r => r.classList.remove('playing'));
        if (!uri) return;
        const btn = document.querySelector(`[data-uri="${CSS.escape(uri)}"]`);
        if (btn) btn.closest('tr').classList.add('playing');
    }

    function updateShuffleUI(on) {
        shuffleBtn.classList.toggle('ctrl-active', on);
    }

    function updateRepeatUI(mode) {
        repeatBtn.dataset.mode = mode;
        repeatBtn.classList.toggle('ctrl-active', mode !== 0);
        if (mode === 2) {
            repeatBtn.innerHTML = '↻<span class="repeat-one">1</span>';
        } else {
            repeatBtn.textContent = '↻';
        }
    }

    window.onSpotifyWebPlaybackSDKReady = function () {
        player = new Spotify.Player({
            name: 'Spotipy Web Player',
            getOAuthToken: cb => {
                fetch('/token')
                    .then(r => r.json())
                    .then(d => cb(d.access_token))
                    .catch(() => {});
            },
            volume: volumeEl ? volumeEl.value / 100 : 0.7,
        });

        player.addListener('ready', ({ device_id }) => {
            deviceId = device_id;
            if (activeTab === 'queue') refreshQueue();
        });

        player.addListener('not_ready', () => {
            deviceId = null;
        });

        player.addListener('player_state_changed', state => {
            if (!state) { artEl.hidden = true; return; }
            const track = state.track_window.current_track;
            if (!track) { artEl.hidden = true; return; }

            titleEl.textContent  = track.name;
            artistEl.textContent = track.artists.map(a => a.name).join(', ');

            const img = track.album.images[0];
            if (img) { artEl.src = img.url; artEl.hidden = false; }
            else       { artEl.hidden = true; }

            playBtn.textContent = state.paused ? '▶' : '❚❚';
            durEl.textContent   = fmt(state.duration);
            setActiveRow(state.paused ? null : track.uri);

            if (!seeking) {
                setSeekPos(state.duration ? (state.position / state.duration) * 100 : 0);
                timeEl.textContent = fmt(state.position);
            }

            updateShuffleUI(state.shuffle);
            updateRepeatUI(state.repeat_mode);
            updateRightPanel(state);
            updatePlButtons(state);
            if (activeTab === 'queue') refreshQueue();
        });

        player.connect();
    };

    // Smooth progress updates between SDK state events
    setInterval(() => {
        if (!player || seeking) return;
        player.getCurrentState().then(state => {
            if (!state || state.paused) return;
            setSeekPos(state.duration ? (state.position / state.duration) * 100 : 0);
            timeEl.textContent = fmt(state.position);
            if (activeTab === 'lyrics') updateLyricsHighlight(state.position);
        });
    }, 1000);

    playBtn.addEventListener('click', () => { if (player) player.togglePlay(); });

    prevBtn.addEventListener('click', () => {
        if (!player) return;
        player.getCurrentState().then(state => {
            if (!state) return;
            if (state.position > 10000) {
                player.seek(0);
            } else {
                player.previousTrack();
            }
        });
    });

    nextBtn.addEventListener('click', () => { if (player) player.nextTrack(); });

    shuffleBtn.addEventListener('click', () => {
        if (!deviceId) return;
        const newState = !shuffleBtn.classList.contains('ctrl-active');
        updateShuffleUI(newState);
        fetch('/shuffle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, state: newState }),
        }).catch(() => {});
    });

    repeatBtn.addEventListener('click', () => {
        if (!deviceId) return;
        const next = (parseInt(repeatBtn.dataset.mode || '0') + 1) % 3;
        updateRepeatUI(next);
        fetch('/repeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, state: REPEAT_API[next] }),
        }).catch(() => {});
    });

    seekEl.addEventListener('mousedown',  () => { seeking = true; });
    seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive: true });
    seekEl.addEventListener('input', () => {
        seekEl.style.setProperty('--seek-pos', seekEl.value + '%');
    });
    seekEl.addEventListener('change', function () {
        seeking = false;
        seekEl.style.setProperty('--seek-pos', seekEl.value + '%');
        if (!player) return;
        player.getCurrentState().then(state => {
            if (state) player.seek((seekEl.value / 100) * state.duration);
        });
    });

    if (volumeEl) {
        volumeEl.style.setProperty('--vol-pos', volumeEl.value + '%');
        volumeEl.addEventListener('input', () => {
            volumeEl.style.setProperty('--vol-pos', volumeEl.value + '%');
            if (player) player.setVolume(volumeEl.value / 100);
        });
    }

    // PJAX: replace only .main without reloading the page (keeps player alive)
    async function navigateTo(url, push) {
        try {
            const res = await fetch(url);
            // Redirect to login means token expired — do a real navigation
            if (res.redirected && new URL(res.url).pathname === '/login') {
                location.href = '/login';
                return;
            }
            const html = await res.text();
            const doc  = new DOMParser().parseFromString(html, 'text/html');
            const newMain = doc.querySelector('.main');
            const oldMain = document.querySelector('.main');
            if (!newMain || !oldMain) { location.href = url; return; }
            oldMain.innerHTML = newMain.innerHTML;
            document.title = doc.title;
            if (push) history.pushState({}, '', url);
            // Re-highlight the currently playing row in new content
            if (player) {
                player.getCurrentState().then(state => {
                    if (state && !state.paused && state.track_window.current_track) {
                        setActiveRow(state.track_window.current_track.uri);
                    }
                });
            }
            // Sync active nav links
            const path = new URL(url, location.origin).pathname;
            document.querySelectorAll('.nav-link').forEach(a => {
                const p = new URL(a.href, location.origin).pathname;
                a.classList.toggle('active', p === path);
            });
        } catch (_) {
            location.href = url;
        }
    }

    // Store initial state so Back works from the first page
    history.replaceState({}, '', location.href);
    window.addEventListener('popstate', () => navigateTo(location.href, false));

    // Unified click handler: track play OR pjax navigation
    document.addEventListener('click', function (e) {
        // Pin/unpin playlist (button lives on the playlist page)
        const pinBtn = e.target.closest('.pin-btn');
        if (pinBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = pinBtn.dataset.playlistId;
            fetch(`/pin/${encodeURIComponent(id)}`, { method: 'POST' })
                .then(() => {
                    const nowPinned = pinBtn.getAttribute('aria-label') === 'Pin';
                    pinBtn.textContent = nowPinned ? '★' : '☆';
                    pinBtn.setAttribute('aria-label', nowPinned ? 'Unpin' : 'Pin');
                    pinBtn.setAttribute('title',      nowPinned ? 'Unpin' : 'Pin');
                    pinBtn.classList.toggle('pin-btn--active', nowPinned);
                    return fetch(location.href);
                })
                .then(r => r.text())
                .then(html => {
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const newList = doc.querySelector('.sidebar-playlists');
                    const oldList = document.querySelector('.sidebar-playlists');
                    if (newList && oldList) oldList.innerHTML = newList.innerHTML;
                })
                .catch(() => {});
            return;
        }

        // Playlist shuffle button
        const plShuffleBtn = e.target.closest('.pl-shuffle-btn');
        if (plShuffleBtn) {
            e.preventDefault();
            if (!deviceId) return;
            const contextUri = plShuffleBtn.dataset.playlistUri;
            fetch('/shuffle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: deviceId, state: true }),
            }).then(() => fetch('/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: deviceId, context_uri: contextUri }),
            })).catch(() => {});
            return;
        }

        // Track play button (has data-uri)
        const trackBtn = e.target.closest('[data-uri]');
        if (trackBtn) {
            e.preventDefault();
            if (!deviceId) { alert('Player not ready yet — wait a moment and try again.'); return; }
            // Playlist play button: toggle pause if this playlist is already playing
            if (trackBtn.classList.contains('pl-play-btn') && trackBtn.dataset.isPlaying === '1') {
                if (player) player.togglePlay();
                return;
            }
            const contextUri = trackBtn.dataset.contextUri;
            const idx        = trackBtn.dataset.index;
            const body = (contextUri && idx !== undefined)
                ? { device_id: deviceId, context_uri: contextUri, offset: parseInt(idx, 10) }
                : { device_id: deviceId, uris: [trackBtn.dataset.uri] };
            fetch('/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).catch(() => {});
            return;
        }

        // Internal navigation links
        const link = e.target.closest('a[href]');
        if (!link) return;
        let url;
        try { url = new URL(link.href); } catch (_) { return; }
        if (url.origin !== location.origin) return;
        if (['/logout', '/login', '/callback'].some(p => url.pathname.startsWith(p))) return;
        e.preventDefault();
        navigateTo(url.href, true);
    });

    // Intercept search form submissions
    document.addEventListener('submit', function (e) {
        const form = e.target.closest('form');
        if (!form) return;
        let action;
        try { action = new URL(form.action || location.href); } catch (_) { return; }
        if (action.origin !== location.origin) return;
        e.preventDefault();
        const params = new URLSearchParams(new FormData(form));
        navigateTo(action.pathname + '?' + params, true);
    });

    // ---- Playlist edit: name ----
    document.addEventListener('click', function (e) {
        const editBtn = e.target.closest('.pl-edit-name-btn');
        if (editBtn) {
            const title   = document.getElementById('pl-title');
            const input   = document.getElementById('pl-title-input');
            const actions = document.querySelector('.pl-edit-actions');
            if (!title || !input || !actions) return;
            title.style.display   = 'none';
            editBtn.style.display = 'none';
            input.style.display   = '';
            actions.style.display = 'flex';
            input.focus(); input.select();
            return;
        }

        const saveBtn = e.target.closest('.pl-save-btn');
        if (saveBtn) {
            const header  = document.querySelector('.detail-header[data-playlist-id]');
            const title   = document.getElementById('pl-title');
            const input   = document.getElementById('pl-title-input');
            const actions = document.querySelector('.pl-edit-actions');
            const editBtn = document.querySelector('.pl-edit-name-btn');
            if (!header || !input) return;
            const newName = input.value.trim();
            if (!newName) return;
            fetch(`/playlist/${encodeURIComponent(header.dataset.playlistId)}/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            }).then(r => {
                if (!r.ok) return;
                title.textContent = newName;
                document.title = newName + ' · Spotipy';
                const sid = header.dataset.playlistId;
                const link = document.querySelector(`.sidebar-playlists a[href*="${sid}"]`);
                if (link) link.textContent = newName;
            }).catch(() => {});
            title.style.display   = '';
            input.style.display   = 'none';
            actions.style.display = 'none';
            if (editBtn) editBtn.style.display = '';
            return;
        }

        const cancelBtn = e.target.closest('.pl-cancel-btn');
        if (cancelBtn) {
            const title   = document.getElementById('pl-title');
            const input   = document.getElementById('pl-title-input');
            const actions = document.querySelector('.pl-edit-actions');
            const editBtn = document.querySelector('.pl-edit-name-btn');
            if (!title || !input || !actions) return;
            input.value           = title.textContent;
            title.style.display   = '';
            input.style.display   = 'none';
            actions.style.display = 'none';
            if (editBtn) editBtn.style.display = '';
            return;
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.target.id !== 'pl-title-input') return;
        if (e.key === 'Enter')  document.querySelector('.pl-save-btn')?.click();
        if (e.key === 'Escape') document.querySelector('.pl-cancel-btn')?.click();
    });

    // ---- Playlist edit: cover image ----
    function processImage(file, cb) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const SIZE = 640;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = SIZE;
                const ctx = canvas.getContext('2d');
                const min = Math.min(img.width, img.height);
                const sx  = (img.width  - min) / 2;
                const sy  = (img.height - min) / 2;
                ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
                cb(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    document.addEventListener('change', function (e) {
        const fileInput = e.target.closest('.pl-cover-input');
        if (!fileInput) return;
        const file = fileInput.files[0];
        if (!file) return;
        const header = document.querySelector('.detail-header[data-playlist-id]');
        if (!header) return;
        processImage(file, (b64) => {
            fetch(`/playlist/${encodeURIComponent(header.dataset.playlistId)}/image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_b64: b64 }),
            }).then(r => {
                if (!r.ok) return;
                const coverImg = document.getElementById('pl-cover-img');
                if (coverImg && coverImg.tagName === 'IMG') {
                    coverImg.src = URL.createObjectURL(file);
                }
            }).catch(() => {});
        });
    });

    // ---- Playlist search filter ----
    document.addEventListener('input', function (e) {
        if (e.target.id !== 'pl-search') return;
        const q = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#pl-track-list tbody tr');
        rows.forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    // ---- Right Panel ----
    const rpEmpty      = document.getElementById('rp-empty');
    const rpContent    = document.getElementById('rp-content');
    const rpArtEl      = document.getElementById('rp-art');
    const rpTitleEl    = document.getElementById('rp-title');
    const rpArtistLine = document.getElementById('rp-artist-line');
    const rpAlbumEl    = document.getElementById('rp-album');
    const rpQueue      = document.getElementById('rp-queue');
    const rpQueueNone  = document.getElementById('rp-queue-empty');
    const rpArtistInfo = document.getElementById('rp-artist-info');

    let lastArtistId = null;

    // ---- Right Panel Tabs ----
    const rpTabBtns        = document.querySelectorAll('.rp-tab-btn');
    const rpViewNowPlaying = document.getElementById('rp-view-nowplaying');
    const rpViewQueue      = document.getElementById('rp-view-queue');
    const rpViewLyrics     = document.getElementById('rp-view-lyrics');
    let activeTab = 'nowplaying';

    function switchRpTab(view) {
        activeTab = view;
        rpTabBtns.forEach(btn => btn.classList.toggle('rp-tab-btn--active', btn.dataset.view === view));
        rpViewNowPlaying.hidden = view !== 'nowplaying';
        rpViewQueue.hidden      = view !== 'queue';
        rpViewLyrics.hidden     = view !== 'lyrics';
        if (view === 'queue') refreshQueue();
        if (view === 'lyrics' && player) {
            player.getCurrentState().then(state => {
                if (state && state.track_window.current_track) {
                    maybeLoadLyrics(state.track_window.current_track);
                }
            });
        }
    }

    rpTabBtns.forEach(btn => btn.addEventListener('click', () => switchRpTab(btn.dataset.view)));

    const playerQueueBtn = document.getElementById('player-queue-btn');
    if (playerQueueBtn) {
        playerQueueBtn.addEventListener('click', () => switchRpTab('queue'));
    }

    // ---- Queue View ----
    const rpQvEmpty   = document.getElementById('rp-qv-empty');
    const rpQvBody    = document.getElementById('rp-qv-body');
    const rpQvCurrent = document.getElementById('rp-qv-current');
    const rpQvList    = document.getElementById('rp-qv-list');
    const rpQvNone    = document.getElementById('rp-qv-none');
    let queueFetching = false;

    // ---- Lyrics ----
    const rpLyricsEmpty   = document.getElementById('rp-lyrics-empty');
    const rpLyricsLoading = document.getElementById('rp-lyrics-loading');
    const rpLyricsBody    = document.getElementById('rp-lyrics-body');
    let syncedLines      = [];
    let lastLyricsId     = null;
    let lastActiveLyricIdx = -1;
    let lyricsLoading    = false;

    function parseLrc(lrc) {
        return lrc.split('\n').map(line => {
            const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
            if (!m) return null;
            return { time: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: m[3].trim() };
        }).filter(l => l && l.text);
    }

    function renderLyrics(synced, plain, instrumental) {
        syncedLines = [];
        lastActiveLyricIdx = -1;
        if (instrumental) {
            rpLyricsBody.innerHTML = '<p class="lyrics-line lyrics-line--instrumental">This track is instrumental</p>';
            rpLyricsEmpty.style.display   = 'none';
            rpLyricsLoading.style.display = 'none';
            rpLyricsBody.style.display    = 'flex';
            return;
        }
        if (synced) {
            const lines = parseLrc(synced);
            if (lines.length) {
                syncedLines = lines;
                rpLyricsBody.innerHTML = lines.map((l, i) =>
                    `<p class="lyrics-line" data-idx="${i}">${esc(l.text)}</p>`
                ).join('');
                rpLyricsEmpty.style.display   = 'none';
                rpLyricsLoading.style.display = 'none';
                rpLyricsBody.style.display    = 'flex';
                return;
            }
        }
        if (plain) {
            rpLyricsBody.innerHTML = plain.split('\n').filter(l => l.trim()).map(l =>
                `<p class="lyrics-line lyrics-line--active">${esc(l)}</p>`
            ).join('');
            rpLyricsEmpty.style.display   = 'none';
            rpLyricsLoading.style.display = 'none';
            rpLyricsBody.style.display    = 'flex';
            return;
        }
        rpLyricsBody.style.display    = 'none';
        rpLyricsLoading.style.display = 'none';
        rpLyricsEmpty.style.display   = '';
    }

    function maybeLoadLyrics(track) {
        if (!track) return;
        const id = track.id || track.uri;
        if (id === lastLyricsId || lyricsLoading) return;
        lastLyricsId  = id;
        lyricsLoading = true;
        rpLyricsBody.style.display    = 'none';
        rpLyricsEmpty.style.display   = 'none';
        rpLyricsLoading.style.display = '';
        const params = new URLSearchParams({
            track:    track.name,
            artist:   track.artists.map(a => a.name).join(', '),
            album:    track.album.name,
            duration: Math.round((track.duration_ms || 0) / 1000),
        });
        fetch('/api/lyrics?' + params)
            .then(r => r.json())
            .then(d => renderLyrics(d.synced, d.plain, d.instrumental))
            .catch(() => renderLyrics('', '', false))
            .finally(() => { lyricsLoading = false; });
    }

    function updateLyricsHighlight(posMs) {
        if (!syncedLines.length) return;
        const posSec = posMs / 1000;
        let idx = 0;
        for (let i = 0; i < syncedLines.length; i++) {
            if (syncedLines[i].time <= posSec) idx = i; else break;
        }
        if (idx === lastActiveLyricIdx) return;
        lastActiveLyricIdx = idx;
        rpLyricsBody.querySelectorAll('.lyrics-line').forEach((el, i) =>
            el.classList.toggle('lyrics-line--active', i === idx)
        );
        const active = rpLyricsBody.querySelector(`.lyrics-line[data-idx="${idx}"]`);
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function refreshQueue() {
        if (queueFetching) return;
        queueFetching = true;
        fetch('/api/queue')
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(data => renderQueueView(data))
            .catch(() => {
                rpQvEmpty.style.display = '';
                rpQvBody.style.display  = 'none';
            })
            .finally(() => { queueFetching = false; });
    }

    function renderQueueView(data) {
        if (!data || !data.currently_playing) {
            rpQvEmpty.style.display = '';
            rpQvBody.style.display  = 'none';
            return;
        }
        rpQvEmpty.style.display = 'none';
        rpQvBody.style.display  = 'flex';
        rpQvBody.style.flexDirection = 'column';

        const ct    = data.currently_playing;
        const ctImg = ct.album?.images?.[0];
        rpQvCurrent.innerHTML = `
            <div class="rp-qv-row">
                ${ctImg ? `<img src="${esc(ctImg.url)}" alt="">` : '<div class="rp-qv-thumb-empty"></div>'}
                <div class="rp-qv-text">
                    <div class="rp-qv-title">${esc(ct.name)}</div>
                    <div class="rp-qv-artist">${esc((ct.artists || []).map(a => a.name).join(', '))}</div>
                </div>
                <div class="rp-qv-duration">${fmt(ct.duration_ms)}</div>
            </div>`;

        const queue = data.queue || [];
        if (queue.length === 0) {
            rpQvList.innerHTML = '';
            rpQvNone.hidden = false;
        } else {
            rpQvNone.hidden = true;
            rpQvList.innerHTML = queue.map(t => {
                const thumb = t.album?.images?.slice(-1)[0];
                const thumbHtml = thumb
                    ? `<img src="${esc(thumb.url)}" alt="">`
                    : '<div class="rp-qv-thumb-empty"></div>';
                return `<li class="rp-queue-item">
                    <button class="rp-qv-btn" data-uri="${esc(t.uri)}">
                        ${thumbHtml}
                        <div class="rp-qv-text">
                            <div class="rp-qv-title">${esc(t.name)}</div>
                            <div class="rp-qv-artist">${esc((t.artists || []).map(a => a.name).join(', '))}</div>
                        </div>
                        <div class="rp-qv-duration">${fmt(t.duration_ms)}</div>
                    </button>
                </li>`;
            }).join('');
        }
    }

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function updatePlButtons(state) {
        const plPlayBtn    = document.querySelector('.pl-play-btn[data-context-uri]');
        const plShuffleBtn = document.querySelector('.pl-shuffle-btn[data-playlist-uri]');
        if (!plPlayBtn) return;
        const isThisCtx = state && state.context?.uri === plPlayBtn.dataset.contextUri;
        const playing   = isThisCtx && !state.paused;
        plPlayBtn.innerHTML         = playing ? '❚❚' : '▶';
        plPlayBtn.dataset.isPlaying = playing ? '1' : '0';
        if (plShuffleBtn) {
            plShuffleBtn.classList.toggle('ctrl-active', isThisCtx && state.shuffle);
        }
    }

    function updateRightPanel(state) {
        if (!state || !state.track_window.current_track) {
            rpEmpty.style.display   = '';
            rpContent.style.display = 'none';
            return;
        }
        rpEmpty.style.display   = 'none';
        rpContent.style.display = 'flex';

        const track = state.track_window.current_track;

        // Now Playing
        const img = track.album.images[0];
        rpArtEl.src              = img ? img.url : '';
        rpTitleEl.textContent    = track.name;
        rpArtistLine.textContent = track.artists.map(a => a.name).join(', ');
        rpAlbumEl.textContent    = track.album.name;

        // Queue — next tracks from SDK window
        const next = state.track_window.next_tracks.slice(0, 6);
        if (next.length === 0) {
            rpQueue.innerHTML   = '';
            rpQueueNone.hidden  = false;
        } else {
            rpQueueNone.hidden = true;
            rpQueue.innerHTML  = next.map(t => {
                const thumb = t.album.images[t.album.images.length - 1];
                const thumbHtml = thumb
                    ? `<img src="${esc(thumb.url)}" alt="">`
                    : `<div class="rp-queue-thumb-empty"></div>`;
                return `<li class="rp-queue-item">
                    <button class="rp-queue-btn" data-uri="${esc(t.uri)}">
                        ${thumbHtml}
                        <div class="rp-queue-text">
                            <div class="rp-queue-title">${esc(t.name)}</div>
                            <div class="rp-queue-artist">${esc(t.artists.map(a => a.name).join(', '))}</div>
                        </div>
                    </button>
                </li>`;
            }).join('');
        }

        maybeLoadLyrics(track);

        // Artist info — only re-fetch when artist changes
        const artistId = track.artists[0]?.id;
        if (artistId && artistId !== lastArtistId) {
            lastArtistId       = artistId;
            rpArtistInfo.innerHTML = '<p class="muted" style="font-size:12px;padding:4px 0">Loading…</p>';
            fetch(`/api/artist/${encodeURIComponent(artistId)}`)
                .then(r => r.json())
                .then(ar => {
                    if (ar.error) { rpArtistInfo.innerHTML = ''; return; }
                    const aImg      = ar.images?.[0];
                    const followers = (ar.followers?.total || 0).toLocaleString();
                    const genres    = (ar.genres || []).slice(0, 3).join(' · ');
                    rpArtistInfo.innerHTML = `
                        ${aImg ? `<img src="${esc(aImg.url)}" alt="" class="rp-artist-img">` : ''}
                        <div class="rp-artist-name">${esc(ar.name)}</div>
                        <div class="rp-artist-followers">${esc(followers)} followers</div>
                        ${genres ? `<div class="rp-artist-genres">${esc(genres)}</div>` : ''}
                        <a href="/artist/${esc(ar.id)}" class="rp-artist-link">View Artist</a>
                    `;
                })
                .catch(() => { rpArtistInfo.innerHTML = ''; });
        }
    }

    // Hook right panel into existing player_state_changed — patch via interval
    // since the SDK listener is already set up above; re-read state for right panel
    setInterval(() => {
        if (!player) return;
        player.getCurrentState().then(state => {
            if (state) { updateRightPanel(state); updatePlButtons(state); }
        });
    }, 2000);

    // ---- Right-click context menu ----
    const ctxMenu = document.createElement('div');
    ctxMenu.className = 'ctx-menu';
    ctxMenu.hidden = true;
    document.body.appendChild(ctxMenu);

    const ctxQueueBtn = document.createElement('button');
    ctxQueueBtn.className = 'ctx-item';
    ctxQueueBtn.textContent = 'Add to queue';
    ctxMenu.appendChild(ctxQueueBtn);

    let ctxUri = null;

    document.addEventListener('contextmenu', function (e) {
        const trackBtn = e.target.closest('[data-uri]')
                      || e.target.closest('tr')?.querySelector('[data-uri]');
        if (!trackBtn) { ctxMenu.hidden = true; return; }
        e.preventDefault();
        ctxUri = trackBtn.dataset.uri;
        ctxMenu.hidden = false;
        const x = Math.min(e.clientX, window.innerWidth  - ctxMenu.offsetWidth  - 8);
        const y = Math.min(e.clientY, window.innerHeight - ctxMenu.offsetHeight - 8);
        ctxMenu.style.left = x + 'px';
        ctxMenu.style.top  = y + 'px';
    });

    ctxQueueBtn.addEventListener('click', () => {
        ctxMenu.hidden = true;
        if (!ctxUri || !deviceId) return;
        fetch('/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, uri: ctxUri }),
        }).catch(() => {});
        ctxUri = null;
    });

    document.addEventListener('click',   (e) => { if (!ctxMenu.contains(e.target)) ctxMenu.hidden = true; });
    document.addEventListener('keydown',  (e) => { if (e.key === 'Escape') ctxMenu.hidden = true; });
    document.addEventListener('scroll',   ()  => { ctxMenu.hidden = true; }, true);

    // ---- Panel resize ----
    const root = document.documentElement;

    function makeResizable(handle, prop, getValue, min, max, onEnd) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handle.classList.add('is-dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = getComputedStyle(handle).cursor;

            function onDrag(e) {
                const val = Math.max(min, Math.min(max, getValue(e)));
                root.style.setProperty(prop, val + 'px');
            }
            function onUp() {
                handle.classList.remove('is-dragging');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onDrag);
                document.removeEventListener('mouseup',   onUp);
                if (onEnd) onEnd();
            }
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup',   onUp);
        });
    }

    makeResizable(
        document.querySelector('.resize-handle--sidebar'),
        '--sidebar-w',
        (e) => e.clientX,
        56, 400,
        () => {
            const w = getComputedStyle(root).getPropertyValue('--sidebar-w').trim();
            const sidebar = document.querySelector('.sidebar');
            const lsKey = sidebar.classList.contains('sidebar--collapsed')
                ? 'sidebar-collapsed-w'
                : 'sidebar-saved-w';
            localStorage.setItem(lsKey, w);
        }
    );
    makeResizable(
        document.querySelector('.resize-handle--right-panel'),
        '--right-panel-w',
        (e) => window.innerWidth - e.clientX,
        200, 480
    );
    makeResizable(
        document.querySelector('.resize-handle--player'),
        '--player-h',
        (e) => window.innerHeight - e.clientY,
        72, 160
    );
})();

// ---- Sidebar collapse ----
(function () {
    const sidebar = document.querySelector('.sidebar');
    const app     = document.querySelector('.app');
    const btn     = document.getElementById('sidebar-collapse-btn');
    if (!btn || !sidebar || !app) return;

    const root         = document.documentElement;
    const KEY          = 'sidebar-collapsed';
    const EXPANDED_KEY = 'sidebar-saved-w';
    const COLLAPSED_KEY = 'sidebar-collapsed-w';

    function setCollapsed(on) {
        const cur = getComputedStyle(root).getPropertyValue('--sidebar-w').trim();
        sidebar.classList.toggle('sidebar--collapsed', on);
        app.classList.toggle('sidebar-collapsed', on);
        btn.textContent = on ? '»' : '«';
        if (on) {
            localStorage.setItem(EXPANDED_KEY, cur);
            root.style.setProperty('--sidebar-w', localStorage.getItem(COLLAPSED_KEY) || '72px');
        } else {
            localStorage.setItem(COLLAPSED_KEY, cur);
            root.style.setProperty('--sidebar-w', localStorage.getItem(EXPANDED_KEY) || '240px');
        }
        localStorage.setItem(KEY, on ? '1' : '0');
    }

    btn.addEventListener('click', () => setCollapsed(!sidebar.classList.contains('sidebar--collapsed')));

    if (localStorage.getItem(KEY) === '1') setCollapsed(true);
})();
