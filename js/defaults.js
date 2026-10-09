"use strict";

var PLAYBACK_DEFAULTS = {
  enabled: true,
  startHidden: false,
  rememberSpeed: false,
  forceLastSavedSpeed: false,
  audioBoolean: true,
  controllerOpacity: 0.5,
  siteEnabled: {},
  mediaRetrievalEnabled: false,
  mediaRetrievalSiteEnabled: {},
  keyBindings: [
    { action: "display", key: 72, value: 0, force: false, predefined: true },
    { action: "slower", key: 83, value: 0.1, force: false, predefined: true },
    { action: "faster", key: 87, value: 0.1, force: false, predefined: true },
    { action: "rewind", key: 65, value: 5, force: false, predefined: true },
    { action: "advance", key: 68, value: 5, force: false, predefined: true },
    { action: "reset", key: 82, value: 1, force: false, predefined: true },
    { action: "fast", key: 86, value: 1.5, force: false, predefined: true }
  ]
};

var MEDIA_RETRIEVAL_DEFAULTS = {
  Ext: [
    "flv", "hlv", "f4v", "mp4", "mp3", "wma", "wav", "m4a", "letv", "webm", "ogg", "ogv", "acc", "mov", "mkv", "m4s", "m3u8", "m3u", "mpeg", "avi", "wmv", "asf", "movie", "divx", "mpeg4", "vid", "aac", "mpd"
  ].map(function (ext) { return { ext: ext, size: 0, state: ext !== "m4s" }; }).concat([{ ext: "ts", size: 0, state: false }]),
  Type: [
    "audio/*", "video/*", "application/ogg", "application/vnd.apple.mpegurl", "application/x-mpegurl", "application/mpegurl", "application/octet-stream-m3u8", "application/dash+xml", "application/m4s"
  ].map(function (type) { return { type: type, size: 0, state: true }; })
};
