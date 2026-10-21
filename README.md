# ST-Device-Background

A SillyTavern / TauriTavern extension that picks the background by **screen orientation** (landscape / portrait), so images fit properly on phones, tablets and desktop windows. Every device can follow a shared choice or override it locally.

一個 SillyTavern / TauriTavern 擴充:依螢幕**橫向/直向**選擇背景,解決同一張圖在不同比例下填充不佳的問題。每台設備可以跟隨共用設定,也可以在本機單獨指定。

## How it picks a background / 選擇順序

For the current orientation, the first slot that is set wins:

| Priority | Layer | Stored in | Synced |
|---|---|---|---|
| 1 | This device | browser `localStorage` | No |
| 2 | Shared · Desktop / Mobile (advanced mode only) | extension settings (`settings.json`) | Yes |
| 3 | Shared | extension settings (`settings.json`) | Yes |
| 4 | The host's own background | SillyTavern | - |

A slot left on **follows** uses the layer below it. So on a phone you can set only "This device · Portrait"; Landscape keeps following the shared slot.

某個格子留在「follows」時,就使用它下一層的設定。例如手機只指定「This device · Portrait」,橫向仍然跟隨共用。

Orientation is re-evaluated live when the window is resized or the device is rotated.

## Install / 安裝

Install from the extension manager with this repository's URL, or copy this folder into `data/default-user/extensions/`.

用擴充功能的安裝介面貼上本倉庫網址,或把整個資料夾複製到 `data/default-user/extensions/`。

## Usage / 使用

Open the extension settings and find **Device Background**. The panel has two sections, Landscape and Portrait (the one in use is highlighted). In each section:

- **Shared** applies to every device that syncs your settings.
- **This device** overrides it on this browser only. Use **Follow** to go back to the shared slot.
- A ✓ marks the slot that is currently in effect.

Options:

- **Advanced: shared slots per device type**: adds Shared · Desktop and Shared · Mobile rows. Device type is auto-detected (touch without hover = Mobile) and can be forced per device.
- **Also override chat-locked backgrounds**: chat-locked backgrounds live in chat metadata and are synced with chats, so they win by default.
- **Turn off on this device**: ignore this extension here.

## Notes / 注意

- Background image files live in the `backgrounds` dataset (always shared on vanilla SillyTavern). On TauriTavern, if you leave it out of the sync selection, make sure the image exists on each device.
- Shared slots live in extension settings. If you exclude extension settings from sync, every device uses only its own local slots.
- The synced background is handed back immediately when you clear a slot or turn the extension off.
- Other extensions or CSS that also rewrite `#bg1` can conflict. A stylesheet rule with `!important` on `#bg1` will beat this extension.
