/*!
 * trakt_v2.js — Lampa-Trakt Plugin v2
 * Phase 1 + TMDB enrichment: пункт меню + Activity component + единый список Watchlist
 * с подгрузкой постеров и локализованных названий из TMDB.
 *
 * Архитектура: см. SPEC_v2.md
 * Зависимости: Lampa runtime; токен Trakt берётся из Lampa.Storage (выпускается плагином trakt_by_lampame)
 * Прокси Trakt API: https://apx.lme.isroot.in/trakt
 * TMDB API: https://api.themoviedb.org/3 (прямой, тот же ключ что у ядра Lampa)
 */
(function () {
    'use strict';

    var VERSION = '0.1.0';
    try { console.log('[trakt_v2] file loaded, version ' + VERSION + ' at ' + new Date().toISOString()); } catch (_) {}
    var COMPONENT = 'trakt_v2_main';
    var MENU_DATA_ATTR = 'trakt_v2_menu';
    var API_URL = 'https://apx.lme.isroot.in/trakt';
    var STORAGE_TOKEN_KEY = 'trakt_token';

    // TMDB. Ключ — встроенный в ядро Lampa (виден в логах при загрузке любого
    // нативного TMDB-каталога), не наш собственный. Когда дойдём до Финальной
    // независимости (см. SPEC §«Границы с trakt_by_lampame»), заменим на свой.
    var TMDB_URL = 'https://api.themoviedb.org/3';
    var TMDB_KEY = '4ef0d7355d9ffb5151e987764708ce96';
    var TMDB_IMG = 'https://image.tmdb.org/t/p';

    // ────────────────────────────────────────────────────────────────────
    // Локализация
    // ────────────────────────────────────────────────────────────────────
    function registerLang() {
        if (!window.Lampa || !Lampa.Lang || typeof Lampa.Lang.add !== 'function') return;
        Lampa.Lang.add({
            trakt_v2_menu_title: {
                ru: 'Trakt v2',
                en: 'Trakt v2',
                uk: 'Trakt v2'
            },
            trakt_v2_screen_title: {
                ru: 'Trakt',
                en: 'Trakt',
                uk: 'Trakt'
            },
            trakt_v2_section_watchlist: {
                ru: 'Закладки (Watchlist)',
                en: 'Watchlist',
                uk: 'Закладки (Watchlist)'
            },
            trakt_v2_no_token: {
                ru: 'Войдите в Trakt через настройки плагина TraktTV',
                en: 'Log in to Trakt via the TraktTV plugin settings',
                uk: 'Увійдіть у Trakt через налаштування плагіна TraktTV'
            },
            trakt_v2_load_error: {
                ru: 'Не удалось загрузить данные из Trakt',
                en: 'Failed to load Trakt data',
                uk: 'Не вдалося завантажити дані з Trakt'
            }
        });
    }

    // ────────────────────────────────────────────────────────────────────
    // Network: Trakt
    // ────────────────────────────────────────────────────────────────────
    function getToken() {
        try {
            return String(Lampa.Storage.get(STORAGE_TOKEN_KEY) || '');
        } catch (e) {
            return '';
        }
    }

    /**
     * Минимальный GET-helper к Trakt API через прокси.
     * Использует XMLHttpRequest напрямую — контролируем таймаут и заголовки,
     * не зависим от частной формы Lampa.Reguest. На Phase 1 хватает.
     */
    function apiGet(path) {
        return new Promise(function (resolve, reject) {
            var token = getToken();
            if (!token) {
                reject({ status: 401, code: 'no_token' });
                return;
            }
            var xhr = new XMLHttpRequest();
            try {
                xhr.open('GET', API_URL + path, true);
            } catch (e) {
                reject({ status: 0, code: 'open_failed', error: e });
                return;
            }
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('trakt-api-version', '2');
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.timeout = 20000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
                    } catch (e) {
                        reject({ status: 0, code: 'parse_error', error: e });
                    }
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
    /**
     * In-memory кэш TMDB-ответов на время сессии. Ключ — "<method>/<id>".
     * Lampa и сама дёргает TMDB при открытии full-card, но мы кэшируем
     * наш слой обогащения, чтобы при повторном открытии экрана Trakt v2
     * не отправлять одни и те же запросы заново.
     */
    var _tmdbCache = {};

    function tmdbLang() {
        try {
            // Lampa.Storage.get('language') может вернуть 'ru', 'en', 'uk'.
            var l = String(Lampa.Storage.get('language') || 'ru');
            return l || 'ru';
        } catch (_) { return 'ru'; }
    }

    function tmdbGet(method, id) {
        var key = method + '/' + id;
        if (_tmdbCache[key]) return Promise.resolve(_tmdbCache[key]);
        return new Promise(function (resolve, reject) {
            var url = TMDB_URL + '/' + method + '/' + id +
                      '?api_key=' + TMDB_KEY +
                      '&language=' + encodeURIComponent(tmdbLang());
            var xhr = new XMLHttpRequest();
            try {
                xhr.open('GET', url, true);
            } catch (e) {
                reject({ status: 0, code: 'open_failed', error: e });
                return;
            }
            xhr.timeout = 15000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        var data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                        _tmdbCache[key] = data;
                        resolve(data);
                    } catch (e) {
                        reject({ status: 0, code: 'parse_error', error: e });
                    }
                } else {
                    // 404 на TMDB бывает у свежих сериалов или удалённых записей —
                    // не ошибка плагина. Логируем и идём дальше.
                    reject({ status: xhr.status, code: 'http_error' });
                }
            };
            xhr.onerror = function () { reject({ status: 0, code: 'network' }); };
            xhr.ontimeout = function () { reject({ status: 0, code: 'timeout' }); };
            xhr.send();
        });
    }

    // ────────────────────────────────────────────────────────────────────
    // Преобразование Trakt-айтема в формат card-data Lampa
    // ────────────────────────────────────────────────────────────────────
    function formatTraktItem(item) {
        if (!item) return null;
        var media = item.movie || item.show;
        if (!media || !media.ids) return null;
        var isMovie = !!item.movie;
        var tmdbId = media.ids.tmdb || null;
        // Без tmdb_id full-card в Lampa не откроем. На Phase 1 такие айтемы пропускаем —
        // в Phase 1 расширении подключим резолв через /search/trakt/:id.
        if (!tmdbId) return null;
        // Формат данных карточки — точно по образцу trakt_by_lampame.formatTraktResults
        // (trakt_by_lampame.js:1617-1634). Ключевые моменты:
        // - component: 'full' — без него Lampa.Card при клике не знает, какую активити открывать.
        // - poster/image — пустые строки на старте, заполняются TMDB-обогащением.
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
            method: isMovie ? 'movie' : 'tv',
            card_type: isMovie ? 'movie' : 'tv'
        };
    }

    /**
     * Дополняем card данными из TMDB: постер, бэкдроп, локализованное название,
     * рейтинг, дата выхода. Если TMDB упал — карточка остаётся как есть.
     *
     * Для movies TMDB отдаёт title/original_title/release_date,
     * для tv — name/original_name/first_air_date. Мы маппим в общие поля
     * card-data, которые читает Lampa.Card.
     */
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
            if (typeof data.vote_average === 'number') {
                card.vote_average = data.vote_average;
            }
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
        // Параллельно — TMDB rate-limit ~50 rps на ключ, на 4-50 карточек запас огромный.
        return Promise.all(cards.map(enrichWithTmdb));
    }

    function fetchWatchlist() {
        function fetchSafe(path) {
            return apiGet(path).catch(function (err) {
                try { console.warn('[trakt_v2] fetch failed', path, err); } catch (_) {}
                return [];
            });
        }
        return Promise.all([
            fetchSafe('/sync/watchlist/movies?extended=full'),
            fetchSafe('/sync/watchlist/shows?extended=full')
        ]).then(function (pair) {
            var movies = pair[0] || [], shows = pair[1] || [];
            var combined = [].concat(movies, shows);
            combined.sort(function (a, b) {
                var ta = Date.parse(a.listed_at || '') || 0;
                var tb = Date.parse(b.listed_at || '') || 0;
                return tb - ta;
            });
            var results = [];
            var dropped_no_tmdb = 0;
            for (var i = 0; i < combined.length; i++) {
                var c = formatTraktItem(combined[i]);
                if (c) {
                    results.push(c);
                } else {
                    dropped_no_tmdb++;
                }
            }
            try {
                console.log(
                    '[trakt_v2] fetchWatchlist:',
                    'movies=' + movies.length,
                    'shows=' + shows.length,
                    'total=' + combined.length,
                    'kept=' + results.length,
                    'dropped_no_tmdb=' + dropped_no_tmdb
                );
            } catch (_) {}
            return enrichAll(results).then(function (enriched) {
                try {
                    var withPoster = 0;
                    for (var i = 0; i < enriched.length; i++) {
                        if (enriched[i].poster) withPoster++;
                    }
                    console.log('[trakt_v2] tmdb enriched: with_poster=' + withPoster + '/' + enriched.length);
                } catch (_) {}
                return enriched;
            });
        });
    }

    // ────────────────────────────────────────────────────────────────────
    // Activity component (через Lampa.InteractionCategory — стандартная страница каталога)
    // ────────────────────────────────────────────────────────────────────
    function MainComponent(object) {
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            var self = this;
            if (!getToken()) {
                self.empty(Lampa.Lang.translate('trakt_v2_no_token'));
                return;
            }
            fetchWatchlist()
                .then(function (results) {
                    self.build({
                        results: results,
                        total_pages: 1
                    });
                    if (self.activity && self.activity.scroll) {
                        self.activity.scroll.onEnd = function () {};
                    }
                })
                .catch(function (err) {
                    var msg = (err && err.code === 'no_token')
                        ? Lampa.Lang.translate('trakt_v2_no_token')
                        : Lampa.Lang.translate('trakt_v2_load_error');
                    self.empty(msg);
                });
        };

        comp.next = function () { /* no pagination on Phase 1 */ };

        // Переопределяем onEnter каждой карточки. Без этого Lampa использует
        // дефолтный обработчик, который игнорирует наш method и дёргает TMDB
        // как /movie/<id>/... даже для сериалов. См. memory: reference_lampa_card_api.
        comp.cardRender = function (object, element, card) {
            card.onMenu = false;
            card.onEnter = function () {
                // НЕ передаём `card` (инстанс Lampa.Card) — у него циклическая
                // ссылка card → activity → component → activity, и JSON.stringify
                // в Lampa.Activity.push падает на clone$1.
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    id: element.id,
                    method: element.method,
                    card: element,
                    source: 'tmdb'
                });
            };
        };

        return comp;
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
