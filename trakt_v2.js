/*!
 * trakt_v2.js — Lampa-Trakt Plugin v2
 * Phase 1 + classifier + multi-section layout: пункт меню + Activity component +
 * раскладка из 5 секций (Watchlist/Progress/Finished/Upcoming/Dropped) с
 * якорной шапкой-счётчиком и горизонтальными рядами карточек.
 *
 * Архитектура: см. SPEC_v2.md §«Раскладка экрана».
 * Зависимости: Lampa runtime; токен Trakt берётся из Lampa.Storage (выпускается плагином trakt_by_lampame)
 * Прокси Trakt API: https://apx.lme.isroot.in/trakt
 * TMDB API: https://api.themoviedb.org/3 (прямой, тот же ключ что у ядра Lampa)
 */
(function () {
    'use strict';

    var VERSION = '0.1.2';
    try { console.log('[trakt_v2] file loaded, version ' + VERSION + ' at ' + new Date().toISOString()); } catch (_) {}
    var COMPONENT = 'trakt_v2_main';
    var MENU_DATA_ATTR = 'trakt_v2_menu';
    var API_URL = 'https://apx.lme.isroot.in/trakt';
    var STORAGE_TOKEN_KEY = 'trakt_token';

    // TMDB. Ключ — встроенный в ядро Lampa. На Финальной независимости заменим на свой.
    var TMDB_URL = 'https://api.themoviedb.org/3';
    var TMDB_KEY = '4ef0d7355d9ffb5151e987764708ce96';
    var TMDB_IMG = 'https://image.tmdb.org/t/p';

    // ────────────────────────────────────────────────────────────────────
    // Status codes (внутренние, как в v1; UI отображает английские лейблы на этапе разработки)
    // ────────────────────────────────────────────────────────────────────
    var STATUS = { WATCHLIST: 'watchlist', PROGRESS: 'progress', FINISHED: 'finished', UPCOMING: 'upcoming', DROPPED: 'dropped' };
    var STATUS_ORDER = ['watchlist', 'progress', 'finished', 'upcoming', 'dropped'];
    // Английские слова намеренно отличаются от нативных Lampa-папок («Просмотрено»,
    // «Брошено») — чтобы при появлении нашего сайдбара на детальной карточке (Phase 2)
    // не было визуальной коллизии с нативным Lampa.Favorite.
    var STATUS_LABEL = {
        watchlist: { ru: 'Watchlist', en: 'Watchlist', uk: 'Watchlist' },
        progress:  { ru: 'Progress',  en: 'Progress',  uk: 'Progress'  },
        finished:  { ru: 'Finished',  en: 'Finished',  uk: 'Finished'  },
        upcoming:  { ru: 'Upcoming',  en: 'Upcoming',  uk: 'Upcoming'  },
        dropped:   { ru: 'Dropped',   en: 'Dropped',   uk: 'Dropped'   }
    };

    // ────────────────────────────────────────────────────────────────────
    // Локализация
    // ────────────────────────────────────────────────────────────────────
    function registerLang() {
        if (!window.Lampa || !Lampa.Lang || typeof Lampa.Lang.add !== 'function') return;
        Lampa.Lang.add({
            trakt_v2_menu_title:        { ru: 'Trakt v2', en: 'Trakt v2', uk: 'Trakt v2' },
            trakt_v2_screen_title:      { ru: 'Trakt',    en: 'Trakt',    uk: 'Trakt' },
            trakt_v2_no_token:          {
                ru: 'Войдите в Trakt через настройки плагина TraktTV',
                en: 'Log in to Trakt via the TraktTV plugin settings',
                uk: 'Увійдіть у Trakt через налаштування плагіна TraktTV'
            },
            trakt_v2_load_error:        {
                ru: 'Не удалось загрузить данные из Trakt',
                en: 'Failed to load Trakt data',
                uk: 'Не вдалося завантажити дані з Trakt'
            },
            trakt_v2_section_empty:     { ru: 'пусто', en: 'empty', uk: 'порожньо' }
        });
    }

    function uiLang() {
        try { return String(Lampa.Storage.get('language') || 'ru') || 'ru'; }
        catch (_) { return 'ru'; }
    }
    function statusLabel(status) {
        var l = uiLang();
        var pack = STATUS_LABEL[status] || {};
        return pack[l] || pack.en || status;
    }

    // ────────────────────────────────────────────────────────────────────
    // Network: Trakt
    // ────────────────────────────────────────────────────────────────────
    function getToken() {
        try { return String(Lampa.Storage.get(STORAGE_TOKEN_KEY) || ''); }
        catch (e) { return ''; }
    }

    function apiGet(path) {
        return new Promise(function (resolve, reject) {
            var token = getToken();
            if (!token) { reject({ status: 401, code: 'no_token' }); return; }
            var xhr = new XMLHttpRequest();
            try { xhr.open('GET', API_URL + path, true); }
            catch (e) { reject({ status: 0, code: 'open_failed', error: e }); return; }
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('trakt-api-version', '2');
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.timeout = 20000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null); }
                    catch (e) { reject({ status: 0, code: 'parse_error', error: e }); }
                } else {
                    reject({ status: xhr.status, code: 'http_error', body: xhr.responseText });
                }
            };
            xhr.onerror = function () { reject({ status: 0, code: 'network' }); };
            xhr.ontimeout = function () { reject({ status: 0, code: 'timeout' }); };
            xhr.send();
        });
    }

    // ────────────────────────────────────────────────────────────────────
    // Network: TMDB
    // ────────────────────────────────────────────────────────────────────
    var _tmdbCache = {};

    function tmdbGet(method, id) {
        var key = method + '/' + id;
        if (_tmdbCache[key]) return Promise.resolve(_tmdbCache[key]);
        return new Promise(function (resolve, reject) {
            var url = TMDB_URL + '/' + method + '/' + id +
                      '?api_key=' + TMDB_KEY +
                      '&language=' + encodeURIComponent(uiLang());
            var xhr = new XMLHttpRequest();
            try { xhr.open('GET', url, true); }
            catch (e) { reject({ status: 0, code: 'open_failed', error: e }); return; }
            xhr.timeout = 15000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        var data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                        _tmdbCache[key] = data;
                        resolve(data);
                    } catch (e) { reject({ status: 0, code: 'parse_error', error: e }); }
                } else {
                    reject({ status: xhr.status, code: 'http_error' });
                }
            };
            xhr.onerror = function () { reject({ status: 0, code: 'network' }); };
            xhr.ontimeout = function () { reject({ status: 0, code: 'timeout' }); };
            xhr.send();
        });
    }

    // ────────────────────────────────────────────────────────────────────
    // Card-data builders
    // ────────────────────────────────────────────────────────────────────
    function formatMedia(media, type) {
        if (!media || !media.ids) return null;
        var tmdbId = media.ids.tmdb || null;
        if (!tmdbId) return null;
        return {
            component: 'full',
            id: tmdbId,
            ids: media.ids,
            title: media.title || '',
            original_title: media.title || '',
            release_date: media.year ? String(media.year) : '',
            vote_average: Number(media.rating || 0),
            poster: '',
            image: '',
            poster_path: '',
            backdrop_path: '',
            method: type === 'movie' ? 'movie' : 'tv',
            card_type: type === 'movie' ? 'movie' : 'tv'
        };
    }

    function enrichWithTmdb(card) {
        return tmdbGet(card.method, card.id).then(function (data) {
            if (!data) return card;
            if (data.poster_path) {
                card.poster_path = data.poster_path;
                card.poster = TMDB_IMG + '/w300' + data.poster_path;
                card.img = card.poster;
            }
            if (data.backdrop_path) {
                card.backdrop_path = data.backdrop_path;
                card.image = TMDB_IMG + '/w500' + data.backdrop_path;
                card.background_image = card.image;
            }
            if (card.method === 'movie') {
                if (data.title) card.title = data.title;
                if (data.original_title) card.original_title = data.original_title;
                if (data.release_date) card.release_date = data.release_date;
            } else {
                if (data.name) card.title = data.name;
                if (data.original_name) card.original_title = data.original_name;
                if (data.first_air_date) card.release_date = data.first_air_date;
                card.name = data.name || card.title;
                card.original_name = data.original_name || card.original_title;
            }
            if (typeof data.vote_average === 'number') card.vote_average = data.vote_average;
            if (Array.isArray(data.genres)) {
                card.genres = data.genres;
                card.genre_ids = data.genres.map(function (g) { return g.id; });
            }
            return card;
        }).catch(function (err) {
            try { console.warn('[trakt_v2] tmdb enrich failed', card.method, card.id, err); } catch (_) {}
            return card;
        });
    }

    function enrichAll(cards) {
        if (!cards || !cards.length) return Promise.resolve(cards);
        return Promise.all(cards.map(enrichWithTmdb));
    }

    // ────────────────────────────────────────────────────────────────────
    // Classifier (SPEC §«Классификатор статуса»)
    // ────────────────────────────────────────────────────────────────────
    function classifyMovie(node) {
        if (node.dropped) return STATUS.DROPPED;
        if (node.in_watched) return STATUS.FINISHED;
        if (node.in_watchlist) return STATUS.WATCHLIST;
        return null;
    }

    function classifyShow(node) {
        if (node.dropped) return STATUS.DROPPED;
        var p = node.progress;
        var completed = p ? Number(p.completed || 0) : 0;
        if (completed === 0) {
            return node.in_watchlist ? STATUS.WATCHLIST : null;
        }
        var hasNext = p && p.next_episode;
        if (hasNext) return STATUS.PROGRESS;
        var s = String(node.media.status || '').toLowerCase();
        if (s === 'ended' || s === 'canceled') return STATUS.FINISHED;
        return STATUS.UPCOMING;
    }

    // ────────────────────────────────────────────────────────────────────
    // Main fetch — 6 эндпоинтов, дедуп, progress per-show, классификатор, TMDB
    // ────────────────────────────────────────────────────────────────────
    function fetchAll() {
        function fetchSafe(path) {
            return apiGet(path).catch(function (err) {
                try { console.warn('[trakt_v2] fetch failed', path, err); } catch (_) {}
                return [];
            });
        }
        return Promise.all([
            fetchSafe('/sync/watchlist/movies?extended=full'),
            fetchSafe('/sync/watchlist/shows?extended=full'),
            fetchSafe('/sync/watched/movies?extended=full'),
            fetchSafe('/sync/watched/shows?extended=full'),
            fetchSafe('/users/hidden/progress_watched?type=show&limit=1000'),
            fetchSafe('/users/hidden/dropped?type=show&limit=1000')
        ]).then(function (rows) {
            var wlMovies      = rows[0] || [];
            var wlShows       = rows[1] || [];
            var watchedMovies = rows[2] || [];
            var watchedShows  = rows[3] || [];
            var hiddenPW      = rows[4] || [];
            var hiddenDR      = rows[5] || [];

            try {
                console.log('[trakt_v2] raw fetch:',
                    'wlMov=' + wlMovies.length,
                    'wlSh=' + wlShows.length,
                    'wMov=' + watchedMovies.length,
                    'wSh=' + watchedShows.length,
                    'hPW=' + hiddenPW.length,
                    'hDR=' + hiddenDR.length);
            } catch (_) {}

            var droppedTmdb = {};
            function addDropped(arr) {
                for (var i = 0; i < arr.length; i++) {
                    var s = arr[i] && arr[i].show;
                    if (s && s.ids && s.ids.tmdb) droppedTmdb[s.ids.tmdb] = true;
                }
            }
            addDropped(hiddenPW);
            addDropped(hiddenDR);

            var byKey = {};
            function ensureNode(type, media, listedAt) {
                if (!media || !media.ids || !media.ids.tmdb) return null;
                var k = type + ':' + media.ids.tmdb;
                if (!byKey[k]) {
                    byKey[k] = {
                        type: type,
                        media: media,
                        listed_at: listedAt || null,
                        in_watchlist: false,
                        in_watched: false,
                        progress: null,
                        dropped: false
                    };
                } else {
                    if (listedAt && (!byKey[k].listed_at || Date.parse(listedAt) > Date.parse(byKey[k].listed_at))) {
                        byKey[k].listed_at = listedAt;
                    }
                    if (!byKey[k].media.status && media.status) byKey[k].media = media;
                }
                return byKey[k];
            }

            function processWatchlist(arr, type) {
                for (var i = 0; i < arr.length; i++) {
                    var item = arr[i];
                    var media = type === 'movie' ? item.movie : item.show;
                    var n = ensureNode(type, media, item.listed_at);
                    if (n) n.in_watchlist = true;
                }
            }
            function processWatched(arr, type) {
                for (var i = 0; i < arr.length; i++) {
                    var item = arr[i];
                    var media = type === 'movie' ? item.movie : item.show;
                    var n = ensureNode(type, media, item.last_watched_at);
                    if (n) n.in_watched = true;
                }
            }
            processWatchlist(wlMovies, 'movie');
            processWatchlist(wlShows,  'show');
            processWatched(watchedMovies, 'movie');
            processWatched(watchedShows,  'show');

            Object.keys(byKey).forEach(function (k) {
                var n = byKey[k];
                if (n.type === 'show' && n.media.ids.tmdb && droppedTmdb[n.media.ids.tmdb]) {
                    n.dropped = true;
                }
            });

            var progressTargets = [];
            Object.keys(byKey).forEach(function (k) {
                var n = byKey[k];
                if (n.type === 'show' && n.in_watched && !n.dropped && n.media.ids.trakt) {
                    progressTargets.push(n);
                }
            });

            return Promise.all(progressTargets.map(function (n) {
                return apiGet('/shows/' + n.media.ids.trakt + '/progress/watched')
                    .then(function (p) { n.progress = p; })
                    .catch(function (err) {
                        try { console.warn('[trakt_v2] progress fetch failed', n.media.ids.trakt, err); } catch (_) {}
                    });
            })).then(function () {
                var classified = [];
                var counts = { watchlist: 0, progress: 0, finished: 0, upcoming: 0, dropped: 0 };
                Object.keys(byKey).forEach(function (k) {
                    var n = byKey[k];
                    var status = n.type === 'movie' ? classifyMovie(n) : classifyShow(n);
                    if (!status) return;
                    var card = formatMedia(n.media, n.type);
                    if (!card) return;
                    card.trakt_status = status;
                    card.trakt_listed_at = n.listed_at;
                    classified.push(card);
                    counts[status]++;
                });

                try {
                    console.log('[trakt_v2] classifier:',
                        'total=' + classified.length,
                        'watchlist=' + counts.watchlist,
                        'progress=' + counts.progress,
                        'finished=' + counts.finished,
                        'upcoming=' + counts.upcoming,
                        'dropped=' + counts.dropped);
                } catch (_) {}

                classified.sort(function (a, b) {
                    var sa = STATUS_ORDER.indexOf(a.trakt_status);
                    var sb = STATUS_ORDER.indexOf(b.trakt_status);
                    if (sa !== sb) return sa - sb;
                    var ta = Date.parse(a.trakt_listed_at || '') || 0;
                    var tb = Date.parse(b.trakt_listed_at || '') || 0;
                    return tb - ta;
                });

                return enrichAll(classified).then(function (enriched) {
                    try {
                        var withPoster = 0;
                        for (var i = 0; i < enriched.length; i++) if (enriched[i].poster) withPoster++;
                        console.log('[trakt_v2] tmdb enriched: with_poster=' + withPoster + '/' + enriched.length);
                    } catch (_) {}
                    return enriched;
                });
            });
        });
    }

    // ────────────────────────────────────────────────────────────────────
    // Layout helpers — стиль и шаблоны
    // ────────────────────────────────────────────────────────────────────
    var STYLE_INJECTED = false;
    function injectStyles() {
        if (STYLE_INJECTED) return;
        STYLE_INJECTED = true;
        var css =
        '.trakt_v2 { padding: 1.5em 1.5em 4em 1.5em; }' +
        '.trakt_v2__anchors { display: flex; flex-wrap: wrap; gap: 0.6em; margin-bottom: 1.5em; }' +
        '.trakt_v2__anchor { padding: 0.6em 1.2em; border-radius: 0.4em; background: rgba(255,255,255,0.06); color: #fff; font-weight: 600; cursor: pointer; }' +
        '.trakt_v2__anchor.focus, .trakt_v2__anchor.hover { background: #fff; color: #000; }' +
        '.trakt_v2__anchor--empty { opacity: 0.45; }' +
        '.trakt_v2__anchor-count { display: inline-block; margin-left: 0.5em; padding: 0 0.5em; border-radius: 0.7em; background: rgba(255,255,255,0.18); font-size: 0.8em; }' +
        '.trakt_v2__anchor.focus .trakt_v2__anchor-count, .trakt_v2__anchor.hover .trakt_v2__anchor-count { background: rgba(0,0,0,0.18); }' +
        '.trakt_v2__section { margin-bottom: 2em; }' +
        '.trakt_v2__section-title { font-size: 1.4em; font-weight: 700; margin-bottom: 0.6em; color: #fff; }' +
        '.trakt_v2__row { display: flex; flex-wrap: nowrap; gap: 1.2em; padding: 0.5em 0.2em 1em 0.2em; overflow-x: hidden; }' +
        '.trakt_v2__empty { padding: 1.2em 0; color: rgba(255,255,255,0.5); font-style: italic; }' +
        '.trakt_v2_card { flex: 0 0 auto; width: 13em; cursor: pointer; }' +
        '.trakt_v2_card__view { position: relative; width: 100%; aspect-ratio: 2/3; background: #1a1a1a; border-radius: 0.4em; overflow: hidden; box-shadow: 0 0.2em 0.5em rgba(0,0,0,0.4); transition: transform 0.15s; }' +
        '.trakt_v2_card.focus .trakt_v2_card__view, .trakt_v2_card.hover .trakt_v2_card__view { transform: scale(1.06); box-shadow: 0 0 0 0.2em #fff, 0 0.4em 1em rgba(0,0,0,0.6); }' +
        '.trakt_v2_card__img { width: 100%; height: 100%; object-fit: cover; display: block; }' +
        '.trakt_v2_card__nopost { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 0.5em; box-sizing: border-box; text-align: center; color: rgba(255,255,255,0.7); font-size: 0.85em; }' +
        '.trakt_v2_card__type { position: absolute; top: 0.5em; right: 0.5em; padding: 0.15em 0.5em; background: rgba(0,0,0,0.7); border-radius: 0.3em; font-size: 0.7em; color: #fff; text-transform: uppercase; letter-spacing: 0.05em; }' +
        '.trakt_v2_card__vote { position: absolute; bottom: 0.5em; left: 0.5em; padding: 0.15em 0.5em; background: rgba(0,0,0,0.75); border-radius: 0.3em; font-size: 0.75em; font-weight: 700; color: #ffcc00; }' +
        '.trakt_v2_card__title { margin-top: 0.5em; font-size: 0.95em; line-height: 1.25; color: #fff; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; max-height: 2.5em; }' +
        '.trakt_v2_card__year { margin-top: 0.2em; font-size: 0.8em; color: rgba(255,255,255,0.6); }' +
        '';
        try {
            var s = document.createElement('style');
            s.setAttribute('data-trakt-v2', 'styles');
            s.textContent = css;
            document.head.appendChild(s);
        } catch (e) {
            try { console.warn('[trakt_v2] style inject failed', e); } catch (_) {}
        }
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function buildCardEl(card_data) {
        var el = document.createElement('div');
        el.className = 'trakt_v2_card selector';
        var year = '';
        if (card_data.release_date) {
            var m = String(card_data.release_date).match(/^(\d{4})/);
            if (m) year = m[1];
        }
        var voteHtml = '';
        if (card_data.vote_average && Number(card_data.vote_average) > 0) {
            voteHtml = '<div class="trakt_v2_card__vote">' + Number(card_data.vote_average).toFixed(1) + '</div>';
        }
        var typeHtml = card_data.method === 'tv' ? '<div class="trakt_v2_card__type">TV</div>' : '';
        var imgHtml = card_data.poster
            ? '<img class="trakt_v2_card__img" src="' + escapeHtml(card_data.poster) + '"/>'
            : '<div class="trakt_v2_card__nopost">' + escapeHtml(card_data.title || '') + '</div>';
        el.innerHTML =
            '<div class="trakt_v2_card__view">' +
                imgHtml +
                typeHtml +
                voteHtml +
            '</div>' +
            '<div class="trakt_v2_card__title">' + escapeHtml(card_data.title || '') + '</div>' +
            (year ? '<div class="trakt_v2_card__year">' + escapeHtml(year) + '</div>' : '');
        return el;
    }

    // ────────────────────────────────────────────────────────────────────
    // Activity component (custom — без InteractionCategory)
    // ────────────────────────────────────────────────────────────────────
    function MainComponent(object) {
        var self = this;
        injectStyles();

        var html       = $('<div class="trakt_v2"></div>');
        var anchorsBar = $('<div class="trakt_v2__anchors"></div>');
        var bodyEl     = $('<div class="trakt_v2__body"></div>');
        var scroll     = new Lampa.Scroll({ mask: true, over: true, step: 250 });

        var sectionEl = {};   // status -> jQuery wrapper for the section
        var lastFocus = null; // last focused DOM element (for resume)

        self.activity = null;

        // html -> внутрь scroll сразу, чтобы render() вернул валидный контейнер
        scroll.append(html);

        self.create = function () {
            try { console.log('[trakt_v2] component.create called'); } catch (_) {}
            if (self.activity) self.activity.loader(true);

            if (!getToken()) {
                renderEmpty(Lampa.Lang.translate('trakt_v2_no_token'));
                return;
            }

            fetchAll().then(function (results) {
                renderSections(results);
                if (self.activity) self.activity.loader(false);
                if (self.activity && typeof self.activity.toggle === 'function') self.activity.toggle();
            }).catch(function (err) {
                try { console.warn('[trakt_v2] fetchAll failed', err); } catch (_) {}
                var msg = (err && err.code === 'no_token')
                    ? Lampa.Lang.translate('trakt_v2_no_token')
                    : Lampa.Lang.translate('trakt_v2_load_error');
                renderEmpty(msg);
            });
        };

        function renderEmpty(text) {
            try {
                if (Lampa.Empty) {
                    var ev = new Lampa.Empty({ descr: text });
                    html.empty().append(ev.render());
                    self.start = ev.start;
                } else {
                    html.empty().append('<div class="trakt_v2__empty" style="padding:3em;text-align:center;">' + escapeHtml(text) + '</div>');
                }
            } catch (e) {
                html.empty().append('<div class="trakt_v2__empty" style="padding:3em;text-align:center;">' + escapeHtml(text) + '</div>');
            }
            if (self.activity) self.activity.loader(false);
        }

        function renderSections(results) {
            var byStatus = { watchlist: [], progress: [], finished: [], upcoming: [], dropped: [] };
            for (var i = 0; i < results.length; i++) {
                var s = results[i].trakt_status;
                if (byStatus[s]) byStatus[s].push(results[i]);
            }

            // anchor bar
            anchorsBar.empty();
            STATUS_ORDER.forEach(function (status) {
                var count = byStatus[status].length;
                var label = statusLabel(status);
                var $a = $(
                    '<div class="trakt_v2__anchor selector" data-status="' + status + '">' +
                        '<span class="trakt_v2__anchor-label">' + escapeHtml(label) + '</span>' +
                        '<span class="trakt_v2__anchor-count">' + count + '</span>' +
                    '</div>'
                );
                if (count === 0) $a.addClass('trakt_v2__anchor--empty');
                $a.on('hover:focus', function () {
                    lastFocus = this;
                    scroll.update($(this));
                });
                $a.on('hover:enter', function () {
                    var st = $(this).attr('data-status');
                    var $sect = sectionEl[st];
                    if ($sect && $sect.length) {
                        scroll.update($sect, true);
                        var $firstCard = $sect.find('.trakt_v2_card.selector').eq(0);
                        if ($firstCard.length) {
                            try {
                                Lampa.Controller.collectionFocus($firstCard.get(0), scroll.render());
                                lastFocus = $firstCard.get(0);
                            } catch (e) {}
                        }
                    }
                });
                anchorsBar.append($a);
            });

            // sections
            bodyEl.empty();
            STATUS_ORDER.forEach(function (status) {
                var items = byStatus[status];
                var label = statusLabel(status);
                var $sect = $(
                    '<div class="trakt_v2__section" data-status="' + status + '">' +
                        '<div class="trakt_v2__section-title">' + escapeHtml(label) + ' <span style="opacity:0.55;font-weight:400">(' + items.length + ')</span></div>' +
                        '<div class="trakt_v2__row"></div>' +
                    '</div>'
                );
                var $row = $sect.find('.trakt_v2__row');
                if (items.length === 0) {
                    $row.append('<div class="trakt_v2__empty">' + escapeHtml(Lampa.Lang.translate('trakt_v2_section_empty')) + '</div>');
                } else {
                    items.forEach(function (cd) {
                        var el = buildCardEl(cd);
                        var $el = $(el);
                        $el.on('hover:focus', function () {
                            lastFocus = this;
                            scroll.update($(this));
                        });
                        $el.on('hover:enter', function () {
                            try {
                                Lampa.Activity.push({
                                    url: '',
                                    component: 'full',
                                    id: cd.id,
                                    method: cd.method,
                                    card: cd,
                                    source: 'tmdb'
                                });
                            } catch (e) {
                                try { console.warn('[trakt_v2] activity push failed', e); } catch (_) {}
                            }
                        });
                        $row.append($el);
                    });
                }
                bodyEl.append($sect);
                sectionEl[status] = $sect;
            });

            // html уже внутри scroll (см. конструктор) — просто перестраиваем содержимое
            html.empty();
            html.append(anchorsBar);
            html.append(bodyEl);
        }

        self.empty = function (text) {
            renderEmpty(text || '');
        };

        self.start = function () {
            try { console.log('[trakt_v2] component.start called'); } catch (_) {}
            if (self.activity) self.activity.loader(false);
            Lampa.Controller.add('content', {
                link: self,
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    if (!lastFocus) {
                        var $first = anchorsBar.find('.selector').eq(0);
                        lastFocus = $first.length ? $first.get(0) : null;
                    }
                    Lampa.Controller.collectionFocus(lastFocus || false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Navigator.canmove('down')) Navigator.move('down');
                },
                back: self.back
            });
            Lampa.Controller.toggle('content');
        };

        self.pause = function () {};
        self.stop  = function () {};
        self.back  = function () { Lampa.Activity.backward(); };

        self.render = function () { return scroll.render(); };

        self.destroy = function () {
            try { scroll.destroy(); } catch (_) {}
            try { html.remove(); } catch (_) {}
            sectionEl = {};
            lastFocus = null;
        };

        return self;
    }

    // ────────────────────────────────────────────────────────────────────
    // DOM-инъекция пункта в левое меню
    // ────────────────────────────────────────────────────────────────────
    function ICON() {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="7 13 10 16 17 9"/></svg>';
    }

    function injectMenuItem() {
        if (!window.$ || !window.Lampa) return;
        var $list = $('.menu .menu__list').eq(0);
        if (!$list.length) return;
        if ($list.find('[data-trakt-v2="' + MENU_DATA_ATTR + '"]').length) return;

        var title = Lampa.Lang.translate('trakt_v2_menu_title') + ' ' + VERSION;
        var $item = $(
            '<li class="menu__item selector" data-trakt-v2="' + MENU_DATA_ATTR + '">' +
                '<div class="menu__ico">' + ICON() + '</div>' +
                '<div class="menu__text">' + title + '</div>' +
            '</li>'
        );

        $item.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: Lampa.Lang.translate('trakt_v2_screen_title'),
                component: COMPONENT,
                page: 1
            });
        });

        $list.append($item);
    }

    // ────────────────────────────────────────────────────────────────────
    // Bootstrap
    // ────────────────────────────────────────────────────────────────────
    function start() {
        if (window.trakt_v2_started) return;
        window.trakt_v2_started = true;

        registerLang();
        Lampa.Component.add(COMPONENT, MainComponent);

        if (window.appready) {
            injectMenuItem();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') injectMenuItem();
            });
        }

        try { console.log('[trakt_v2]', 'started, version', VERSION); } catch (_) {}
    }

    function whenLampaReady() {
        if (window.Lampa && Lampa.Activity && Lampa.Component && Lampa.Listener) {
            start();
            return;
        }
        var iv = setInterval(function () {
            if (window.Lampa && Lampa.Activity && Lampa.Component && Lampa.Listener) {
                clearInterval(iv);
                start();
            }
        }, 200);
    }

    whenLampaReady();
})();
