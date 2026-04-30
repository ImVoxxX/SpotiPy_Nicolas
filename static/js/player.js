(function () {
    const audio = document.getElementById('player-audio');
    if (!audio) return;

    const playBtn = document.getElementById('player-play');
    const seek = document.getElementById('player-seek');
    const volume = document.getElementById('player-volume');
    const titleEl = document.getElementById('player-title');
    const artistEl = document.getElementById('player-artist');
    const artEl = document.getElementById('player-art');
    const timeEl = document.getElementById('player-time');
    const durEl = document.getElementById('player-duration');

    audio.volume = 0.7;

    function fmt(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function loadAndPlay(btn) {
        const url = btn.dataset.preview;
        if (!url) return;
        const title = btn.dataset.title || '';
        const artist = btn.dataset.artist || '';
        const art = btn.dataset.art || '';

        if (audio.src.endsWith(url) && !audio.paused) {
            audio.pause();
            return;
        }
        if (audio.src.endsWith(url) && audio.paused && audio.currentTime > 0) {
            audio.play();
            return;
        }

        audio.src = url;
        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(() => { /* ignore autoplay errors */ });
        }
        titleEl.textContent = title || 'Untitled';
        artistEl.textContent = artist;
        if (art) {
            artEl.src = art;
            artEl.hidden = false;
        } else {
            artEl.hidden = true;
        }
    }

    document.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-preview]');
        if (!btn) return;
        if (e.target.closest('a')) return;
        e.preventDefault();
        loadAndPlay(btn);
    });

    playBtn.addEventListener('click', function () {
        if (!audio.src) return;
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    });

    audio.addEventListener('play', function () { playBtn.textContent = '❚❚'; });
    audio.addEventListener('pause', function () { playBtn.textContent = '▶'; });
    audio.addEventListener('ended', function () {
        playBtn.textContent = '▶';
        seek.value = 0;
        timeEl.textContent = '0:00';
    });

    audio.addEventListener('timeupdate', function () {
        if (audio.duration) {
            seek.value = (audio.currentTime / audio.duration) * 100;
            timeEl.textContent = fmt(audio.currentTime);
        }
    });

    audio.addEventListener('loadedmetadata', function () {
        durEl.textContent = fmt(audio.duration);
    });

    seek.addEventListener('input', function () {
        if (audio.duration) {
            audio.currentTime = (seek.value / 100) * audio.duration;
        }
    });

    volume.addEventListener('input', function () {
        audio.volume = volume.value / 100;
    });
})();
