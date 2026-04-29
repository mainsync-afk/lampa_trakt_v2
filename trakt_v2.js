/*!
 * trakt_v2.js — Lampa-Trakt Plugin v2
 * Phase 1 + classifier + multi-section layout + write-actions:
 * пункт меню + Activity component + 5 секций + 5 пунктов в нативном
 * сайдбаре карточки.
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
 * v0.1.7: Phase 2 — write-actions через нативное контекстное меню карточки.
 * Концептуально: статус (один из 4: Progress/Upcoming/Finished/Dropped) стал
 * отделён от Watchlist-флажка (ортогональный boolean). Карточка может иметь
 * статус И WL одновременно. На главном экране ряд Watchlist показывает все
 * WL=true карточки независимо от статуса. Регистрация 5 пунктов в
 * Lampa.Manifest.plugins; tap-обработчики по матрице из reference_v2_data_model.md.
 *
 * v0.1.8: state-aware sidebar labels (попытка через Listener.follow) + render-fix дублей.
 *  - Lampa-обёртка плагинов выкидывает поля checkbox/collect/checked/selected
 *    из onContextMenu return (проверено пробником) — нативные галочки доступны
 *    только нативным группам «Избранное»/«Статус», которые мы НЕ используем.
 *    Решено выражать состояние Unicode-маркером в plugin.name. Обновлять имя
 *    пытались через Lampa.Listener.follow('full') — ОКАЗАЛОСЬ НЕ РАБОЧИМ:
 *    long-press на карточке в нашей папке открывает action-сайдбар напрямую,
 *    минуя full-card view, событие 'full' не дёргается.
 *  - Фикс 0.1.7: при попадании карточки в два ряда (WL + status) клонируем
 *    card-data в buildSections (Object.assign({}, c)). Без клонирования
 *    Lampa.Card мутировал общий объект и второй ряд молча терял карточку.
 *
 * v0.1.9: state-aware sidebar labels — попытка через Select.show patch.
 *  - Заменили Listener.follow('full') на патч Lampa.Select.show. Карточку
 *    ловили через line.onFocus → currentFocusedCard. На реальных тестах
 *    подписи всё равно не обновлялись: Lampa-исходник Card.onMenu читает
 *    plugin.name синхронно ВНУТРИ forEach по Manifest.plugins, и наш patch
 *    стрелял слишком поздно (или не на ту фазу — не выяснили).
 *  - Удалены: updateSidebarLabels, Listener.follow('full') (мёртвый код).
 *
 * v0.1.15: on-demand резолв _trakt_progress_seasons для tap Finished на шоу.
 *  - В v0.1.14 был баг: тап Finished на сериале со статусом None (например,
 *    «Больница Питт» в Watchlist=false) → postHistoryAddShow rejected с
 *    'no_progress_seasons' (потому что fetchAll тянет /shows/<id>/progress
 *    только для шоу in_watched=true). На Trakt ничего не уходило.
 *  - Решение: ensureProgressSeasons(card) внутри postHistoryAddShow.
 *    1) Если есть card.trakt_ids.trakt → step 3.
 *    2) Иначе — резолв через GET /search/tmdb/<tmdb>?type=show, обогащаем
 *       card.trakt_ids найденными trakt/imdb/slug.
 *    3) GET /shows/<trakt_id>/progress/watched → seasons[] (включает все
 *       вышедшие эпизоды независимо от watched-state). Кешируем в
 *       card._trakt_progress_seasons чтобы повторные тапы не дёргали API.
 *  - Добавлены новые error codes для понятных нотификаций: no_aired_episodes
 *    (шоу с невышедшими эпизодами), trakt_id_resolve_failed, no_progress_response.
 *  - Старый notify «open card first to load episodes» удалён — был обманчивый
 *    (открытие карточки реально ничего не чинило).
 *
 * v0.1.14: фикс имени Lampa-section для Settings.
 *  - В v0.1.13 регистрировали addParam под component:'trakttv' (как было
 *    в v1). В LME-форке trakt_by_LME секцию переименовали в 'trakt' (см.
 *    trakt_by_LME.js:6698 addComponent({component:'trakt'})). Без правильного
 *    имени addParam silently ничего не делает — пункт не появлялся.
 *  - Поменяли component на 'trakt'. Лог-маркер тоже: '[trakt_v2] settings
 *    registered (trakt component, ...)' (раньше '(trakttv component, ...)').
 *
 * v0.1.13: Custom list для Dropped + Settings UI; ушли от hpw полностью.
 *  - Backlog #7 закрыт частично. Раньше: Dropped писали в hpw + hdr (двойник
 *    под видом «триплета»), для movies был notify «not yet supported».
 *    Теперь: пишем в hdr + custom list; movies без листа недоступны (явный
 *    notify «настройте папку Dropped в настройках»).
 *  - hpw НЕ пишем и НЕ читаем (backlog #10): Moviebase пишет туда «Stop
 *    watching» и не имеет UI для отмены — карточка залипает в hpw без
 *    возможности её достать. Если бы мы тоже туда писали, наш «un-drop»
 *    оставлял бы Moviebase-запись и UI был бы рассинхронизирован.
 *  - Канонизация v1 (fire-and-forget POST в недостающие ячейки с throttle)
 *    отложена — без hpw она нужна только между hdr и list, и вопрос как
 *    себя ведут другие клиенты ещё не закрыт.
 *  - Settings: Lampa.SettingsApi.addParam под component:'trakt' (имя секции
 *    trakt_by_LME — был 'trakttv' в старом trakt_by_lampame, в LME форке
 *    переименовали в 'trakt', см. trakt_by_LME.js:6698).
 *    Тип select с values из cached lists. fetchUserLists() вызывается в
 *    start() для refresh кеша (если есть токен).
 *  - droppedTmdb теперь type-aware — keyed по 'show:<tmdb>' / 'movie:<tmdb>'.
 *    Раньше было keyed по tmdb only (хватало, потому что hpw/hdr только
 *    shows); теперь list возвращает оба типа, нужна типобезопасность.
 *
 * v0.1.12: detectCardType — фикс мис-определения типа карточки в нативных папках.
 *  - Был баг: long-press на сериале в нативной папке (trending/movies/shows)
 *    → resolveCard возвращал 'movie' (потому что Lampa-нативные карточки не
 *    имеют method/card_type — наши единственный сигнал) → postWatchlistAdd
 *    слал { movies: [...] } с tmdb сериала → Trakt находил ДРУГОЙ фильм с
 *    тем же tmdb-id и добавлял его в WL. Юзер видел чужой фильм в WL row,
 *    сериал не попадал в Trakt.
 *  - resolveCard теперь использует detectCardType с приоритетами:
 *    (1) explicit method/card_type для наших карточек,
 *    (2) Lampa-эвристика: name/original_name/first_air_date/number_of_seasons
 *        => show (как сама Lampa определяет TV в card.js: type: data.name?'tv':'movie'),
 *    (3) default movie.
 *  - Сложные edge cases (карточка без TV-specific полей и без method) могут
 *    остаться мис-классифицированными — fallback на Trakt /search/tmdb/:id
 *    будет нужен в отдельной версии (см. SPEC_v2.md §«Резолв типа карточки»).
 *
 * v0.1.11: оптимистичное обновление кеша вместо Activity.replace.
 *  - Раньше после каждого write-action делали refreshScreenIfActive() →
 *    Lampa.Activity.replace() → весь экран пересобирался: новый fetchAll,
 *    ребилд 5 рядов, потеря фокуса. Юзер видел дёргающийся рефреш.
 *  - В нативной папке refreshScreenIfActive ничего не делал (мы не на нашем
 *    component) → LAST_RESULTS оставался stale → следующий long-press на
 *    той же карточке показывал старое состояние до повторного захода в нашу
 *    папку.
 *  - Решение: применить мутацию к карточке в LAST_RESULTS in-place по матрице
 *    действия (или добавить минимальную запись если карточки в кеше нет).
 *    Активити больше не дёргается. Сайдбар на той же карточке сразу
 *    показывает новое состояние через капчер-hook + labelFor → findInCache.
 *  - Trade-off: ряды на нашей странице НЕ реорганизуются мгновенно — карточки
 *    переезжают между рядами только на следующем заходе в папку. Это backlog
 *    item (DOM-уровень обновление без Activity.replace).
 *  - refreshScreenIfActive() оставлен как dead code на случай ручной кнопки
 *    «обновить» в будущих версиях.
 *
 * v0.1.10: state-aware sidebar labels — рабочая реализация через hover:long
 * capture-phase hook (после изучения src/interaction/card.js в lampa-source).
 *  - Card.onMenu в Lampa строит action-сайдбар на DOM event 'hover:long'
 *    (long-press на карточке). Внутри он делает Manifest.plugins.forEach и
 *    использует plugin.name КАК item.title. Если plugin.name свежий в
 *    момент forEach — Lampa отрендерит его как есть.
 *  - На карточке-DOM-элементе лежит el.card_data (JS-property, не data-*).
 *  - Регистрируем capture-phase listener на document для 'hover:long' —
 *    он гарантированно срабатывает ПЕРЕД bubble-listener-ом Lampa.
 *    Из event.target.closest('.card') читаем card_data → мутируем
 *    plugin.name на всех 5 наших entries через labelFor(action, card).
 *  - Бонус: тот же hook чинит Path 3 (long-press в нативной папке) — там
 *    тоже Lampa.Card, тоже hover:long, тоже card_data на DOM. Подписи
 *    станут state-aware и в native рядах.
 *  - Сохраняем v0.1.9 patchSelectShowForLabels как defensive layer на
 *    случай если capture-hook на каких-то платформах не пробьётся.
 *  - Маркеры: ☐ Watchlist / ☑ Watchlist (toggle, всегда виден чекбокс),
 *    Progress / ✓ Progress (single-select, ✓ только у активного).
 *
 * Архитектура: см. SPEC_v2.md §«Раскладка экрана»; механика sidebar:
 * см. memory reference_lampa_card_onmenu.md
 * Зависимости: Lampa runtime; токен Trakt берётся из Lampa.Storage (выпускается плагином trakt_by_LME)
 * Прокси Trakt API: https://apx.lme.isroot.in/trakt
 * TMDB API: https://api.themoviedb.org/3 (прямой, тот же ключ что у ядра Lampa)
 */
