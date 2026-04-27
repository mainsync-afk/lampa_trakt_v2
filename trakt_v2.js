/*!
 * trakt_v2.js — Lampa-Trakt Plugin v2
 * Phase 1 MVP: пункт меню + Activity component + единый список Watchlist (movies + shows)
 *
 * Архитектура: см. SPEC_v2.md
 * Зависимости: Lampa runtime; токен Trakt берётся из Lampa.Storage (выпускается плагином trakt_by_lampame)
 * Прокси Trakt API: https://apx.lme.isroot.in/trakt
 */
(function () {
    'use strict';

    var VERSION = '0.0.2';
    try { console.log('[trakt_v2] file loaded, version ' + VERSION + ' at ' + new Date().toISOString()); } catch (_) {}
    var COMPONENT = 'trakt_v2_main';
    var MENU_DATA_ATTR = 'trakt_v2_menu';
    var API_URL = 'https://apx.lme.isroot.in/trakt';
    var STORAGE_TOKEN_KEY = 'trakt_token';

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
    // Network
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
        // - source НЕ задаём — Lampa берёт текущий источник из настроек пользователя
        //   (например, cub-прокси), а не лезет в прямой TMDB, который может быть недоступен.
        // - poster/image — пустые строки: без Trakt VIP их тут не построить, Lampa Card
        //   подгрузит через текущий источник по id+method.
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
            method: isMovie ? 'movie' : 'tv',
            card_type: isMovie ? 'movie' : 'tv'
        };
    }

    function fetchWatchlist() {
        // Параллельно тянем фильмы и сериалы; объединяем; сортируем по listed_at desc.
        return Promise.all([
            apiGet('/sync/watchlist/movies?extended=full').catch(function () { return []; }),
            apiGet('/sync/watchlist/shows?extended=full').catch(function () { return []; })
        ]).then(function (pair) {
            var combined = [].concat(pair[0] || [], pair[1] || []);
            combined.sort(function (a, b) {
                var ta = Date.parse(a.listed_at || '') || 0;
                var tb = Date.parse(b.listed_at || '') || 0;
                return tb - ta;
            });
            var results = [];
            for (var i = 0; i < combined.length; i++) {
                var c = formatTraktItem(combined[i]);
                if (c) results.push(c);
            }
            return results;
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
   