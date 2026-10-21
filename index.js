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

const LOCAL_KEY = 'device_background_v3';
const SHARED_KEY = 'device_background';
const ORIENTATIONS = ['landscape', 'portrait'];
const ORIENTATION_TITLE = { landscape: 'Landscape', portrait: 'Portrait' };

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

function setMode(next) {
    if (mode !== next) target = 'landscape';
    mode = next;
    refresh();
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
            .attr('title', file ?? (follows ? `follows ${follows}` : 'not set'));

        $rect.append($('<div class="device_bg_rect_title"></div>').text(ORIENTATION_TITLE[orientation]));
        $rect.append(
            $('<div class="device_bg_rect_file"></div>')
                .toggleClass('device_bg_dim', !file)
                .text(file ?? (follows ? `↳ ${follows}` : '—')),
        );

        if (clearable) {
            const $clear = $('<div class="device_bg_clear fa-solid fa-xmark" title="Follow"></div>');
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

function mountPanel() {
    const $list = $('#bg_tabs .bg_tabs_list');
    if (!$list.length) {
        console.warn('[device-background] background tabs not found; the panel was not added');
        return false;
    }

    const $deviceTab = $('<li class="bg_tab_button device_bg_tab"><a>Device</a></li>');
    globalTabButton().after($deviceTab);

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
        <span>Override chat-locked backgrounds (this device)</span>
    </label>
</div>`);
    $list.after($controls);

    $('#device_bg_override_lock').on('change', function () {
        local.overrideChatLock = this.checked;
        saveLocal();
        refresh();
    });

    document.addEventListener('click', onGalleryClick, true);

    const gallery = document.getElementById('bg_menu_content');
    if (gallery) {
        // The host re-renders thumbnails and re-applies its own highlight; put ours back.
        new MutationObserver(highlightGallery).observe(gallery, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }
    return true;
}

jQuery(() => {
    const { eventSource, event_types } = getContext();
    mountPanel();
    watchBackground();
    refresh();
    initFromNative();

    portraitQuery.addEventListener('change', refresh);
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(apply, 0));
    eventSource.on(event_types.SETTINGS_UPDATED, () => setTimeout(refresh, 0));
});
