// Device Background
// Picks a background by screen orientation (and optionally device type).
//
// Resolution order, first slot that is set wins:
//   1. This device   (localStorage, never synced)      per orientation
//   2. Shared/<type> (extension settings, synced)      per orientation, advanced mode only
//   3. Shared/all    (extension settings, synced)      per orientation
//   4. Whatever the host (SillyTavern) set itself

const LOCAL_KEY = 'device_background_v2';
const SHARED_KEY = 'device_background';
const ORIENTATIONS = ['landscape', 'portrait'];
const SCOPES = ['all', 'desktop', 'mobile'];
const ORIENTATION_TITLE = { landscape: 'Landscape', portrait: 'Portrait' };
const SCOPE_TITLE = { local: 'This device', all: 'Shared', desktop: 'Shared · Desktop', mobile: 'Shared · Mobile' };

const portraitQuery = window.matchMedia('(orientation: portrait)');
const touchQuery = window.matchMedia('(pointer: coarse) and (hover: none)');

const emptySlots = () => ({ landscape: null, portrait: null });

let local = loadLocal();
let editing = null; // { scope, orientation } while the picker is open
let libraryCache = null;
let hostValue = '';
let applying = false;
let observer = null;

// ---------- state ----------

function loadLocal() {
    const defaults = { disabled: false, overrideChatLock: false, forceClass: 'auto', slots: emptySlots() };
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
    current.advanced = Boolean(current.advanced);
    current.slots ??= {};
    for (const scope of SCOPES) {
        current.slots[scope] = { ...emptySlots(), ...(current.slots[scope] ?? {}) };
    }
    store[SHARED_KEY] = current;
    return current;
}

function saveShared() {
    getContext().saveSettingsDebounced();
}

function getSlot(scope, orientation) {
    return scope === 'local' ? local.slots[orientation] : getShared().slots[scope][orientation];
}

function setSlot(scope, orientation, slot) {
    if (scope === 'local') {
        local.slots[orientation] = slot;
        saveLocal();
    } else {
        getShared().slots[scope][orientation] = slot;
        saveShared();
    }
    refresh();
}

// ---------- resolution ----------

const currentOrientation = () => (portraitQuery.matches ? 'portrait' : 'landscape');

function currentClass() {
    if (local.forceClass === 'desktop' || local.forceClass === 'mobile') return local.forceClass;
    return touchQuery.matches ? 'mobile' : 'desktop';
}

// Scopes that take part in resolution for this device, highest priority first.
function activeScopes() {
    return getShared().advanced ? ['local', currentClass(), 'all'] : ['local', 'all'];
}

function resolve(orientation) {
    for (const scope of activeScopes()) {
        const slot = getSlot(scope, orientation);
        if (slot) return { scope, slot };
    }
    return null;
}

// What a scope would show if it were left unset: the next layer down.
function resolveBelow(scope, orientation) {
    const chain = activeScopes();
    const start = chain.indexOf(scope);
    for (const next of chain.slice(start + 1)) {
        const slot = getSlot(next, orientation);
        if (slot) return { scope: next, slot };
    }
    return null;
}

// ---------- applying ----------

function slotCssUrl(slot) {
    if (slot.source === 'url') return `url("${slot.value.replace(/"/g, '%22')}")`;
    return `url("backgrounds/${encodeURIComponent(slot.value)}")`;
}

