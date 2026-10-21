# ST-Device-Background

A SillyTavern / TauriTavern extension that picks the background by **screen orientation** (landscape / portrait), so images fit properly on phones, tablets and desktop windows. It lives inside the native Backgrounds panel.

一個 SillyTavern / TauriTavern 擴充:依螢幕**橫向/直向**選擇背景,解決同一張圖在不同比例下填充不佳的問題。介面直接整合在原生的「背景」面板裡。

## How it works / 運作方式

The extension owns four slots and ignores the native background once they are set:

| | Landscape | Portrait |
|---|---|---|
| **Global** (extension settings, synced) | ✓ | ✓ |
| **Device** (`localStorage`, not synced) | ✓ | ✓ |

Resolution order for the current orientation:

- **Landscape**: Device landscape → Global landscape
- **Portrait**: Device portrait → Global portrait → Device landscape → Global landscape

An unset portrait therefore follows landscape, so a single image still works everywhere. If nothing is set, the host's own background is left untouched.

On first run, the native background is adopted as Global landscape.

四個格子都由擴充自己保存,設定後就不再讀取原生背景。直向沒設定時會沿用橫向,所以只放一張圖也能正常運作。第一次執行時,會把原生背景當作「全局橫向」。

## Usage / 使用

Open the Backgrounds panel. The tab row is now **Global | Device | Chat**, with two rectangles (Landscape / Portrait) underneath.

1. Pick a tab: **Global** edits the synced slots, **Device** edits this browser's own slots.
2. Click a rectangle to choose which slot receives the next image.
3. Click a thumbnail in the gallery. The rectangle shows the file name; the gallery highlights the slot's current image.
4. The **×** on a rectangle clears it so it follows the layer below. Global landscape cannot be cleared, only replaced.
5. A dot on a rectangle marks the orientation currently in use.

Folders, search and sort are the native ones. Buttons on a thumbnail (lock, edit, delete...) and bulk-selection mode still behave natively.

Option: **Override chat-locked backgrounds (this device)**. Chat-locked backgrounds live in chat metadata and win by default.

## Install / 安裝

Install from the extension manager with this repository's URL, or copy this folder into `data/default-user/extensions/`.

用擴充功能的安裝介面貼上本倉庫網址,或把整個資料夾複製到 `data/default-user/extensions/`。

## Notes / 注意

- Because the native background is ignored, `/bg`, auto-select and newly uploaded images do not change what is shown until you pick them in the gallery.
- Global slots live in extension settings. On TauriTavern, whether they sync depends on your sync selection and overwrite mode (Exact / PreferNewer).
- Needs a SillyTavern version whose Backgrounds panel has the Global / Chat tabs. If the tabs are not found, the extension logs a warning and adds no UI.
- Other extensions or CSS that also rewrite `#bg1` can conflict. A stylesheet rule with `!important` on `#bg1` beats this extension.
