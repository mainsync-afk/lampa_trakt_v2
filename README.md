# lampa_trakt_v2

Плагин для Lampa — синхронизация просмотренного с [Trakt.tv](https://trakt.tv/).
Версия 2: переписан с нуля относительно v1, без вмешательства в нативный `Lampa.Favorite`.

**Статус:** в активной разработке. Phase 2 (write-actions) реализована, идёт отладка матрицы переходов между статусами.

## Идея

В отличие от v1 (синхронизировал нативные папки `Lampa.Favorite` с Trakt — вступал в гонку с `cub.red` и не работал на Tizen TV), v2 живёт **рядом** с нативной картотекой Lampa, а не внутри неё:

- Свой пункт в левом меню навигации.
- Свой экран с пятью статусными рядами: Смотрю / Закладки / Продолжение следует / Просмотрено / Брошено.
- Регистрация 5 пунктов в нативном action-сайдбаре карточки через `Lampa.Manifest.plugins`.
- Никаких записей в `Lampa.Favorite` — Trakt является единственным источником правды.

Полная спецификация — в [SPEC_v2.md](SPEC_v2.md).

## Модель

Карточка имеет ДВА независимых поля:

- `trakt_status` — один из `null | 'progress' | 'finished' | 'upcoming' | 'dropped'` (взаимоисключающие).
- `trakt_watchlist` — boolean (ортогональный статусу флажок).

Карточка отображается на главной странице, если `status != null || watchlist === true`. Ряд Watchlist собирает все карточки с `watchlist=true` независимо от статуса — дубли с рядами статусов осмысленны.

## Зависимости

На текущем этапе плагин работает как **надстройка** над сторонним плагином `trakt_by_LME`:

- OAuth, device-code-flow, refresh-токены — за `trakt_by_LME`.
- Scrobble эпизодов на плеере — за `trakt_by_LME`.
- Токен читается напрямую из `Lampa.Storage.get('trakt_token')`.
- Прокси Trakt API: тот же, что использует `trakt_by_LME` (`https://apx.lme.isroot.in/trakt`).

Финальная независимость (свой `client_id` + свой прокси) — отложена.

## Установка

В настройках Lampa подключить плагин по URL `https://mainsync-afk.github.io/lampa_trakt_v2/trakt_v2.js?v=<version>` (cache-bust через query на каждом обновлении).

Перед использованием — войти в Trakt через настройки плагина `trakt_by_LME` (TraktTV). Без действительного токена `Trakt v2` покажет заглушку с подсказкой авторизоваться.

Для статуса Dropped (особенно для фильмов): создай в Trakt-веб кастомный список → выбери его в Lampa → настройки → раздел Trakt.TV → «Trakt v2: папка для статуса Dropped».

## Дорожная карта

- **Phase 1 MVP** — пункт меню, Activity component, единый список Watchlist. ✅
- **Phase 1 расширение** — пять секций по статусам, классификатор, TMDB-обогащение карточек. ✅
- **Phase 2** — write-actions, регистрация в нативном сайдбаре, Pending Ops. _В разработке (Pending Ops отложен — Trakt API сейчас отвечает достаточно быстро)._
- **Phase 3** — ресёрч по подмене/отключению нативного сайдбара. _Закрыт: расширяем нативный сайдбар, не подменяем._
- Эпизод-синхронизация с `Lampa.Timeline` — отложено, см. SPEC §«Решения, отложенные на потом».

## Лицензия

Не определена.

---

# Changelog

## v0.1.17 — фикс пропадания dropped-карточек + bilingual сайдбар + разделители

- **Bug**: карточка из нативной папки тапом Dropped пропадала из UI после re-fetch. `fetchAll` строил `byKey` только из watchlist+watched-эндпоинтов; items, существующие ТОЛЬКО в custom list или hidden_dropped (без watched/wl), выпадали из классифицированного результата.
- **Fix**: `processList(listItems)` и `processHiddenDropped(hiddenDR)` добавляют такие items в `byKey` отдельным проходом; `droppedTmdbByType` после этого корректно ставит флаг.
- **Bug**: `applyOptimisticUpdate` имел legacy early-return для movie+dropped (с v0.1.12, когда movies dropped не поддерживался). С v0.1.13 поддержку добавили, но забыли убрать return — оптимистичный кеш для фильмов в Dropped не работал.
- **Fix**: убран ранний return; логика идентична для movie и show.
- **UI**: новый порядок пунктов сайдбара — `[watchlist, progress, upcoming, finished, dropped]` (Watchlist первым, отдельно от 4 статусов).
- **UI**: билингвальные подписи в сайдбаре — «Закладки (Watchlist)», «Смотрю (Progress)», «Продолжение следует (Upcoming)», «Просмотрено (Finished)», «Брошено (Dropped)». Объединили `STATUS_LABEL` и `STATUS_ROW_LABEL` в одну карту — теперь и ряды, и сайдбар используют один источник.
- **UI**: разделитель после Watchlist в сайдбаре — `Lampa.Select.show` патч вставляет `{title: '', separator: true}` после нашего Watchlist-пункта.
- **Workflow**: changelog переехал в README.md, шапка `trakt_v2.js` ужалась до краткого описания.

## v0.1.16 — порядок и билингвальные подписи рядов главной страницы

- `ROW_ORDER` изменён с `[watchlist, progress, finished, upcoming, dropped]` на `[progress, watchlist, upcoming, finished, dropped]`.
- Подписи рядов в формате «Русское (English)»: Смотрю (Progress), Закладки (Watchlist), Продолжение следует (Upcoming), Просмотрено (Finished), Брошено (Dropped).
- Новый `STATUS_ROW_LABEL` и `rowLabel(status)` (в v0.1.17 объединены с `STATUS_LABEL`).

## v0.1.15 — on-demand резолв `_trakt_progress_seasons`

- **Bug**: тап Finished на сериале со статусом None (например, «Больница Питт» в WL=false) → `postHistoryAddShow` rejected с `no_progress_seasons` (потому что `fetchAll` тянет `/shows/<id>/progress/watched` только для шоу in_watched=true). На Trakt ничего не уходило.
- **Fix**: `ensureProgressSeasons(card)` внутри `postHistoryAddShow`. Если `card.trakt_ids.trakt` есть — fetch progress сразу. Иначе — резолв через `/search/tmdb/<tmdb>?type=show` (с обогащением `card.trakt_ids` найденными `trakt/imdb/slug`), потом fetch progress. Кешируется в `card._trakt_progress_seasons`.
- Новые error codes: `no_aired_episodes`, `trakt_id_resolve_failed`, `no_progress_response` — с понятными нотификациями.
- Удалён обманчивый notify «open card first to load episodes».

## v0.1.14 — фикс имени Lampa-section для Settings

- В v0.1.13 регистрировали `addParam` под `component:'trakttv'` (как в v1). В LME-форке `trakt_by_LME` секцию переименовали в `'trakt'` (см. trakt_by_LME.js:6698 `addComponent({component:'trakt'})`). Без правильного имени `addParam` silently ничего не делает — пункт не появлялся.
- Поменяли component на `'trakt'`.

## v0.1.13 — Custom list для Dropped + Settings UI; ушли от hpw полностью

- **Backlog #7 закрыт частично.** Раньше Dropped писали в `hpw + hdr` (двойник под видом «триплета»), для movies был notify «not yet supported».
- Теперь: пишем в `hdr + custom list`. Movies без листа недоступны (явный notify «настройте папку Dropped в настройках»).
- **`hpw` НЕ пишем и НЕ читаем (backlog #10).** Moviebase пишет туда «Stop watching» и не имеет UI для отмены — карточка залипает в `hpw` без возможности достать её обратно. Если бы мы тоже туда писали, наш «un-drop» оставлял бы Moviebase-запись и UI был бы рассинхронизирован.
- Канонизация v1 (fire-and-forget POST в недостающие ячейки с throttle) отложена — без `hpw` она нужна только между `hdr` и list, и вопрос как себя ведут другие клиенты ещё не закрыт.
- Settings: `Lampa.SettingsApi.addParam` под `component:'trakttv'` (исправлено в v0.1.14 на `'trakt'`).
- `droppedTmdb` теперь type-aware — keyed по `'show:<tmdb>'` / `'movie:<tmdb>'` потому что list возвращает оба типа.

## v0.1.12 — `detectCardType` для нативных папок

- **Bug**: long-press на сериале в нативной папке (trending/movies/shows) → `resolveCard` возвращал `'movie'` (Lampa-нативные карточки не имеют `method`/`card_type`) → `postWatchlistAdd` слал `{ movies: [...] }` с tmdb сериала → Trakt находил ДРУГОЙ фильм с тем же tmdb-id и добавлял его в WL. Юзер видел чужой фильм в WL row, сериал не попадал в Trakt.
- **Fix**: `detectCardType` с приоритетами — explicit `method`/`card_type` для наших карточек, иначе Lampa-эвристика (`name/original_name/first_air_date/number_of_seasons` → show, как в Lampa card.js: `type: data.name?'tv':'movie'`), default movie.
- Edge cases (карточка без TV-specific полей и без method) могут остаться мис-классифицированными — fallback на Trakt `/search/tmdb/:id` будет нужен в отдельной версии.

## v0.1.11 — оптимистичное обновление кеша вместо Activity.replace

- Раньше после каждого write-action делали `refreshScreenIfActive()` → `Lampa.Activity.replace()` → весь экран пересобирался: новый fetchAll, ребилд 5 рядов, потеря фокуса. Юзер видел дёргающийся рефреш.
- В нативной папке `refreshScreenIfActive` ничего не делал → `LAST_RESULTS` оставался stale → следующий long-press на той же карточке показывал старое состояние до повторного захода в нашу папку.
- **Решение**: `applyOptimisticUpdate(action, card)` мутирует `LAST_RESULTS` in-place по матрице действия. Активити больше не дёргается. Сайдбар на той же карточке сразу показывает новое состояние.
- **Trade-off**: ряды на нашей странице НЕ реорганизуются мгновенно — карточки переезжают между рядами только на следующем заходе в папку. Это в backlog (DOM-уровень обновление без Activity.replace).
- `refreshScreenIfActive()` оставлен как dead code на случай ручной кнопки «обновить».

## v0.1.10 — state-aware sidebar labels через `hover:long` capture-phase hook

- После изучения `src/interaction/card.js` в lampa-source: `Card.onMenu` строит action-сайдбар на DOM-event `'hover:long'` (long-press на карточке), внутри делает `Manifest.plugins.forEach` и использует `plugin.name` как `item.title`. На карточке-DOM-элементе лежит `el.card_data` (JS-property).
- Регистрируем capture-phase listener на `document` для `'hover:long'` — гарантированно срабатывает ПЕРЕД bubble-listener-ом Lampa. Из `event.target.closest('.card')` читаем `card_data` → мутируем `plugin.name` на всех 5 наших entries.
- **Бонус**: тот же hook чинит Path 3 (long-press в нативной папке) — подписи становятся state-aware и в native рядах.
- Сохраняем `patchSelectShowForLabels` как defensive layer.
- Маркеры: `☐` Watchlist / `☑` Watchlist (toggle), Progress / `✓` Progress (single-select).

## v0.1.9 — попытка через `Select.show` patch (промежуточная)

- Заменили `Listener.follow('full')` на патч `Lampa.Select.show`. Карточку ловили через `line.onFocus → currentFocusedCard`. На реальных тестах подписи не обновлялись.
- Удалены: `updateSidebarLabels`, `Listener.follow('full')` (мёртвый код).

## v0.1.8 — попытка state-aware подписей через Listener.follow (не сработала)

- Lampa-обёртка плагинов выкидывает поля `checkbox/collect/checked/selected` из `onContextMenu` return. Решено выражать состояние Unicode-маркером в `plugin.name`. Обновлять имя пытались через `Lampa.Listener.follow('full')` — НЕ РАБОТАЕТ: long-press на карточке в нашей папке открывает action-сайдбар напрямую, минуя full-card view.
- Фикс v0.1.7: при попадании карточки в два ряда (WL + status) клонируем card-data в `buildSections` (`Object.assign({}, c)`).

## v0.1.7 — Phase 2 write-actions через нативный action-сайдбар

- Статус (один из 4: Progress/Upcoming/Finished/Dropped) отделён от Watchlist-флажка (ортогональный boolean).
- Карточка может иметь статус И WL одновременно. Ряд Watchlist показывает все WL=true независимо от статуса.
- Регистрация 5 пунктов в `Lampa.Manifest.plugins`; tap-обработчики по согласованной матрице переходов.

## v0.1.6 — тонкий `content` controller для D-pad

- Вернули `Controller.add('content', ...)` с делегацией на `lastFocused.toggle()`. Нужно для возврата фокуса из menu/head в активити.
- Постеры — руками выпускаем `'visible'` event на каждой линии после монтажа → `InteractionLine.visible()` → lazy-load картинок без необходимости прокрутки.

## v0.1.5 — фикс D-pad навигации

- Убран outer `Controller.add('content')` — конфликтовал со встроенным `items_line` controller `InteractionLine`.
- Активация первой линии через `lines[0].toggle()`; `onUp/onDown` переключают controller на соседний ряд через `.toggle()`.
- `onLeft` с самого левого края → выход в меню. `onToggle` синхронизирует outer scroll и триггерит lazy-load.

## v0.1.4 — раскладка на нативные примитивы Lampa

- После ресёрча нативного экрана «Избранное» (компонент `bookmarks`): outer `Lampa.Scroll({mask:true, over:true})` + 5 × `Lampa.InteractionLine`.
- Карточки стандартные через встроенный path `InteractionLine → new Lampa.Card`.
