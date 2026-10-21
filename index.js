// Device Background
// Orientation-aware backgrounds, edited from the native Backgrounds panel.
//
// Four slots, all owned by this extension (the native background is ignored once
// a slot is set):
//   Global  landscape / portrait   extension settings, synced with settings
//   Device  landscape / portrait   localStorage, never synced
//
// Landscape: device landscape -> global landscape
// Portrait:  device portrait -> global portrait -> device landscape -> global landscape
// Nothing set: the host's own background is left alone.

const VERSION = '0.3.4';
const LOCAL_KEY = 'device_background_v3';
const SHARED_KEY = 'device_background';
const ORIENTATIONS = ['landscape', 'portrait'];
const ORIENTATION_TITLE = { landscape: 'Landscape', portrait: 'Portrait' };

const STRINGS = {
    'zh-cn': {
        'Device': '本设备',
        'Landscape': '横向',
        'Portrait': '纵向',
        'Follow': '跟随',
        'follows': '跟随',
        'not set': '未设置',
        'Override chat-locked backgrounds (this device)': '覆盖聊天锁定的背景（仅本设备）',
    },
};

// Follows the host's language setting, which SillyTavern keeps in localStorage.
function currentLocale() {
    let language = '';
    try {
        language = localStorage.getItem('language') ?? '';
    } catch {
        // storage unavailable
    }
    language = (language || navigator.language || 'en').toLowerCase();
    return language === 'zh' || language.startsWith('zh-cn') || language.startsWith('zh-hans') ? 'zh-cn' : language;
}

const tr = text => STRINGS[currentLocale()]?.[text] ?? text;

const portraitQuery = window.matchMedia('(orientation: portrait)');

const emptySlots = () => ({ landscape: null, portrait: null });

let local = loadLocal();
let mode = 'global'; // which tab is shown: 'global' | 'device'
let target = 'landscape'; // which rectangle receives the next picked image
let hostValue = '';
let applying = false;
let observer = null;

// ---------- state ----------

function loadLocal() {
    const defaults = { overrideChatLock: false, slots: emptySlots() };
    try {
        const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
        return { ...defaults, ...raw, slots: { ...emptySlots(), ...(raw.slots ?? {}) } };
    } catch {
        return defaults;
    }
}

function saveLocal() {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
    } catch (error) {
        console.warn('[device-background] failed to persist local settings', error);
    }
}

function getContext() {
    return SillyTavern.getContext();
}

function getShared() {
    const store = getContext().extensionSettings;
    const current = store[SHARED_KEY] ?? {};
    current.initialized = Boolean(current.initialized);
    current.global = { ...emptySlots(), ...(current.global ?? {}) };
    store[SHARED_KEY] = current;
    return current;
}

function saveShared() {
    getContext().saveSettingsDebounced();
}

const modeScope = () => (mode === 'device' ? 'local' : 'global');

function getSlot(scope, orientation) {
    return scope === 'local' ? local.slots[orientation] : getShared().global[orientation];
}

function setSlot(scope, orientation, file) {
    if (scope === 'local') {
        local.slots[orientation] = file;
        saveLocal();
    } else {
        const shared = getShared();
        shared.global[orientation] = file;
        shared.initialized = true;
        saveShared();
    }
    refresh();
}

// The first run adopts the native background as the global landscape.
async function initFromNative() {
    const shared = getShared();
    if (shared.initialized) return;

    let name = '';
    try {
        const module = await import('/scripts/backgrounds.js');
        name = module.background_settings?.name ?? '';
    } catch (error) {
        console.warn('[device-background] could not read the native background', error);
    }
    if (!name) return;

    shared.global.landscape = name;
    shared.initialized = true;
    saveShared();
    refresh();
}

// ---------- resolution ----------

const currentOrientation = () => (portraitQuery.matches ? 'portrait' : 'landscape');

function resolveFile(orientation) {
    const global = getShared().global;
    const landscape = local.slots.landscape ?? global.landscape;
    if (orientation === 'landscape') return landscape;
    return local.slots.portrait ?? global.portrait ?? landscape;
}

// What an unset rectangle in the current tab falls back to.
function followFile(orientation) {
    const global = getShared().global;
    if (mode === 'device') {
        return orientation === 'landscape' ? global.landscape : global.portrait ?? resolveFile('landscape');
    }
    return orientation === 'portrait' ? global.landscape : null;
}

// ---------- applying ----------

const fileCssUrl = file => `url("backgrounds/${encodeURIComponent(file)}")`;

function isChatLocked() {
    return Boolean(getContext().chatMetadata?.custom_background);
}

function setBackgroundStyle(value) {
    const bg = document.getElementById('bg1');
    if (!bg) return;
    applying = true;
    try {
        // Compare through the style engine so quoting differences don't cause a loop.
        const probe = document.createElement('div');
        probe.style.backgroundImage = value;
        if (bg.style.backgroundImage !== probe.style.backgroundImage) {
            bg.style.backgroundImage = value;
            // Observer callbacks run later, so drop our own mutation record here.
            observer?.takeRecords();
        }
    } finally {
        applying = false;
    }
}

