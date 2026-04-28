/*!
 * trakt_v2.js — Lampa-Trakt Plugin v2
 * Phase 1 + classifier + multi-section layout:
 * пункт меню + Activity component + 5 секций (Watchlist/Progress/Finished/
 * Upcoming/Dropped) через нативный Lampa.InteractionLine.
 *
 * v0.1.4: переписана раскладка на нативные примитивы Lampa после ресёрча
 * нативного экрана «Избранное» (компонент `bookmarks`). Outer Lampa.Scroll
 * (vertical, mask:true, over:true) + 5 × Lampa.InteractionLine. Карточки
 * стандартные (через встроенный path InteractionLine → new Lampa.Card).
 *
 * v0.1.5: фикс D-pad навигации. Убран outer Controller.add('content') —
 * он конфликтовал с встроенным `items_line` controller InteractionLine
 * (нативный bookmarks тоже использует только `items_line`). Активация
 * первой линии через lines[0].toggle(); каждой линии заданы onUp/onDown,
 * которые переключают controller на соседний ряд через .toggle();
 * onLeft с самого левого края → выход в меню; onToggle синхронизирует
 * outer вертикальный scroll и триггерит lazy-load постеров через
 * scroll.update.
 *
 * v0.1.6: вернули тонкий 'content' controller — НО с делегацией на
 * lastFocused.toggle() в его toggle(), без своих left/right/up/down
 * на активном слое. Это нужно для возврата фокуса из menu/head в активити:
 * фреймворк делает Controller.toggle('content') и наш content сразу
 * пере-активирует items_line. Постеры — теперь руками выпускаем
 * 'visible' event на каждой линии после монтажа, что триггерит
 * InteractionLine.visible() → Layer.visible(scroll.render) → lazy-load
 * картинок без необходимости прокрутки.
 *
 * Архитектура: см. SPEC_v2.md §«Раскладка экрана»
 * Зависимости: Lampa runtime; токен Trakt берётся из Lampa.Storage (выпускается плагином trakt_by_lampame)
 * Прокси Trakt API: https://apx.lme.isroot.in/trakt
 * TMDB API: https://api.themoviedb.org/3 (прямой, тот же ключ что у ядра Lampa)
 */