function slotLabel(slot) {
    const text = slot.value;
    return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

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
    const bg = document.getElementById('bg1');
    if (!bg) return;

    const winner = local.disabled ? null : resolve(currentOrientation());
    const blockedByLock = isChatLocked() && !local.overrideChatLock;

    if (winner && !blockedByLock) {
        setBackgroundStyle(slotCssUrl(winner.slot));
    } else {
        setBackgroundStyle(hostValue);
    }
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

// ---------- background library ----------

async function fetchLibrary() {
    if (libraryCache) return libraryCache;
    const { getRequestHeaders } = getContext();
    const response = await fetch('/api/backgrounds/all', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const images = Array.isArray(data) ? data : data.images ?? [];
    libraryCache = images
        .map(image => (typeof image === 'string' ? image : image.filename ?? image.name))
        .filter(Boolean);
    return libraryCache;
}

// ---------- UI ----------

function refresh() {
    apply();
    renderPanel();
}

function buildPicker(scope, orientation) {
    const existing = getSlot(scope, orientation);
    const $form = $('<div class="device_bg_picker"></div>');
    const $source = $('<select class="text_pole"><option value="library">Background library</option><option value="url">Image URL</option></select>');
    const $library = $('<select class="text_pole"></select>');
    const $url = $('<input class="text_pole" type="text" placeholder="https://..." />');
    const $save = $('<div class="menu_button">Save</div>');
    const $cancel = $('<div class="menu_button">Cancel</div>');

    $source.val(existing?.source ?? 'library');
    $url.val(existing?.source === 'url' ? existing.value : '');

    const toggle = () => {
        $library.toggle($source.val() === 'library');
        $url.toggle($source.val() === 'url');
    };
    $source.on('change', toggle);
    toggle();

    fetchLibrary()
        .then(names => {
            for (const name of names) $library.append($('<option>').val(name).text(name));
            if (existing?.source === 'library') $library.val(existing.value);
        })
        .catch(error => {
            console.warn('[device-background] failed to load backgrounds', error);
            toastr.error('Could not load the background list.', 'Device Background');
        });

    $save.on('click', () => {
        const source = $source.val();
        const value = String(source === 'library' ? $library.val() ?? '' : $url.val()).trim();
        editing = null;
        setSlot(scope, orientation, value ? { source, value } : null);
    });
    $cancel.on('click', () => {
        editing = null;
        renderPanel();
    });

    return $form.append($source, $library, $url, $('<div class="device_bg_buttons"></div>').append($save, $cancel));
}

function buildLine(scope, orientation, winnerScope) {
    const slot = getSlot(scope, orientation);
    const below = slot ? null : resolveBelow(scope, orientation);
    const participates = activeScopes().includes(scope);

    const $line = $('<div class="device_bg_line"></div>').toggleClass('device_bg_winner', scope === winnerScope);
    $line.append($('<span class="device_bg_scope"></span>').text(SCOPE_TITLE[scope]));

    const $value = $('<span class="device_bg_value"></span>');
    if (slot) {
        $value.text(slotLabel(slot));
    } else if (!participates) {
        $value.addClass('device_bg_dim').text('other device type');
    } else if (below) {
        $value.addClass('device_bg_dim').text(`follows ${SCOPE_TITLE[below.scope]}: ${slotLabel(below.slot)}`);
    } else {
        $value.addClass('device_bg_dim').text(scope === 'local' ? 'follows host background' : 'not set');
    }
    $line.append($value);

    const $set = $('<div class="menu_button"></div>').text(slot ? 'Change' : 'Set');
    $set.on('click', () => {
        editing = { scope, orientation };
        renderPanel();
    });
    $line.append($set);

    if (slot) {
        const $clear = $('<div class="menu_button"></div>').text(scope === 'local' ? 'Follow' : 'Clear');
        $clear.on('click', () => setSlot(scope, orientation, null));
        $line.append($clear);
    }

    const $wrap = $('<div></div>').append($line);
    if (editing?.scope === scope && editing.orientation === orientation) {
        $wrap.append(buildPicker(scope, orientation));
    }
    return $wrap;
}

function renderPanel() {
    const $root = $('#device_bg_sections');
    if (!$root.length) return;

    const shared = getShared();
    const orientation = currentOrientation();
    const winnerOf = o => resolve(o)?.scope;

    $root.empty();
    for (const o of ORIENTATIONS) {
        const $section = $('<div class="device_bg_section"></div>').toggleClass('device_bg_current', o === orientation);
        const $title = $('<div class="device_bg_title"></div>').text(ORIENTATION_TITLE[o]);
        if (o === orientation) $title.append(' <small>(current)</small>');
        $section.append($title);

        $section.append(buildLine('local', o, winnerOf(o)));
        if (shared.advanced) {
            $section.append(buildLine('desktop', o, winnerOf(o)));
            $section.append(buildLine('mobile', o, winnerOf(o)));
        }
        $section.append(buildLine('all', o, winnerOf(o)));
        $root.append($section);
    }

    $('#device_bg_advanced').prop('checked', shared.advanced);
    $('#device_bg_disabled').prop('checked', local.disabled);
    $('#device_bg_override_lock').prop('checked', local.overrideChatLock);
    $('#device_bg_force_class').val(local.forceClass);
    $('#device_bg_force_row').toggle(shared.advanced);
    $('#device_bg_status').text(`Now: ${ORIENTATION_TITLE[orientation]}, ${currentClass() === 'mobile' ? 'Mobile' : 'Desktop'}`);
}

function mountPanel() {
    $('#extensions_settings2').append(`
<div id="device_bg_settings" class="extension_container">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Device Background</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="device_bg_hint">
                "This device" is stored only in this browser. "Shared" is synced with your settings.
                A slot left on "follows" uses the layer below it.
            </div>
            <div id="device_bg_status" class="device_bg_hint"></div>
            <div id="device_bg_sections"></div>
            <label class="checkbox_label">
                <input id="device_bg_advanced" type="checkbox" />
                <span>Advanced: shared slots per device type (synced)</span>
            </label>
            <div id="device_bg_force_row" class="device_bg_row">
                <span>Treat this device as</span>
                <select id="device_bg_force_class" class="text_pole">
                    <option value="auto">Auto-detect</option>
                    <option value="desktop">Desktop</option>
                    <option value="mobile">Mobile</option>
                </select>
            </div>
            <label class="checkbox_label">
                <input id="device_bg_override_lock" type="checkbox" />
                <span>Also override chat-locked backgrounds (this device)</span>
            </label>
            <label class="checkbox_label">
                <input id="device_bg_disabled" type="checkbox" />
                <span>Turn off on this device</span>
            </label>
        </div>
    </div>
</div>`);

    $('#device_bg_advanced').on('change', function () {
        getShared().advanced = this.checked;
        saveShared();
        refresh();
    });
    $('#device_bg_force_class').on('change', function () {
        local.forceClass = this.value;
        saveLocal();
        refresh();
    });
    $('#device_bg_override_lock').on('change', function () {
        local.overrideChatLock = this.checked;
        saveLocal();
        refresh();
    });
    $('#device_bg_disabled').on('change', function () {
        local.disabled = this.checked;
        saveLocal();
        refresh();
    });
}

jQuery(() => {
    const { eventSource, event_types } = getContext();
    mountPanel();
    watchBackground();
    refresh();

    portraitQuery.addEventListener('change', refresh);
    touchQuery.addEventListener('change', refresh);
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(apply, 0));
    eventSource.on(event_types.SETTINGS_UPDATED, () => setTimeout(refresh, 0));
});
