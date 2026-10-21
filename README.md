# ST-Device-Background

A SillyTavern / TauriTavern extension that lets each device keep its own background while everything else stays synced.

The chosen background is stored in the browser's `localStorage`, which TT-Sync and other sync tools do not touch. The extension never writes to the synced `settings.json`.

一個 SillyTavern / TauriTavern 擴充:讓每台設備使用自己的背景,其餘設定照常同步。選擇只存在本機 `localStorage`,不會被同步,也不會寫入同步的 `settings.json`。

## Install / 安裝

Install from the extension manager with this repository's URL, or copy this folder into `data/default-user/extensions/`.

用擴充功能的安裝介面貼上本倉庫網址,或把整個資料夾複製到 `data/default-user/extensions/`。

## Usage / 使用

Open the extension settings, find **Device Background**, and:

1. Enable "Use a separate background on this device".
2. Pick an image from the background library, or paste an image URL.
3. Optionally tick "Also override chat-locked backgrounds". Chat-locked backgrounds live in chat metadata and are synced with chats, so they are not overridden by default.

Do this once on each device.

## Notes / 注意

- Turning the override off restores the synced background only after reloading the app.
- Background image files live in the `backgrounds` dataset. To use different images per device, make sure each image exists on that device (synced or uploaded).
- If you only need a different global background per device, you can instead leave the "current appearance/theme" item out of the sync selection.
