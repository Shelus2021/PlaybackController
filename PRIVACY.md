# 隐私说明 / Privacy Notice

生效日期 / Effective date: 2026-10-08

## 中文

播放控制不会把浏览历史、媒体地址、页面内容或使用统计发送给 Shelus2021 或开发者控制的服务器，也不包含广告、遥测或分析 SDK。

为实现媒体检索，扩展会在浏览器内处理网络请求信息，并临时记录媒体地址、来源页地址、Referer、页面标题、媒体类型和大小。普通窗口的记录保存在浏览器的 `storage.local` 中，并在页面导航、标签页关闭或定期清理时移除。是否允许扩展在隐私窗口运行完全由 Firefox 的扩展权限控制；获准后，隐私窗口中的媒体记录仅保存在内存中，不会写入持久存储。

用户主动预览或下载媒体时，扩展会直接连接媒体所在的第三方服务器，并可能使用该网站已有的登录凭据以及服务器要求的 Referer/Origin 请求头。此通信发生在用户与该第三方网站之间，适用该网站自己的隐私政策。

扩展设置保存在 `storage.sync`。如果用户启用了 Firefox Sync，Firefox 可能根据其自身政策同步这些设置。扩展不会读取剪贴板，只会在用户点击复制按钮时写入用户选择的媒体链接。

问题可提交至：<https://github.com/Shelus2021/PlaybackController/issues>

## English

Playback Control does not send browsing history, media URLs, page content, or usage statistics to Shelus2021 or to any developer-operated server. It contains no advertising, telemetry, or analytics SDK.

To find media, the extension processes network-request information inside the browser and temporarily records media URLs, source-page URLs, Referer values, page titles, media types, and sizes. Records from ordinary windows use browser `storage.local` and are removed on navigation, tab closure, or periodic cleanup. Whether the extension may run in private windows is controlled entirely by Firefox's extension permissions. Once allowed, private-window records remain in memory only and are never persisted.

When the user requests a preview or download, the extension connects directly to the third-party media server and may use existing credentials for that site and required Referer/Origin headers. This communication is between the user and that third-party site and is governed by the site's privacy policy.

Settings use `storage.sync`. If Firefox Sync is enabled, Firefox may synchronize those settings under Mozilla's policies. The extension does not read the clipboard; it writes a selected media link only after the user clicks the copy control.

Questions may be filed at <https://github.com/Shelus2021/PlaybackController/issues>.