function apply() {
    if (!document.getElementById('bg1')) return;

    const file = resolveFile(currentOrientation());
    const blockedByLock = isChatLocked() && !local.overrideChatLock;

    setBackgroundStyle(file && !blockedByLock ? fileCssUrl(file) : hostValue);
}

// The host rewrites #bg1 on chat switch and when a background is picked. Remember
// what it wanted so we can hand it back, then re-apply our choice.
function watchBackground() {
    const bg = document.getElementById('bg1');
    if (!bg || observer) return;
    hostValue = bg.style.backgroundImage;
    observer = new MutationObserver(() => {
        if (applying) return;
        hostValue = bg.style.backgroundImage;
        apply();
    });
    observer.observe(bg, { attributes: true, attributeFilter: ['style'] });
}

// ---------- native panel integration ----------

function activeTabIndex() {
    try {
        return $('#bg_tabs').tabs('option', 'active');
    } catch {
        return 0;
    }
}

function globalTabButton() {
    return $('#bg_tabs .bg_tabs_list .bg_tab_button').not('.device_bg_tab').first();
}

function syncTabs() {
    const onGalleryPanel = activeTabIndex() === 0;
    globalTabButton().toggleClass('ui-tabs-active', onGalleryPanel && mode === 'global');
    $('.device_bg_tab').toggleClass('ui-tabs-active', onGalleryPanel && mode === 'device');
    $('#device_bg_controls').toggle(onGalleryPanel);
}

function highlightGallery() {
    const file = getSlot(modeScope(), target);
    $('#bg_menu_content .bg_example').each(function () {
        this.classList.toggle('selected-background', Boolean(file) && this.getAttribute('bgfile') === file);
    });
}

// Picking a thumbnail writes to the chosen rectangle instead of the native background.
function onGalleryClick(event) {
    const thumbnail = event.target.closest?.('#bg_menu_content .bg_example');
    if (!thumbnail) return;
    if (event.target.closest('.jg-button, .mobile-only-menu-toggle')) return;
    if ($('#Backgrounds').hasClass('bg-selection-mode')) return;

    const file = thumbnail.getAttribute('bgfile');
    if (!file) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    setSlot(modeScope(), target, file);
}

// The native zoom/select buttons are positioned over the right end of the tab row;
// keep the tabs clear of them however wide that group currently is.
function reserveControlsSpace(list) {
    const controls = list.querySelector('.heading-controls');
    if (!controls || typeof ResizeObserver === 'undefined') return;
    const update = () => {
        list.style.paddingRight = `${controls.offsetWidth + 10}px`;
    };
    update();
    new ResizeObserver(update).observe(controls);
}

function setMode(next) {
    if (mode !== next) target = 'landscape';
    mode = next;
    refresh();
}

// Prefer the host's thumbnail endpoint and fall back to the full image. Resolved
// urls are cached so re-rendering the rectangles does not flash.
const previewUrls = new Map();

function loadPreview($layer, file) {
    const cached = previewUrls.get(file);
    if (cached) {
        $layer.css('background-image', `url("${cached}")`);
        return;
    }

    const thumbnail = `/thumbnail?type=bg&file=${encodeURIComponent(file)}`;
    const full = `backgrounds/${encodeURIComponent(file)}`;
    const probe = new Image();
    const use = url => {
        previewUrls.set(file, url);
        $layer.css('background-image', `url("${url}")`);
    };
    probe.onload = () => use(thumbnail);
    probe.onerror = () => use(full);
    probe.src = thumbnail;
}

function renderControls() {
    const $root = $('#device_bg_rects');
    if (!$root.length) return;

    const scope = modeScope();
    const live = currentOrientation();
    $root.empty();

    for (const orientation of ORIENTATIONS) {
        const file = getSlot(scope, orientation);
        const follows = file ? null : followFile(orientation);
        const clearable = file && !(scope === 'global' && orientation === 'landscape');

        const $rect = $('<div class="device_bg_rect"></div>')
            .addClass(`device_bg_${orientation}`)
            .toggleClass('device_bg_target', orientation === target)
            .toggleClass('device_bg_live', orientation === live)
            .attr('title', file ?? (follows ? `${tr('follows')} ${follows}` : tr('not set')));

        const shown = file ?? follows;
        if (shown) {
            const $preview = $('<div class="device_bg_rect_preview"></div>').toggleClass('device_bg_dim', !file);
            loadPreview($preview, shown);
            $rect.append($preview);
        }

        const $text = $('<div class="device_bg_rect_text"></div>');
        $text.append($('<div class="device_bg_rect_title"></div>').text(tr(ORIENTATION_TITLE[orientation])));
        $text.append(
            $('<div class="device_bg_rect_file"></div>')
                .toggleClass('device_bg_dim', !file)
                .text(file ?? (follows ? `↳ ${follows}` : '—')),
        );
        $rect.append($text);

        if (clearable) {
            const $clear = $('<div class="device_bg_clear fa-solid fa-xmark"></div>').attr('title', tr('Follow'));
            $clear.on('click', event => {
                event.stopPropagation();
                setSlot(scope, orientation, null);
            });
            $rect.append($clear);
        }

        $rect.on('click', () => {
            target = orientation;
            refresh();
        });
        $root.append($rect);
    }

    $('#device_bg_override_lock').prop('checked', local.overrideChatLock);
}