(function () {
    'use strict';

    var VERSION = '0.1.6';
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
    // Status codes (внутренние, как в v1; UI отображает русские имена)
    // ────────────────────────────────────────────────────────────────────
    var STATUS = { WATCHLIST: 'watchlist', PROGRESS: 'progress', FINISHED: 'finished', UPCOMING: 'upcoming', DROPPED: 'dropped' };
    var STATUS_ORDER = ['watchlist', 'progress', 'finished', 'upcoming', 'dropped'];
    // Лейблы в UI. Английские — рабочие на этапе разработки и тестов;
    // в финале можно перевести на русский / другой язык (см. SPEC §«Модель папок»).
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

    function tmdbLang() {
        try { return String(Lampa.Storage.get('language') || 'ru') || 'ru'; }
        catch (_) { return 'ru'; }
    }

    function tmdbGet(method, id) {
        var key = method + '/' + id;
        if (_tmdbCache[key]) return Promise.resolve(_tmdbCache[key]);
        return new Promise(function (resolve, reject) {
            var url = TMDB_URL + '/' + method + '/' + id +
                      '?api_key=' + TMDB_KEY +
                      '&language=' + encodeURIComponent(tmdbLang());
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
        // hidden API не поддерживает type=movie, но если custom-list "Брошено"
        // в будущем подключим — сюда зайдёт node.dropped через него.
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
        // returning series / in production / planned / pilot — всё это «ждём новых серий»
        return STATUS.UPCOMING;
    }

    // ────────────────────────────────────────────────────────────────────
    // Main fetch: тянем все 6 эндпоинтов параллельно, дедупим, доходим до
    // /shows/:id/progress/watched для каждого show с completed > 0,
    // классифицируем, обогащаем TMDB.
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

            // Множество скрытых tmdb-id (только сериалы — hidden API без type=movie)
            var droppedTmdb = {};
            function addDropped(arr) {
                for (var i = 0; i < arr.length; i++) {
                    var s = arr[i] && arr[i].show;
                    if (s && s.ids && s.ids.tmdb) droppedTmdb[s.ids.tmdb] = true;
                }
            }
            addDropped(hiddenPW);
            addDropped(hiddenDR);

            // Дедуп по ключу type:tmdb. Узел копит флаги принадлежности к источникам.
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
                    // extended=full даёт media.status у show — берём ту версию media,
                    // в которой это поле есть.
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

            // Помечаем dropped (только shows — hidden API без type=movie)
            Object.keys(byKey).forEach(function (k) {
                var n = byKey[k];
                if (n.type === 'show' && n.media.ids.tmdb && droppedTmdb[n.media.ids.tmdb]) {
                    n.dropped = true;
                }
            });

            // Per-show progress fetch (только для shows в watched — иначе progress
            // не нужен). Параллельно. На большой коллекции имеет смысл батчить,
            // но Trakt rate limit 1000/5мин — на десятки шоу запас огромный.
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
                // Классификация + сборка card-data
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

                // Сортировка: сначала по приоритету статуса, внутри — по listed_at desc
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
    // Activity component — v0.1.6: 5 секций через Lampa.InteractionLine
    // ────────────────────────────────────────────────────────────────────
    //
    // Архитектура:
    //   outer  → Lampa.Scroll({mask:true, over:true}) — только вертикальный
    //            "viewport" со scroll-mask, без своего controller.
    //   inside →  5 × Lampa.InteractionLine — по одной на статус
    //              (Watchlist/Progress/Finished/Upcoming/Dropped).
    //   каждый  InteractionLine сам управляет horizontal scroll и
    //   регистрирует controller 'items_line' (см. ресёрч лога 1777353372098)
    //   при вызове .toggle(). Один InteractionLine == один controller-овский
    //   слой; переключение фокуса между рядами осуществляется простым
    //   вызовом prevLine.toggle()/nextLine.toggle() из onUp/onDown текущего
    //   ряда. Outer Scroll слушает onToggle ряда и подтягивает viewport.
    //   Контроллер 'content' зарегистрирован как тонкий entry-point —
    //   его toggle() делегирует на lastFocused.toggle(), и сразу же
    //   активным становится 'items_line'. Это нужно, чтобы фреймворк
    //   мог вернуть фокус в активити по Controller.toggle('content')
    //   (триггерится из menu и head при возврате).
    //
    // Якорная строка (bookmarks-folder со счётчиками) — следующая итерация.

    function uiLang() {
        try { return String(Lampa.Storage.get('language') || 'ru') || 'ru'; }
        catch (_) { return 'ru'; }
    }

    function statusLabel(status) {
        var l = uiLang();
        var pack = STATUS_LABEL[status] || {};
        return pack[l] || pack.en || status;
    }

    function MainComponent(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="trakt_v2"></div>');
        var body = $('<div class="trakt_v2__body"></div>');
        var lines = [];          // массив Lampa.InteractionLine
        var lastFocused = null;  // последняя активная линия для toggle()

        this.activity = null;

        function buildSectionLine(status, items) {
            var title = statusLabel(status) + ' (' + items.length + ')';
            var data = {
                title: title,
                results: items.length ? items : [],
                source: 'tmdb',
                noimage: true   // не рисуем фон карточки в качестве background — у нас своя страница
            };
            var params = {
                object: object,
                nomore: true    // не показывать "More" — мы загружаем всё за один раз
            };
            var line = new Lampa.InteractionLine(data, params);
            line.create();

            // Перехват onFocus: запомнить ряд и подтянуть outer scroll
            // (на случай первичного входа без onToggle).
            line.onFocus = function (card_data) {
                lastFocused = line;
                try { scroll.update($(line.render(true)), true); } catch (_) {}
            };

            line.onEnter = function (target, card_data) {
                if (!card_data) return;
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    id: card_data.id,
                    method: card_data.method,
                    card: card_data,
                    source: 'tmdb'
                });
            };

            // Переключение между рядами: ищем индекс себя в массиве lines динамически
            // (он ещё не зафиксирован в момент создания — buildSections добавляет ряды
            // последовательно, поэтому считаем индекс в момент события).
            line.onUp = function () {
                var idx = lines.indexOf(line);
                var prev = idx > 0 ? lines[idx - 1] : null;
                if (prev) prev.toggle();
                else Lampa.Controller.toggle('head');
            };
            line.onDown = function () {
                var idx = lines.indexOf(line);
                var next = idx >= 0 && idx < lines.length - 1 ? lines[idx + 1] : null;
                if (next) next.toggle();
                // если ряд последний — оставляем фокус на месте
            };
            line.onLeft = function () {
                // Когда внутри ряда уже нельзя двигаться влево — выходим в левое меню.
                Lampa.Controller.toggle('menu');
            };
            line.onBack = self.back;

            // onToggle вызывается InteractionLine при активации controller'а (см. источник
            // create$1 в reference_lampa_native_bookmarks_layout.md). Используем для
            // синхронизации outer вертикального scroll и триггера lazy-load постеров —
            // scroll.update триггерит scroll-event у inner horizontal scroll, что
            // вызывает Layer.visible проверки.
            line.onToggle = function () {
                lastFocused = line;
                try { scroll.update($(line.render(true)), true); } catch (_) {}
            };

            return line;
        }

        function buildSections(results) {
            // Группируем по статусу
            var bystatus = { watchlist: [], progress: [], finished: [], upcoming: [], dropped: [] };
            for (var i = 0; i < results.length; i++) {
                var s = results[i].trakt_status;
                if (bystatus[s]) bystatus[s].push(results[i]);
            }

            // Создаём по InteractionLine на каждый статус (даже если пусто — рисуем заголовок-плейсхолдер)
            for (var k = 0; k < STATUS_ORDER.length; k++) {
                var status = STATUS_ORDER[k];
                var items = bystatus[status];
                if (items.length === 0) {
                    // Пустая секция — рисуем простой DOM-заглушку с заголовком и текстом «пусто»
                    var $empty = $(
                        '<div class="items-line items-line--type-default trakt_v2__empty-line">' +
                          '<div class="items-line__head">' +
                            '<div class="items-line__title">' +
                              escapeHtml(statusLabel(status)) + ' (0)' +
                            '</div>' +
                          '</div>' +
                          '<div class="items-line__body" style="padding:0.7em 1em;opacity:0.55">' +
                            escapeHtml(Lampa.Lang.translate('trakt_v2_section_empty')) +
                          '</div>' +
                        '</div>'
                    );
                    body.append($empty);
                } else {
                    var line = buildSectionLine(status, items);
                    lines.push(line);
                    body.append(line.render());
                }
            }
        }

        function escapeHtml(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        this.create = function () {
            if (!getToken()) {
                this.empty(Lampa.Lang.translate('trakt_v2_no_token'));
                return this.render();
            }
            if (this.activity) this.activity.loader(true);

            fetchAll().then(function (results) {
                buildSections(results);

                scroll.minus();
                scroll.append(body);
                html.append(scroll.render());

                if (self.activity) self.activity.loader(false);

                // v0.1.6: триггерим 'visible' на каждой линии, чтобы InteractionLine.visible()
                // вызвал Layer.visible(scroll) и постеры подгрузились без необходимости
                // прокрутки. Нативный экран получает этот event автоматически когда outer
                // scroll-mask видит элемент; у нас же на initial mount никто его не выпускает.
                lines.forEach(function (line) {
                    try {
                        var el = line.render(true);
                        if (el && typeof el.dispatchEvent === 'function') {
                            el.dispatchEvent(new Event('visible'));
                        }
                    } catch (_) {}
                });

                // Если активити уже отрендерена и ждёт нас — сразу включаемся
                if (self.activity && typeof self.activity.toggle === 'function') {
                    self.activity.toggle();
                }
            }).catch(function (err) {
                var msg = (err && err.code === 'no_token')
                    ? Lampa.Lang.translate('trakt_v2_no_token')
                    : Lampa.Lang.translate('trakt_v2_load_error');
                self.empty(msg);
            });

            return this.render();
        };

        this.empty = function (text) {
            var $msg = $(
                '<div class="empty" style="padding:2em;text-align:center;">' +
                  '<div class="empty__title">' + escapeHtml(text || '') + '</div>' +
                '</div>'
            );
            html.empty().append($msg);
            if (self.activity) self.activity.loader(false);
        };

        this.start = function () {
            if (this.activity) this.activity.loader(false);

            // v0.1.6: тонкий 'content' controller. Сам он не держит фокус;
            // его toggle() сразу делегирует на активный ряд (lastFocused
            // или lines[0]), который через свой .toggle() переключит
            // активный controller на 'items_line'. Это нужно, чтобы возврат
            // в активити из menu/head (фреймворк делает Controller.toggle('content'))
            // корректно отрабатывал. left/right/up/down/back на этом слое
            // — fallback'и, в реальной работе они не должны вызываться,
            // потому что после toggle активным становится items_line.
            Lampa.Controller.add('content', {
                link: self,
                toggle: function () {
                    var target = lastFocused || lines[0] || null;
                    if (target) {
                        target.toggle();
                    }
                    // если ни одной линии нет — оставляем head активным
                    // (этот случай — пустые секции / нет токена / fetch error)
                    else {
                        Lampa.Controller.toggle('head');
                    }
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
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop  = function () {};

        this.render = function () {
            return html;
        };

        this.destroy = function () {
            try {
                lines.forEach(function (l) { try { l.destroy(); } catch (_) {} });
            } catch (_) {}
            try { scroll.destroy(); } catch (_) {}
            html.remove();
            lines = [];
        };
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
