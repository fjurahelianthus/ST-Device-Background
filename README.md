# ST-Device-Background

A SillyTavern / TauriTavern extension that picks the background by **screen orientation** (landscape / portrait), so images fit properly on phones, tablets and desktop windows. It lives inside the native Backgrounds panel.

一个 SillyTavern / TauriTavern 扩展:按屏幕**横向/纵向**选择背景,解决同一张图在不同比例下填充不佳的问题。界面直接集成在原生的“背景”面板里。界面文字会跟随酒馆的语言设置,目前提供简体中文和英文。

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

四个格子都由扩展自己保存,设置后就不再读取原生背景。纵向没设置时会沿用横向,所以只放一张图也能正常工作。第一次运行时,会把原生背景当作“全局横向”。

## Usage / 使用

Open the Backgrounds panel. The tab row is now **Global | Device | Chat**, with two rectangles (Landscape / Portrait) underneath.

1. Pick a tab: **Global** edits the synced slots, **Device** edits this browser's own slots.
2. Click a rectangle to choose which slot receives the next image.
3. Click a thumbnail in the gallery. The rectangle shows a preview and the file name; the gallery highlights the slot's current image. A dimmed preview with a ↳ means the slot is unset and shows the image it follows.
4. The **×** on a rectangle clears it so it follows the layer below. Global landscape cannot be cleared, only replaced.
5. A dot on a rectangle marks the orientation currently in use.

Folders, search and sort are the native ones. Buttons on a thumbnail (lock, edit, delete...) and bulk-selection mode still behave natively.

Option: **Override chat-locked backgrounds (this device)**. Chat-locked backgrounds live in chat metadata and win by default.

## Install / 安裝

Install from the extension manager with this repository's URL, or copy this folder into `data/default-user/extensions/`.

在扩展管理的安装界面粘贴本仓库地址,或把整个文件夹复制到 `data/default-user/extensions/`。

## Notes / 注意

- Because the native background is ignored, `/bg`, auto-select and newly uploaded images do not change what is shown until you pick them in the gallery.
- Global slots live in extension settings. On TauriTavern, whether they sync depends on your sync selection and overwrite mode (Exact / PreferNewer).
- Needs a SillyTavern version whose Backgrounds panel has the Global / Chat tabs. If the tabs are not found, the extension logs a warning and adds no UI.
- Other extensions or CSS that also rewrite `#bg1` can conflict. A stylesheet rule with `!important` on `#bg1` beats this extension.