(function () {
    'use strict';

    var VERSION = '0.1.15';
    try { console.log('[trakt_v2] file loaded, version ' + VERSION + ' at ' + new Date().toISOString()); } catch (_) {}
    var COMPONENT = 'trakt_v2_main';
    var MENU_DATA_ATTR = 'trakt_v2_menu';
    var API_URL = 'https://apx.lme.isroot.in/trakt';
    var STORAGE_TOKEN_KEY = 'trakt_token';
    // v0.1.13: настройка кастомного листа Trakt для статуса Dropped.
    // Храним числовой ids.trakt листа (slug ломается при rename).
    var STORAGE_DROPPED_LIST_ID = 'trakt_v2_dropped_list_id';
    // Кеш списка пользовательских листов: [{id:Number, name:String}, ...].
    // Обновляется через fetchUserLists(); используется селектором настроек.
    var STORAGE_DROPPED_LISTS_CACHE = 'trakt_v2_dropped_lists_cache';

    // TMDB. Ключ — встроенный в ядро Lampa. На Финальной независимости заменим на свой.
    var TMDB_URL = 'https://api.themoviedb.org/3';
    var TMDB_KEY = '4ef0d7355d9ffb5151e987764708ce96';
    var TMDB_IMG = 'https://image.tmdb.org/t/p';

    // ────────────────────────────────────────────────────────────────────
    // Модель: 4 взаимоисключающих статуса + ортогональный Watchlist флажок.
    // Watchlist НЕ статус (см. reference_v2_data_model.md).
    // ────────────────────────────────────────────────────────────────────
    var STATUS = { PROGRESS: 'progress', FINISHED: 'finished', UPCOMING: 'upcoming', DROPPED: 'dropped' };
    // Порядок рядов на главном экране. Watchlist первый и собирается отдельно.
    var ROW_ORDER = ['watchlist', 'progress', 'finished', 'upcoming', 'dropped'];
    // Порядок пунктов в нативном сайдбаре карточки.
    var SIDEBAR_ORDER = ['progress', 'watchlist', 'upcoming', 'finished', 'dropped'];
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

    // v0.1.13: helpers для настройки кастомного листа Dropped
    function getDroppedListId() {
        try {
            var v = Lampa.Storage.get(STORAGE_DROPPED_LIST_ID, '0');
            var n = Number(v);
            return n > 0 ? n : 0;
        } catch (_) { return 0; }
    }
    function getCachedLists() {
        try {
            var raw = Lampa.Storage.get(STORAGE_DROPPED_LISTS_CACHE, '[]');
            // Lampa.Storage может вернуть уже распарсенный объект или строку — обрабатываем оба
            var parsed = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) { return []; }
    }
    function setCachedLists(lists) {
        try { Lampa.Storage.set(STORAGE_DROPPED_LISTS_CACHE, JSON.stringify(lists || [])); } catch (_) {}
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

    function apiPost(path, payload) {
        return new Promise(function (resolve, reject) {
            var token = getToken();
            if (!token) { reject({ status: 401, code: 'no_token' }); return; }
            var xhr = new XMLHttpRequest();
            try { xhr.open('POST', API_URL + path, true); }
            catch (e) { reject({ status: 0, code: 'open_failed', error: e }); return; }
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('trakt-api-version', '2');
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.timeout = 20000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null); }
                    catch (e) { resolve(null); }
                } else {
                    reject({ status: xhr.status, code: 'http_error', body: xhr.responseText });
                }
            };
            xhr.onerror = function () { reject({ status: 0, code: 'network' }); };
            xhr.ontimeout = function () { reject({ status: 0, code: 'timeout' }); };
            try { xhr.send(JSON.stringify(payload || {})); }
            catch (e) { reject({ status: 0, code: 'send_failed', error: e }); }
        });
    }

    // ────────────────────────────────────────────────────────────────────
    // Trakt write helpers — принимают карточку из кеша (с trakt_type/trakt_ids
    // и опц. _trakt_progress_seasons).
    // ────────────────────────────────────────────────────────────────────
    function buildIdsObj(card) {
        var ids = card.trakt_ids || {};
        var out = {};
        if (ids.tmdb)  out.tmdb  = ids.tmdb;
        if (ids.trakt) out.trakt = ids.trakt;
        if (ids.imdb)  out.imdb  = ids.imdb;
        if (ids.slug)  out.slug  = ids.slug;
        return out;
    }
    function buildMediaPayload(card) {
        var entry = { ids: buildIdsObj(card) };
        return card.trakt_type === 'movie' ? { movies: [entry] } : { shows: [entry] };
    }
    function buildHistoryAddShowPayload(card, watchedAt) {
        var ids = buildIdsObj(card);
        var src = card._trakt_progress_seasons || [];
        var seasons = [];
        for (var i = 0; i < src.length; i++) {
            var s = src[i];
            if (!s || !s.episodes) continue;
            var sn = Number(s.number);
            if (sn === 0) continue;
            var eps = [];
            for (var j = 0; j < s.episodes.length; j++) {
                var e = s.episodes[j];
                if (!e || typeof e.number !== 'number') continue;
                eps.push({ number: e.number, watched_at: watchedAt });
            }
            if (eps.length) seasons.push({ number: sn, episodes: eps });
        }
        return { shows: [{ ids: ids, seasons: seasons }] };
    }
    function postWatchlistAdd(card)    { return apiPost('/sync/watchlist',        buildMediaPayload(card)); }
    function postWatchlistRemove(card) { return apiPost('/sync/watchlist/remove', buildMediaPayload(card)); }
    function postHistoryAddMovie(card) {
        return apiPost('/sync/history', { movies: [{ ids: buildIdsObj(card), watched_at: new Date().toISOString() }] });
    }
    function postHistoryRemoveMovie(card) {
        return apiPost('/sync/history/remove', { movies: [{ ids: buildIdsObj(card) }] });
    }
    // v0.1.15: on-demand резолв _trakt_progress_seasons. fetchAll тянет
    // progress только для шоу с in_watched=true (т.е. completed > 0). Шоу
    // со status=None (или wl-only, или из нативной папки) не имеют этих
    // данных. Когда юзер тапает Finished на таком — резолвим на лету.
    //
    // Шаги:
    //  1. Если есть trakt_id → step 3 сразу.
    //  2. Если только tmdb → /search/tmdb/<tmdb>?type=show → берём first show
    //     hit, кешируем trakt/imdb/slug обратно в card.trakt_ids.
    //  3. /shows/<trakt_id>/progress/watched → seasons[] (все вышедшие эпизоды
    //     независимо от watched-state). Кешируем в card._trakt_progress_seasons.
    function ensureProgressSeasons(card) {
        if (card._trakt_progress_seasons && card._trakt_progress_seasons.length) {
            return Promise.resolve(card._trakt_progress_seasons);
        }
        var ids = card.trakt_ids || {};
        var traktId = ids.trakt;
        var tmdbId = ids.tmdb;

        var traktIdPromise;
        if (traktId) {
            traktIdPromise = Promise.resolve(traktId);
        } else if (tmdbId) {
            traktIdPromise = apiGet('/search/tmdb/' + tmdbId + '?type=show').then(function (results) {
                if (!Array.isArray(results) || !results.length) return null;
                var hit = null;
                for (var i = 0; i < results.length; i++) {
                    var r = results[i];
                    if (r && r.type === 'show' && r.show && r.show.ids && r.show.ids.trakt) { hit = r; break; }
                }
                if (!hit) return null;
                // Обогащаем card.trakt_ids найденными id, чтобы следующие вызовы
                // (например, postWatchlistAdd) тоже работали без re-resolve.
                card.trakt_ids = card.trakt_ids || {};
                card.trakt_ids.trakt = hit.show.ids.trakt;
                if (hit.show.ids.imdb) card.trakt_ids.imdb = hit.show.ids.imdb;
                if (hit.show.ids.slug) card.trakt_ids.slug = hit.show.ids.slug;
                return hit.show.ids.trakt;
            });
        } else {
            return Promise.reject({ code: 'no_ids_for_progress_resolve' });
        }

        return traktIdPromise.then(function (resolvedTraktId) {
            if (!resolvedTraktId) return Promise.reject({ code: 'trakt_id_resolve_failed' });
            try { console.log('[trakt_v2] resolving progress on-demand for trakt_id=' + resolvedTraktId); } catch (_) {}
            return apiGet('/shows/' + resolvedTraktId + '/progress/watched').then(function (progress) {
                if (!progress || !Array.isArray(progress.seasons)) {
                    return Promise.reject({ code: 'no_progress_response' });
                }
                card._trakt_progress_seasons = progress.seasons;
                try { console.log('[trakt_v2] progress resolved, seasons=' + progress.seasons.length); } catch (_) {}
                return progress.seasons;
            });
        });
    }

    function postHistoryAddShow(card) {
        return ensureProgressSeasons(card).then(function (seasons) {
            if (!seasons || !seasons.length) return Promise.reject({ code: 'no_progress_seasons' });
            // Проверим, есть ли реально вышедшие эпизоды (фильтр на пустые seasons).
            var hasAired = false;
            for (var i = 0; i < seasons.length; i++) {
                var s = seasons[i];
                if (s && s.episodes && s.episodes.length && Number(s.number) !== 0) { hasAired = true; break; }
            }
            if (!hasAired) return Promise.reject({ code: 'no_aired_episodes' });
            return apiPost('/sync/history', buildHistoryAddShowPayload(card, new Date().toISOString()));
        });
    }
    // v0.1.13: запись в кастомный пользовательский лист.
    function postListAdd(listId, card) {
        return apiPost('/users/me/lists/' + listId + '/items',        buildMediaPayload(card));
    }
    function postListRemove(listId, card) {
        return apiPost('/users/me/lists/' + listId + '/items/remove', buildMediaPayload(card));
    }

    // v0.1.13: Dropped write — hdr + list (НЕ пишем в hpw, см. docblock про
    // Moviebase one-way trap). Movies требуют listId, иначе rejection с
    // понятным кодом — handler покажет пользователю notify «настройте папку».
    function postDroppedSet(card) {
        var listId = getDroppedListId();
        var ops = [];
        if (card.trakt_type === 'show') {
            var sp = { shows: [{ ids: buildIdsObj(card) }] };
            ops.push(apiPost('/users/hidden/dropped', sp).catch(function () { return null; }));
        }
        if (listId) {
            ops.push(postListAdd(listId, card).catch(function () { return null; }));
        }
        if (ops.length === 0) {
            // movie + нет listId → нечего делать
            return Promise.reject({ code: 'no_dropped_list_for_movie' });
        }
        return Promise.all(ops);
    }
    function postDroppedClear(card) {
        var listId = getDroppedListId();
        var ops = [];
        if (card.trakt_type === 'show') {
            var sp = { shows: [{ ids: buildIdsObj(card) }] };
            ops.push(apiPost('/users/hidden/dropped/remove', sp).catch(function () { return null; }));
        }
        if (listId) {
            ops.push(postListRemove(listId, card).catch(function () { return null; }));
        }
        if (ops.length === 0) {
            return Promise.reject({ code: 'no_dropped_list_for_movie' });
        }
        return Promise.all(ops);
    }

    // v0.1.13: подгрузка пользовательских листов Trakt для селектора настроек.
    // Упрощает до [{id:Number, name:String}], кеширует в Storage. На сетевой
    // ошибке возвращает закешированную версию (settings selector всё равно
    // показывает что-то осмысленное).
    function fetchUserLists() {
        if (!getToken()) return Promise.resolve(getCachedLists());
        return apiGet('/users/me/lists').then(function (lists) {
            if (!Array.isArray(lists)) return [];
            var simplified = lists.map(function (l) {
                return { id: l && l.ids && l.ids.trakt, name: l && l.name };
            }).filter(function (x) { return x.id && x.name; });
            setCachedLists(simplified);
            try { console.log('[trakt_v2] fetchUserLists ok, count=' + simplified.length); } catch (_) {}
            return simplified;
        }).catch(function (err) {
            try { console.warn('[trakt_v2] fetchUserLists failed', err); } catch (_) {}
            return getCachedLists();
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
        if (node.dropped) return STATUS.DROPPED;
        if (node.in_watched) return STATUS.FINISHED;
        return null; // None — карточка может иметь только trakt_watchlist=true
    }

    function classifyShow(node) {
        if (node.dropped) return STATUS.DROPPED;
        var p = node.progress;
        var completed = p ? Number(p.completed || 0) : 0;
        if (completed === 0) return null; // None — может быть в watchlist флажком
        var hasNext = p && p.next_episode;
        if (hasNext) return STATUS.PROGRESS;
        var s = String(node.media.status || '').toLowerCase();
        if (s === 'ended' || s === 'canceled') return STATUS.FINISHED;
        return STATUS.UPCOMING;
    }

    // Кеш результатов последнего fetchAll (для read-state в sidebar handler).
    var LAST_RESULTS = [];
    // Последняя карточка, на которой стоял курсор в наших InteractionLine —
    // именно её юзер «long-press»-ит, чтобы открыть action-сайдбар. Заполняется
    // в line.onFocus (см. MainComponent.buildSectionLine), читается в
    // rewriteOurItemTitles при патче Lampa.Select.show.
    var currentFocusedCard = null;
    function findInCache(tmdbId, type) {
        if (!tmdbId) return null;
        var key = String(tmdbId);
        for (var i = 0; i < LAST_RESULTS.length; i++) {
            var c = LAST_RESULTS[i];
            if (c && c.trakt_ids && String(c.trakt_ids.tmdb) === key && (!type || c.trakt_type === type)) {
                return c;
            }
        }
        return null;
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
        // v0.1.13: hpw НЕ читаем (см. docblock). list читаем если listId настроен.
        var droppedListId = getDroppedListId();
        var listFetch = droppedListId
            ? fetchSafe('/users/me/lists/' + droppedListId + '/items?type=show,movie&limit=200')
            : Promise.resolve([]);
        return Promise.all([
            fetchSafe('/sync/watchlist/movies?extended=full'),
            fetchSafe('/sync/watchlist/shows?extended=full'),
            fetchSafe('/sync/watched/movies?extended=full'),
            fetchSafe('/sync/watched/shows?extended=full'),
            fetchSafe('/users/hidden/dropped?type=show&limit=1000'),
            listFetch
        ]).then(function (rows) {
            var wlMovies      = rows[0] || [];
            var wlShows       = rows[1] || [];
            var watchedMovies = rows[2] || [];
            var watchedShows  = rows[3] || [];
            var hiddenDR      = rows[4] || [];
            var listItems     = rows[5] || [];

            try {
                console.log('[trakt_v2] raw fetch:',
                    'wlMov=' + wlMovies.length,
                    'wlSh=' + wlShows.length,
                    'wMov=' + watchedMovies.length,
                    'wSh=' + watchedShows.length,
                    'hDR=' + hiddenDR.length,
                    'list=' + listItems.length + (droppedListId ? '' : ' (no listId)'));
            } catch (_) {}

            // Type-aware множество для Dropped: ключи 'show:<tmdb>' / 'movie:<tmdb>'
            // потому что custom list возвращает И shows И movies.
            var droppedTmdbByType = {};
            function addDroppedHidden(arr) {
                // hidden API возвращает только shows
                for (var i = 0; i < arr.length; i++) {
                    var s = arr[i] && arr[i].show;
                    if (s && s.ids && s.ids.tmdb) droppedTmdbByType['show:' + s.ids.tmdb] = true;
                }
            }
            function addDroppedList(arr) {
                // list items: { type: 'movie'|'show', movie?: {...}, show?: {...} }
                for (var i = 0; i < arr.length; i++) {
                    var it = arr[i];
                    if (!it) continue;
                    if (it.type === 'show' && it.show && it.show.ids && it.show.ids.tmdb) {
                        droppedTmdbByType['show:' + it.show.ids.tmdb] = true;
                    } else if (it.type === 'movie' && it.movie && it.movie.ids && it.movie.ids.tmdb) {
                        droppedTmdbByType['movie:' + it.movie.ids.tmdb] = true;
                    }
                }
            }
            addDroppedHidden(hiddenDR);
            addDroppedList(listItems);

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

            // Помечаем dropped по type-aware ключу (shows из hdr; shows+movies из list)
            Object.keys(byKey).forEach(function (k) {
                var n = byKey[k];
                if (!n.media.ids.tmdb) return;
                if (droppedTmdbByType[n.type + ':' + n.media.ids.tmdb]) n.dropped = true;
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
                var counts = { watchlist: 0, progress: 0, finished: 0, upcoming: 0, dropped: 0, none_with_wl: 0 };
                Object.keys(byKey).forEach(function (k) {
                    var n = byKey[k];
                    var status = n.type === 'movie' ? classifyMovie(n) : classifyShow(n);
                    var watchlist = !!n.in_watchlist;
                    if (!status && !watchlist) return; // None+WL=false — пропускаем
                    var card = formatMedia(n.media, n.type);
                    if (!card) return;
                    card.trakt_status = status;            // null | 'progress' | 'finished' | 'upcoming' | 'dropped'
                    card.trakt_watchlist = watchlist;      // boolean (ортогональный)
                    card.trakt_listed_at = n.listed_at;
                    card.trakt_type = n.type;              // 'movie' | 'show'
                    card.trakt_ids = n.media.ids || {};
                    if (n.type === 'show' && n.progress) {
                        card._trakt_progress_seasons = n.progress.seasons || null;
                    }
                    classified.push(card);
                    if (status) counts[status]++;
                    if (watchlist) counts.watchlist++;
                    if (!status && watchlist) counts.none_with_wl++;
                });

                try {
                    console.log('[trakt_v2] classifier:',
                        'total=' + classified.length,
                        'watchlist=' + counts.watchlist,
                        'progress=' + counts.progress,
                        'finished=' + counts.finished,
                        'upcoming=' + counts.upcoming,
                        'dropped=' + counts.dropped,
                        '(none+wl=' + counts.none_with_wl + ')');
                } catch (_) {}

                // Сортировка: по приоритету статуса (null последним), внутри — по listed_at desc
                classified.sort(function (a, b) {
                    var sa = a.trakt_status ? ROW_ORDER.indexOf(a.trakt_status) : 99;
                    var sb = b.trakt_status ? ROW_ORDER.indexOf(b.trakt_status) : 99;
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
                    LAST_RESULTS = enriched;
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
            // (на случай первичного входа без onToggle). Также сохранить
            // карточку как currentFocusedCard — она пригодится в патче
            // Lampa.Select.show, когда юзер сделает long-press.
            line.onFocus = function (card_data) {
                lastFocused = line;
                if (card_data) currentFocusedCard = card_data;
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
            // Группируем:
            //  - watchlist — все карточки с trakt_watchlist=true (независимо от статуса);
            //    дубли с рядом статуса допустимы и осмысленны.
            //  - остальные ряды — по trakt_status.
            //
            // ВАЖНО: при пуше в два ряда клонируем объект (Object.assign({}, c)).
            // Иначе Lampa.Card мутирует общий card-data при первом рендере,
            // и второй ряд видит «занятую» карточку и не отображает её
            // (бага замечена в 0.1.7: tap WL на показ в Progress → визуально
            // карточка пропадала из Progress, хотя классификатор оставлял её там).
            // LAST_RESULTS остаётся с оригиналами — sidebar handler через
            // findInCache читает корректное состояние.
            var bystatus = { watchlist: [], progress: [], finished: [], upcoming: [], dropped: [] };
            for (var i = 0; i < results.length; i++) {
                var c = results[i];
                if (c.trakt_watchlist) bystatus.watchlist.push(Object.assign({}, c));
                if (c.trakt_status && bystatus[c.trakt_status]) bystatus[c.trakt_status].push(Object.assign({}, c));
            }

            // Создаём по InteractionLine на каждый ряд (пусто — заглушка с заголовком)
            for (var k = 0; k < ROW_ORDER.length; k++) {
                var status = ROW_ORDER[k];
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
    // Sidebar tap handler — матрица из reference_v2_data_model.md.
    // ────────────────────────────────────────────────────────────────────
    function notify(text) {
        try { Lampa.Noty.show(String(text || '')); } catch (_) {}
    }
    // Оставлен как dead code на случай ручной кнопки «обновить» в будущем.
    // С v0.1.11 НЕ вызывается из handleSidebarTap — заменён на
    // applyOptimisticUpdate (мутация LAST_RESULTS in-place без рефреша экрана).
    function refreshScreenIfActive() {
        try {
            var act = Lampa.Activity.active();
            if (act && act.component === COMPONENT) {
                Lampa.Activity.replace({
                    url: '', title: Lampa.Lang.translate('trakt_v2_screen_title'),
                    component: COMPONENT, page: 1
                });
            }
        } catch (_) {}
    }

    // Гарантирует наличие карточки в LAST_RESULTS. Если её там не было
    // (например, юзер таппает в нативной папке на карточке, которой нет
    // в нашем кеше) — добавляет минимальную запись с trakt_ids/trakt_type
    // и нулевыми флажками. Возвращает ссылку на запись в кеше.
    function ensureInCache(card) {
        if (!card || !card.trakt_ids) return null;
        var tmdbId = card.trakt_ids.tmdb;
        if (!tmdbId) return null;
        var type = card.trakt_type;
        var cached = findInCache(tmdbId, type);
        if (cached) return cached;
        cached = {
            trakt_type: type,
            trakt_ids: { tmdb: tmdbId },
            trakt_status: null,
            trakt_watchlist: false,
            _trakt_progress_seasons: card._trakt_progress_seasons || null
        };
        LAST_RESULTS.push(cached);
        return cached;
    }

    // Оптимистичное обновление LAST_RESULTS после успешного write-action.
    // Не дёргает экран — следующий open сайдбара на той же карточке через
    // labelFor → findInCache увидит свежее состояние. Полный fetchAll
    // случится на следующем заходе в папку и сверит/исправит при
    // необходимости. Логика — по матрице из reference_v2_data_model.md.
    function applyOptimisticUpdate(action, card) {
        var c = ensureInCache(card);
        if (!c) return;
        var oldStatus = c.trakt_status;
        var type = c.trakt_type;

        if (action === 'watchlist') {
            c.trakt_watchlist = !c.trakt_watchlist;
        }
        else if (action === 'finished') {
            if (type === 'movie') {
                if (oldStatus === STATUS.FINISHED) {
                    c.trakt_status = null;          // unset → None
                } else {
                    c.trakt_status = STATUS.FINISHED;
                    c.trakt_watchlist = false;      // auto-снятие WL по матрице
                }
            } else {
                // show: handler не вызывает нас при UPCOMING/FINISHED (там noop),
                // т.е. сюда попадаем только при None/Progress/Dropped → set FINISHED.
                // Реальное состояние может оказаться UPCOMING (если есть невышедшие
                // эпизоды) — следующий fetchAll скорректирует.
                c.trakt_status = STATUS.FINISHED;
                c.trakt_watchlist = false;
            }
        }
        else if (action === 'dropped') {
            if (type === 'movie') {
                // Movies dropped в текущей версии не поддерживаем (backlog #7) —
                // handler возвращает раньше, сюда не попадаем.
                return;
            }
            if (oldStatus === STATUS.DROPPED) {
                c.trakt_status = null;              // unset → reclassify на след. fetch
            } else {
                c.trakt_status = STATUS.DROPPED;
                c.trakt_watchlist = false;
            }
        }
        // progress / upcoming — noop в handler, сюда не попадаем.

        try {
            console.log('[trakt_v2] cache updated after', action,
                        'tmdb=', c.trakt_ids.tmdb,
                        'status=', c.trakt_status,
                        'wl=', c.trakt_watchlist);
        } catch (_) {}
    }
    // Определение типа карточки по её полям. Приоритеты:
    //  1) explicit method/card_type (наши карточки из formatMedia)
    //  2) Lampa-эвристика: data.name присутствует → TV (та же логика, что
    //     использует сам Lampa в src/interaction/card.js: data.name ? 'tv' : 'movie').
    //     Также проверяем original_name / first_air_date / number_of_seasons —
    //     любой из них = show.
    //  3) default → movie (наименее плохой fallback).
    // На edge cases (карточка без TV-specific полей и без method) остаётся
    // вероятность ошибки → SPEC рекомендует Trakt /search/tmdb/:id, отложено.
    function detectCardType(object) {
        if (!object) return 'movie';
        if (object.method === 'tv' || object.card_type === 'tv') return 'show';
        if (object.method === 'movie' || object.card_type === 'movie') return 'movie';
        // Lampa-нативные карточки (trending/movies/shows и т.п.) часто не имеют
        // method, но сохраняют TV-specific поля от TMDB-ответа.
        if (object.name || object.original_name || object.first_air_date ||
            object.number_of_seasons || object.episode_run_time) return 'show';
        return 'movie';
    }

    function resolveCard(object) {
        var tmdbId = object && (object.id || (object.ids && object.ids.tmdb));
        var type = detectCardType(object);
        var cached = findInCache(tmdbId, type);
        if (cached) return cached;
        return {
            trakt_type: type, trakt_ids: { tmdb: tmdbId },
            trakt_status: null, trakt_watchlist: false, _trakt_progress_seasons: null
        };
    }
    function handleSidebarTap(action, object) {
        var card = resolveCard(object);
        var status = card.trakt_status;
        var wl = !!card.trakt_watchlist;
        var type = card.trakt_type;
        try {
            // Расширенная диагностика: какие поля у object были (для отладки detectCardType).
            var sig = '';
            if (object) {
                if (object.method) sig += ' method=' + object.method;
                if (object.card_type) sig += ' card_type=' + object.card_type;
                if (object.name) sig += ' name=' + JSON.stringify(String(object.name).substr(0, 30));
                if (object.first_air_date) sig += ' first_air_date=' + object.first_air_date;
                if (object.title && !object.name) sig += ' title=' + JSON.stringify(String(object.title).substr(0, 30));
            }
            console.log('[trakt_v2] sidebar tap:', action, 'on', type, card.trakt_ids && card.trakt_ids.tmdb,
                        'status=', status, 'wl=', wl, '| obj' + sig);
        } catch (_) {}

        // Watchlist toggle
        if (action === 'watchlist') {
            var p = wl ? postWatchlistRemove(card) : postWatchlistAdd(card);
            return p.then(function () {
                applyOptimisticUpdate(action, card);
                notify(wl ? 'Watchlist: removed' : 'Watchlist: added');
            }).catch(function (err) {
                try { console.warn('[trakt_v2] watchlist tap failed', err); } catch (_) {}
                notify(Lampa.Lang.translate('trakt_v2_load_error'));
            });
        }
        // Progress / Upcoming — индикаторы. Тап = noop без уведомлений.
        if (action === 'progress' || action === 'upcoming') return Promise.resolve();

        // Finished
        if (action === 'finished') {
            if (type === 'movie') {
                if (status === STATUS.FINISHED) {
                    return postHistoryRemoveMovie(card)
                        .then(function () { applyOptimisticUpdate(action, card); notify('Finished: removed'); })
                        .catch(function (err) { try { console.warn('[trakt_v2] finished remove failed', err); } catch (_) {} notify(Lampa.Lang.translate('trakt_v2_load_error')); });
                }
                var ops = [];
                if (status === STATUS.DROPPED) ops.push(postDroppedClear(card).catch(function () { return null; }));
                ops.push(postHistoryAddMovie(card));
                if (wl) ops.push(postWatchlistRemove(card).catch(function () { return null; }));
                return Promise.all(ops)
                    .then(function () { applyOptimisticUpdate(action, card); notify('Finished: added'); })
                    .catch(function (err) { try { console.warn('[trakt_v2] finished add failed', err); } catch (_) {} notify(Lampa.Lang.translate('trakt_v2_load_error')); });
            }
            // show
            if (status === STATUS.UPCOMING || status === STATUS.FINISHED) return Promise.resolve();
            var sops = [];
            if (status === STATUS.DROPPED) sops.push(postDroppedClear(card).catch(function () { return null; }));
            sops.push(postHistoryAddShow(card));
            if (wl) sops.push(postWatchlistRemove(card).catch(function () { return null; }));
            return Promise.all(sops)
                .then(function () { applyOptimisticUpdate(action, card); notify('Finished: added'); })
                .catch(function (err) {
                    try { console.warn('[trakt_v2] finished show add failed', err); } catch (_) {}
                    var code = err && err.code;
                    if (code === 'no_aired_episodes') notify('Finished: у сериала ещё нет вышедших эпизодов');
                    else if (code === 'no_ids_for_progress_resolve' || code === 'trakt_id_resolve_failed') notify('Finished: не удалось определить сериал в Trakt');
                    else if (code === 'no_progress_response' || code === 'no_progress_seasons') notify('Finished: не удалось получить данные эпизодов');
                    else notify(Lampa.Lang.translate('trakt_v2_load_error'));
                });
        }
        // Dropped (v0.1.13: hdr + custom list, без hpw; movies требуют listId)
        if (action === 'dropped') {
            if (status === STATUS.DROPPED) {
                return postDroppedClear(card)
                    .then(function () { applyOptimisticUpdate(action, card); notify('Dropped: removed'); })
                    .catch(function (err) {
                        try { console.warn('[trakt_v2] dropped remove failed', err); } catch (_) {}
                        if (err && err.code === 'no_dropped_list_for_movie') {
                            notify('Dropped: настройте папку для фильмов в настройках Trakt');
                        } else {
                            notify(Lampa.Lang.translate('trakt_v2_load_error'));
                        }
                    });
            }
            var dops = [postDroppedSet(card)];
            if (wl) dops.push(postWatchlistRemove(card).catch(function () { return null; }));
            return Promise.all(dops)
                .then(function () { applyOptimisticUpdate(action, card); notify('Dropped: added'); })
                .catch(function (err) {
                    try { console.warn('[trakt_v2] dropped add failed', err); } catch (_) {}
                    if (err && err.code === 'no_dropped_list_for_movie') {
                        notify('Dropped: настройте папку для фильмов в настройках Trakt');
                    } else {
                        notify(Lampa.Lang.translate('trakt_v2_load_error'));
                    }
                });
        }
        return Promise.resolve();
    }

    // Формирует label для пункта сайдбара по action и состоянию карточки.
    // Если object не передан / нет в кеше — берётся «дефолтный» вид:
    //   Watchlist всегда показывает рамку чекбокса (☐), статусы — без маркера.
    function labelFor(action, object) {
        var label = statusLabel(action);
        var card = object ? resolveCard(object) : null;
        if (action === 'watchlist') {
            return (card && card.trakt_watchlist ? '☑ ' : '☐ ') + label;
        }
        var statusKey = STATUS[action.toUpperCase()];
        if (card && card.trakt_status === statusKey) return '✓ ' + label;
        return label;
    }

    // Определяет, какому из наших action соответствует данный item.title.
    // Раз Lampa читает title из outer plugin.name (=labelFor(action) с null
    // карточкой при registerCardSidebar), у наших пунктов на момент открытия
    // меню title строго один из 5 дефолтов. Если позже title уже мутировали
    // и в нём есть префикс ☐/☑/✓ — снимаем префикс и сравниваем.
    function ourActionFromTitle(title) {
        if (typeof title !== 'string') return null;
        var stripped = title.replace(/^[\u2610\u2611\u2713]\s/, ''); // ☐ ☑ ✓
        for (var i = 0; i < SIDEBAR_ORDER.length; i++) {
            if (statusLabel(SIDEBAR_ORDER[i]) === stripped) return SIDEBAR_ORDER[i];
        }
        return null;
    }

    // Помечает наши пункты в готовом items-массиве правильным маркером
    // на основе текущего currentFocusedCard. Идентификация пункта — по
    // подстроке 'handleSidebarTap' в исходнике item.onSelect (Lampa оборачивает
    // наш onContextLauch, но source оборачиваемой функции преобразуется в
    // строку и содержит её тело).
    function rewriteOurItemTitles(items, card) {
        if (!Array.isArray(items)) return;
        var updated = 0;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || typeof item.onSelect !== 'function') continue;
            var src = '';
            try { src = String(item.onSelect); } catch (_) { continue; }
            if (src.indexOf('handleSidebarTap') === -1) continue;
            var action = ourActionFromTitle(item.title);
            if (!action) continue;
            item.title = labelFor(action, card);
            updated++;
        }
        try {
            console.log('[trakt_v2] rewriteOurItemTitles: updated=' + updated +
                        ' currentCard.id=' + (card && (card.id || (card.ids && card.ids.tmdb))));
        } catch (_) {}
    }

    // Мутирует outer plugin.name на каждой нашей записи в Lampa.Manifest.plugins
    // на основе состояния карточки. Источник истины для отображения подписей в
    // action-сайдбаре — Lampa-исходник Card.onMenu (см. memory
    // reference_lampa_card_onmenu.md): он читает plugin.name синхронно при
    // построении меню, поэтому если name свежий ДО события 'hover:long' (через
    // capture-phase hook), Lampa сразу отрендерит правильно.
    function updateAllOurPluginNames(card) {
        if (!window.Lampa || !Lampa.Manifest || !Array.isArray(Lampa.Manifest.plugins)) return;
        try {
            var labels = {};
            SIDEBAR_ORDER.forEach(function (a) { labels[a] = labelFor(a, card); });
            for (var i = 0; i < Lampa.Manifest.plugins.length; i++) {
                var entry = Lampa.Manifest.plugins[i];
                if (!entry || typeof entry.__trakt_v2 !== 'string') continue;
                var action = entry.__trakt_v2.replace(/^trakt_v2:/, '');
                if (labels.hasOwnProperty(action)) entry.name = labels[action];
            }
            try {
                console.log('[trakt_v2] plugin.name updated:', JSON.stringify(labels),
                            'card.id=', card && (card.id || (card.ids && card.ids.tmdb)));
            } catch (_) {}
        } catch (e) {
            try { console.warn('[trakt_v2] updateAllOurPluginNames failed', e); } catch (_) {}
        }
    }

    // Capture-phase hook на 'hover:long' DOM event — стреляет ПЕРЕД bubble-
    // listener-ом Lampa в src/interaction/card.js. Получает event.target →
    // ищет ближайший .card родитель с card_data → мутирует plugin.name по
    // состоянию найденной карточки → Lampa.Card.onMenu в bubble фазе читает
    // обновлённый plugin.name и строит item.title правильно.
    // Также обновляет currentFocusedCard для совместимости с
    // patchSelectShowForLabels (defensive layer).
    function installHoverLongHook() {
        if (typeof document === 'undefined' || !document.addEventListener) return;
        if (window.__trakt_v2_hoverlong_installed) return;
        window.__trakt_v2_hoverlong_installed = true;
        document.addEventListener('hover:long', function (e) {
            try {
                var el = e && e.target;
                while (el && el.nodeType === 1 && el !== document.body) {
                    if (el.card_data) {
                        var card = el.card_data;
                        currentFocusedCard = card;
                        updateAllOurPluginNames(card);
                        return;
                    }
                    el = el.parentElement;
                }
                try { console.log('[trakt_v2] hover:long fired but no .card_data ancestor found'); } catch (_) {}
            } catch (err) {
                try { console.warn('[trakt_v2] hover:long handler err', err); } catch (_) {}
            }
        }, true /* capture phase — до Lampa-листенера */);
        try { console.log('[trakt_v2] hover:long capture hook installed on document'); } catch (_) {}
    }

    // Патчит Lampa.Select.show один раз. Когда меню содержит наши пункты —
    // мутируем их item.title по currentFocusedCard. Идемпотентно (проверяем
    // флаг __trakt_v2_patched на новой функции). Defensive layer на случай
    // если capture-hook на hover:long не пробьётся (например, Tizen DOM
    // events).
    function patchSelectShowForLabels() {
        if (!Lampa.Select || typeof Lampa.Select.show !== 'function') return;
        if (Lampa.Select.show.__trakt_v2_patched) return;
        var orig = Lampa.Select.show;
        var patched = function (params) {
            try {
                if (params && Array.isArray(params.items)) {
                    rewriteOurItemTitles(params.items, currentFocusedCard);
                }
            } catch (e) {
                try { console.warn('[trakt_v2] patchSelectShow err', e); } catch (_) {}
            }
            return orig.apply(this, arguments);
        };
        patched.__trakt_v2_patched = true;
        Lampa.Select.show = patched;
        try { console.log('[trakt_v2] Lampa.Select.show patched for label rewriting'); } catch (_) {}
    }

    // Регистрация 5 пунктов в нативном сайдбаре карточки. Защитный extend массива
    // — не перетираем существующие entries (например trakt_by_LME).
    function registerCardSidebar() {
        if (!window.Lampa || !Lampa.Manifest) return;
        if (!Array.isArray(Lampa.Manifest.plugins)) Lampa.Manifest.plugins = [];
        SIDEBAR_ORDER.forEach(function (action) {
            var marker = 'trakt_v2:' + action;
            for (var i = 0; i < Lampa.Manifest.plugins.length; i++) {
                if (Lampa.Manifest.plugins[i] && Lampa.Manifest.plugins[i].__trakt_v2 === marker) return;
            }
            Lampa.Manifest.plugins.push({
                __trakt_v2: marker,
                type: 'video',
                // Дефолтное name (без open карточки). updateSidebarLabels мутирует
                // его при каждом открытии full-card view — это и есть наш способ
                // отразить состояние, потому что Lampa берёт title пункта именно
                // из outer plugin.name, а не из onContextMenu return.
                name: labelFor(action),
                // Defensive: всё равно отдаём актуальный label из onContextMenu,
                // на случай если в каких-то режимах Lampa всё-таки заглядывает сюда.
                onContextMenu: function (object) { return { name: labelFor(action, object) }; },
                onContextLauch: function (object) { handleSidebarTap(action, object); }
            });
        });
        try { console.log('[trakt_v2] sidebar plugins registered:', SIDEBAR_ORDER.join(',')); } catch (_) {}
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
    // Lampa SettingsApi: селектор кастомного листа Dropped
    // ────────────────────────────────────────────────────────────────────
    // Регистрируемся под component:'trakt' (раздел от trakt_by_LME, см.
    // trakt_by_LME.js:6698 — он первым делает addComponent с этим именем).
    // У v1 trakt_by_lampame использовал 'trakttv', в LME-форке переименовали.
    // Свой component через addComponent в v1 оказался нестабильным, не пытаемся.
    function registerSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || typeof Lampa.SettingsApi.addParam !== 'function') return;
        try {
            var values = { '0': 'Не выбрано' };
            getCachedLists().forEach(function (l) {
                if (l && l.id) values[String(l.id)] = String(l.name || ('list ' + l.id));
            });
            // trakt_by_LME регистрирует свой section как component:'trakt'
            // (см. trakt_by_LME.js:6698 addComponent). Раньше в v1 был 'trakttv',
            // в LME-форке переименовали.
            Lampa.SettingsApi.addParam({
                component: 'trakt',
                param: {
                    name: STORAGE_DROPPED_LIST_ID,
                    type: 'select',
                    values: values,
                    'default': '0'
                },
                field: {
                    name: 'Trakt v2: папка для статуса Dropped',
                    description: 'Кастомный список Trakt, в который плагин дублирует Dropped. ' +
                                 'Без выбора Dropped для фильмов недоступен (Trakt hidden API не поддерживает movies). ' +
                                 'Создайте список в Trakt-веб, затем выберите его здесь. ' +
                                 'Список тянется при старте плагина — если только что создали, перезагрузите страницу.'
                }
            });
            try { console.log('[trakt_v2] settings registered (trakt component, param=' + STORAGE_DROPPED_LIST_ID + ', cached_lists=' + (Object.keys(values).length - 1) + ')'); } catch (_) {}
        } catch (e) {
            try { console.warn('[trakt_v2] registerSettings failed', e); } catch (_) {}
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // Bootstrap
    // ────────────────────────────────────────────────────────────────────
    function start() {
        if (window.trakt_v2_started) return;
        window.trakt_v2_started = true;

        registerLang();
        Lampa.Component.add(COMPONENT, MainComponent);
        registerCardSidebar();
        registerSettings();

        // Async: подтягиваем актуальный список Trakt-листов в кеш — селектор
        // настроек на следующем открытии покажет свежие имена.
        if (getToken()) {
            fetchUserLists().then(function (lists) {
                try { console.log('[trakt_v2] user lists refreshed, count=' + (lists ? lists.length : 0)); } catch (_) {}
            });
        }

        // Capture-phase hook на 'hover:long' — основной механизм state-aware
        // подписей. Срабатывает ПЕРЕД Lampa.Card.onMenu, читает card_data из
        // event.target.closest('.card'), мутирует plugin.name. Чинит Path 2
        // и Path 3 одним выстрелом. См. docblock v0.1.10.
        installHoverLongHook();

        // Defensive layer: патч Lampa.Select.show — мутирует item.title прямо
        // в момент открытия меню по currentFocusedCard. Включается, если
        // capture-hook не пробился. Идемпотентен с hook (если оба сработали
        // — title уже правильный, патч не меняет).
        patchSelectShowForLabels();

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