function refresh() {
    apply();
    syncTabs();
    renderControls();
    highlightGallery();
}

let galleryObserver = null;
let clickListenerAttached = false;

// Safe to call repeatedly: it does nothing while the tab is already in place.
function mountPanel() {
    const $list = $('#bg_tabs .bg_tabs_list');
    if (!$list.length || $list.find('.device_bg_tab').length) return false;

    const $deviceTab = $('<li class="bg_tab_button device_bg_tab"><a></a></li>');
    $deviceTab.find('a').text(tr('Device'));
    globalTabButton().after($deviceTab);
    reserveControlsSpace($list[0]);

    $deviceTab.on('click', () => {
        mode = 'device';
        target = 'landscape';
        if (activeTabIndex() === 0) {
            refresh();
        } else {
            $('#bg_tabs').tabs('option', 'active', 0); // tabsactivate refreshes
        }
    });
    globalTabButton().on('click', () => setMode('global'));
    $('#bg_tabs').on('tabsactivate', () => refresh());

    const $controls = $(`
<div id="device_bg_controls">
    <div id="device_bg_rects"></div>
    <label class="checkbox_label device_bg_lock">
        <input id="device_bg_override_lock" type="checkbox" />
        <span></span>
    </label>
</div>`);
    $controls.find('.device_bg_lock span').text(tr('Override chat-locked backgrounds (this device)'));
    $list.after($controls);

    $('#device_bg_override_lock').on('change', function () {
        local.overrideChatLock = this.checked;
        saveLocal();
        refresh();
    });

    if (!clickListenerAttached) {
        document.addEventListener('click', onGalleryClick, true);
        clickListenerAttached = true;
    }

    galleryObserver?.disconnect();
    const gallery = document.getElementById('bg_menu_content');
    if (gallery) {
        // The host re-renders thumbnails and re-applies its own highlight; put ours back.
        galleryObserver = new MutationObserver(highlightGallery);
        galleryObserver.observe(gallery, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }
    return true;
}

// The host may create the Backgrounds panel after this extension loads (or park and
// restore it), so mount whenever it shows up without our tab instead of only at startup.
function watchForPanel() {
    let pending = false;
    let markupReported = false;

    const check = () => {
        pending = false;
        watchBackground();
        if (mountPanel()) {
            refresh();
            return;
        }
        const tabsPresent = document.getElementById('bg_tabs');
        const listPresent = document.querySelector('#bg_tabs .bg_tabs_list');
        if (tabsPresent && !listPresent && !markupReported) {
            markupReported = true;
            // Give a half-rendered panel a moment before calling the markup unsupported.
            setTimeout(() => {
                if (!document.querySelector('#bg_tabs .bg_tabs_list')) {
                    reportProblem('background tabs markup not recognised');
                }
            }, 3000);
        }
    };

    new MutationObserver(() => {
        if (pending) return;
        pending = true;
        setTimeout(check, 50);
    }).observe(document.body, { childList: true, subtree: true });

    check();
}

// Some hosts have no reachable console, so problems are reported on screen instead.
function reportProblem(reason, error) {
    const tabList = document.querySelector('#bg_tabs .bg_tabs_list');
    const lines = [
        `v${VERSION}: ${reason}`,
        error ? `error: ${error?.message ?? error}` : null,
        `#bg_tabs: ${Boolean(document.getElementById('bg_tabs'))}`,
        `.bg_tabs_list: ${Boolean(tabList)}`,
        `device tabs in DOM: ${document.querySelectorAll('.device_bg_tab').length}`,
        `jQuery UI tabs: ${typeof $.fn.tabs}`,
        `context: extensionSettings=${typeof getContext().extensionSettings}, chatMetadata=${typeof getContext().chatMetadata}`,
        `viewport: ${window.innerWidth}x${window.innerHeight}`,
        tabList ? `tab list: ${tabList.innerHTML.replace(/\s+/g, ' ').slice(0, 400)}` : null,
    ].filter(Boolean);
    console.warn('[device-background]', ...lines);
    toastr.error(lines.join('\n'), 'Device Background', {
        timeOut: 0,
        extendedTimeOut: 0,
        closeButton: true,
        escapeHtml: true,
    });
}

jQuery(() => {
    try {
        const { eventSource, event_types } = getContext();
        watchForPanel();
        refresh();
        initFromNative();

        portraitQuery.addEventListener('change', refresh);
        eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(apply, 0));
        eventSource.on(event_types.SETTINGS_UPDATED, () => setTimeout(refresh, 0));
    } catch (error) {
        console.error('[device-background]', error);
        reportProblem('startup failed', error);
    }
});
