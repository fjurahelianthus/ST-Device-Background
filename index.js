// Device Background
// Per-device background override. The choice lives in localStorage, which TT-Sync
// never touches, so every device keeps its own background while the rest of the
// appearance settings and chats can still be synced.

const STORAGE_KEY = 'device_background_v1';
const DEFAULTS = Object.freeze({
    enabled: false,
    source: 'library', // 'library' (a file in backgrounds/) or 'url'
    name: '',
    url: '',
    overrideChatLock: false,
});

let settings = loadSettings();
let observer = null;
let applying = false;

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
        return { ...DEFAULTS };
    }
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.warn('[device-background] failed to persist settings', error);
    }
}

function getContext() {
    return SillyTavern.getContext();
}

function isChatLocked() {
    return Boolean(getContext().chatMetadata?.custom_background);
}

function targetCssUrl() {
    if (settings.source === 'url' && settings.url) {
        return `url("${settings.url.replace(/"/g, '%22')}")`;
    }
    if (settings.source === 'library' && settings.name) {
        return `url("backgrounds/${encodeURIComponent(settings.name)}")`;
    }
    return '';
}

function shouldOverride() {
    if (!settings.enabled || !targetCssUrl()) return false;
    return settings.overrideChatLock || !isChatLocked();
}

function apply() {
    const bg = document.getElementById('bg1');
    if (!bg || !shouldOverride()) return;

    const wanted = targetCssUrl();
    applying = true;
    try {
        // Compare through the style engine so quoting differences don't cause a loop.
        const probe = document.createElement('div');
        probe.style.backgroundImage = wanted;
        if (bg.style.backgroundImage !== probe.style.backgroundImage) {
            bg.style.backgroundImage = wanted;
        }
    } finally {
        applying = false;
    }
}

// The host rewrites #bg1 on chat switch and on background selection; undo that.
function watchBackground() {
    const bg = document.getElementById('bg1');
    if (!bg || observer) return;
    observer = new MutationObserver(() => {
        if (!applying) apply();
    });
    observer.observe(bg, { attributes: true, attributeFilter: ['style'] });
}

async function fetchBackgrounds() {
    const { getRequestHeaders } = getContext();
    const response = await fetch('/api/backgrounds/all', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : data.images ?? [];
}

function renderSettings() {
    const html = `
<div id="device_bg_settings" class="extension_container">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Device Background</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="device_bg_hint">Stored only on this device. Not synced.</div>
            <label class="checkbox_label">
                <input id="device_bg_enabled" type="checkbox" />
                <span>Use a separate background on this device</span>
            </label>
            <div class="device_bg_row">
                <select id="device_bg_source" class="text_pole">
                    <option value="library">Background library</option>
                    <option value="url">Image URL</option>
                </select>
            </div>
            <div class="device_bg_row" id="device_bg_library_row">
                <select id="device_bg_name" class="text_pole"></select>
                <div id="device_bg_reload" class="menu_button" title="Reload list">
                    <i class="fa-solid fa-rotate"></i>
                </div>
            </div>
            <div class="device_bg_row" id="device_bg_url_row">
                <input id="device_bg_url" class="text_pole" type="text" placeholder="https://..." />
            </div>
            <label class="checkbox_label">
                <input id="device_bg_override_lock" type="checkbox" />
                <span>Also override chat-locked backgrounds</span>
            </label>
        </div>
    </div>
</div>`;
    $('#extensions_settings2').append(html);

    const $enabled = $('#device_bg_enabled');
    const $source = $('#device_bg_source');
    const $name = $('#device_bg_name');
    const $url = $('#device_bg_url');
    const $lock = $('#device_bg_override_lock');

    const syncRows = () => {
        $('#device_bg_library_row').toggle(settings.source === 'library');
        $('#device_bg_url_row').toggle(settings.source === 'url');
    };

    const reloadList = async () => {
        try {
            const images = await fetchBackgrounds();
            $name.empty().append('<option value="">(none)</option>');
            for (const image of images) {
                const file = typeof image === 'string' ? image : image.filename ?? image.name;
                if (file) $name.append($('<option>').val(file).text(file));
            }
            $name.val(settings.name);
        } catch (error) {
            console.warn('[device-background] failed to load backgrounds', error);
            toastr.error('Could not load the background list.', 'Device Background');
        }
    };

    $enabled.prop('checked', settings.enabled);
    $source.val(settings.source);
    $url.val(settings.url);
    $lock.prop('checked', settings.overrideChatLock);
    syncRows();

    const commit = () => {
        saveSettings();
        apply();
    };

    $enabled.on('change', function () {
        settings.enabled = this.checked;
        saveSettings();
        if (settings.enabled) {
            apply();
        } else {
            restoreHostBackground();
        }
    });
    $source.on('change', function () {
        settings.source = this.value;
        syncRows();
        commit();
    });
    $name.on('change', function () {
        settings.name = this.value;
        commit();
    });
    $url.on('change', function () {
        settings.url = this.value.trim();
        commit();
    });
    $lock.on('change', function () {
        settings.overrideChatLock = this.checked;
        saveSettings();
        if (!settings.enabled) return;
        if (this.checked) {
            apply();
        } else {
            restoreHostBackground();
        }
    });
    $('#device_bg_reload').on('click', reloadList);

    reloadList();
}

// Put back whatever the host would show (chat lock first, then the synced global one).
function restoreHostBackground() {
    const bg = document.getElementById('bg1');
    if (!bg) return;
    const locked = getContext().chatMetadata?.custom_background;
    if (locked) {
        applying = true;
        bg.style.backgroundImage = locked;
        applying = false;
        return;
    }
    // The synced global value is only known to the host, so let a reload restore it.
    toastr.info('Reload the app to bring back the synced background.', 'Device Background');
}

jQuery(() => {
    const { eventSource, event_types } = getContext();
    renderSettings();
    watchBackground();
    apply();
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(apply, 0));
});
