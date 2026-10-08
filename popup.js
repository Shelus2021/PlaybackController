"use strict";

const MIN_RATE = 0.07;
const MAX_RATE = 16;
const t = extensionMessage;
const ACTIONS = { display: t("actionDisplay"), slower: t("actionSlower"), faster: t("actionFaster"), rewind: t("actionRewind"), advance: t("actionAdvance"), reset: t("actionReset"), fast: t("actionFast") };
const FIXED = { display: 0, reset: 1 };
const DEFAULTS = PLAYBACK_DEFAULTS;
const CAPTURE_DEFAULTS = MEDIA_RETRIEVAL_DEFAULTS;

document.addEventListener("DOMContentLoaded", () => {
  localizeDocument();
  let settings;
  let currentHost = "";
  let currentTabId = -1;
  let captureItems = [];
  let captureSortMode = "default";
  let captureRules = { Ext: [], Type: [] };
  let hlsLoader;
  let statusResetTimer;
  const hlsDownloadStates = new Map();
  const hlsQualityOptions = new Map();
  const $ = (selector, root = document) => root.querySelector(selector);
  const cloneDefaults = () => ({ ...DEFAULTS, siteEnabled: { ...(DEFAULTS.siteEnabled || {}) }, keyBindings: DEFAULTS.keyBindings.map((item) => ({ ...item })) });
  const keyName = (code) => ({ 32: "Space", 37: "Left", 38: "Up", 39: "Right", 40: "Down" }[code] || (code ? String.fromCharCode(code) : ""));
  const siteIsEnabled = () => currentHost && Object.prototype.hasOwnProperty.call(settings.siteEnabled || {}, currentHost) ? Boolean(settings.siteEnabled[currentHost]) : Boolean(settings.enabled);
  const enabledLabel = (enabled) => t(enabled ? "statusEnabled" : "statusDisabled");
  const setStatus = (message, error = false, persistent = false) => {
    clearTimeout(statusResetTimer);
    const node = $("#status");
    node.textContent = message;
    node.classList.toggle("error", error);
    if (!persistent) statusResetTimer = setTimeout(() => siteStatus(), 500);
  };
  const siteStatus = () => setStatus(currentHost ? t("currentSiteStatus", enabledLabel(siteIsEnabled())) : enabledLabel(settings.enabled), false, true);

  function renderGeneral() {
    $("#enabled").checked = siteIsEnabled();
    ["startHidden", "rememberSpeed", "forceLastSavedSpeed", "audioBoolean"].forEach((id) => { $("#" + id).checked = Boolean(settings[id]); });
    const opacity = Number(settings.controllerOpacity); $("#controllerOpacity").value = Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 ? opacity : 0.5;
  }
  function renderCapture() {
    if (!siteIsEnabled()) {
      captureItems = [];
      renderCaptureList();
      $("#captureCardSummary").textContent = t("captureStopped");
      return;
    }
    chrome.runtime.sendMessage({ Message: "getMediaData", tabId: currentTabId }, (response) => {
      if (chrome.runtime.lastError) captureItems = [];
      else captureItems = response && Array.isArray(response.items) ? response.items : [];
      renderCaptureList();
    });
  }
  function captureFileName(item, index) {
    let name = item.name || "";
    if (!name && item.url) {
      try { name = decodeURIComponent(new URL(item.url).pathname.split("/").pop()); } catch (_) {}
    }
    if (!name) name = "media-" + (index + 1);
    if (item.ext && !name.toLowerCase().endsWith("." + String(item.ext).toLowerCase())) {
      name += "." + item.ext;
    }
    return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
  }
  function captureSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return t("unknownSize");
    if (bytes < 1024) return Math.round(bytes) + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  }
  function captureFormat(item) {
    let format = String(item && item.ext || "").trim().replace(/^\./, "");
    if (!format && item && item.url) {
      try {
        const name = new URL(item.url).pathname.split("/").pop() || "";
        const match = name.match(/\.([a-z0-9]{1,10})$/i);
        if (match) format = match[1];
      } catch (_) {}
    }
    if (!format && item && item.type) {
      const subtype = String(item.type).split("/")[1];
      if (subtype) format = subtype.split(/[;+]/)[0];
    }
    return format && format.toLowerCase() !== "octet-stream" ? format.toUpperCase() : t("unknownFormat");
  }
  function isHlsItem(item) {
    const ext = String(item && item.ext || "").toLowerCase();
    const type = String(item && item.type || "").toLowerCase();
    const url = String(item && item.url || "");
    return ext === "m3u8" || /(?:^|[.\/])m3u8(?:$|[?#])/i.test(url) || type.includes("mpegurl") || type.includes("m3u8");
  }
  function renderHlsDownloadPanel(panel, item) {
    panel.textContent = "";
    const statusPanel = $(".capture-download-status-panel", panel.parentElement);
    if (statusPanel) statusPanel.textContent = "";
    const state = hlsDownloadStates.get(item.url);
    const variants = hlsQualityOptions.get(item.url);
    if (statusPanel && state && state.message) {
      const status = document.createElement("span");
      status.className = "capture-download-status" + (state.state === "error" ? " error" : "");
      status.textContent = state.message;
      statusPanel.appendChild(status);
    }
    if (!variants || !variants.length) return;
    const choices = document.createElement("div");
    choices.className = "capture-quality-list";
    variants.forEach((variant, qualityIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "capture-quality";
      button.dataset.hlsQuality = qualityIndex;
      button.textContent = variant.label;
      button.title = variant.supported ? t(variant.direct ? "downloadFile" : "downloadQuality") : variant.reason;
      button.disabled = !variant.supported;
      choices.appendChild(button);
    });
    panel.appendChild(choices);
  }
  function refreshHlsDownloadPanels(sourceUrl) {
    document.querySelectorAll(".capture-item").forEach(details => {
      const index = Number(details.dataset.index);
      const item = captureItems[index];
      if (!item || item.url !== sourceUrl) return;
      const panel = $(".capture-download-panel", details);
      if (panel) renderHlsDownloadPanel(panel, item);
    });
  }
  function setHlsDownloadState(sourceUrl, state, open = false) {
    if (state) hlsDownloadStates.set(sourceUrl, state); else hlsDownloadStates.delete(sourceUrl);
    refreshHlsDownloadPanels(sourceUrl);
    if (open) {
      document.querySelectorAll(".capture-item").forEach(details => {
        const item = captureItems[Number(details.dataset.index)];
        if (item && item.url === sourceUrl) details.open = true;
      });
    }
  }
  function sendRuntimeMessage(message, callback) {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      callback(error ? { ok: false, error: error.message } : (response || { ok: false, error: t("noBackgroundResponse") }));
    });
  }
  function updateCaptureSummary(visibleCount, query = "") {
    $("#captureCardSummary").textContent = captureItems.length
      ? t(query ? "captureSummaryFiltered" : "captureSummary", query ? [captureItems.length, visibleCount] : captureItems.length)
      : t("noMediaFound");
  }
  function createCaptureItem(item, index) {
    const details = document.createElement("details");
    details.className = "capture-item";
    details.dataset.index = index;
    const summary = document.createElement("summary");
    const name = document.createElement("button");
    name.type = "button";
    name.className = "capture-name";
    name.textContent = captureFileName(item, index);
    name.title = String(item.url || "");
    const size = document.createElement("span");
    size.className = "capture-size";
    size.textContent = captureSize(item.size);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "capture-copy";
    copy.title = t("copyLinkTitle");
    copy.setAttribute("aria-label", t("copyLinkTitle"));
    copy.disabled = !item.url;
    summary.append(name, size, copy);
    const detail = document.createElement("div");
    detail.className = "capture-detail";
    const url = document.createElement("a");
    url.className = "capture-url";
    url.href = String(item.url || "");
    url.target = "_blank";
    url.rel = "noopener";
    url.textContent = url.href;
    url.title = url.textContent;
    detail.appendChild(url);
    const statusPanel = document.createElement("div");
    statusPanel.className = "capture-download-status-panel";
    detail.appendChild(statusPanel);
    const downloadPanel = document.createElement("div");
    downloadPanel.className = "capture-download-panel";
    detail.appendChild(downloadPanel);
    details.append(summary, detail);
    renderHlsDownloadPanel(downloadPanel, item);
    return details;
  }
  function disposeCapturePreviews(root) {
    root.querySelectorAll(".capture-item").forEach(details => {
      if (details._captureHls) details._captureHls.destroy();
      const preview = $(".capture-preview", details);
      if (preview && typeof preview.pause === "function") preview.pause();
    });
  }
  function renderCaptureList() {
    const root = $("#captureList");
    const query = $("#captureFilter").value.trim().toLowerCase();
    const fragment = document.createDocumentFragment();
    disposeCapturePreviews(root);
    root.textContent = "";
    const visible = captureItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const text = [item.name, item.title, item.ext, item.type, item.url].filter(Boolean).join(" ").toLowerCase();
        return !query || text.includes(query);
      });
    if (captureSortMode === "name") {
      visible.sort((a, b) => captureFileName(a.item, a.index).localeCompare(captureFileName(b.item, b.index), chrome.i18n.getUILanguage(), { numeric: true, sensitivity: "base" }) || a.index - b.index);
    } else if (captureSortMode === "size") {
      visible.sort((a, b) => (Number(b.item.size) || -1) - (Number(a.item.size) || -1) || a.index - b.index);
    }
    updateCaptureSummary(visible.length, query);
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "capture-empty";
      empty.textContent = t(query && captureItems.length ? "noMatchingMedia" : "playMediaHint");
      root.appendChild(empty);
      return;
    }
    visible.forEach(({ item, index }) => {
      const details = createCaptureItem(item, index);
      fragment.appendChild(details);
    });
    root.appendChild(fragment);
  }
  function loadHlsLibrary() {
    if (typeof Hls !== "undefined") return Promise.resolve(Hls);
    if (hlsLoader) return hlsLoader;
    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "lib/hls.min.js";
      script.onload = () => typeof Hls !== "undefined" ? resolve(Hls) : reject(new Error(t("hlsLibraryFailed")));
      script.onerror = () => reject(new Error(t("hlsLibraryFailed")));
      document.head.appendChild(script);
    });
    return hlsLoader;
  }
  function showPreviewError(detail, message) {
    if (detail.querySelector(".capture-preview-error")) return;
    const node = document.createElement("span");
    node.className = "capture-preview-error";
    node.textContent = message;
    detail.appendChild(node);
  }
  function mountCapturePreview(details) {
    const detail = $(".capture-detail", details);
    if (!detail || detail.querySelector(".capture-preview")) return;
    const item = captureItems[Number(details.dataset.index)];
    if (!item || !item.url) return;
    const type = String(item.type || "").toLowerCase();
    const ext = String(item.ext || "").toLowerCase();
    const isHls = isHlsItem(item);
    let preview;
    if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
      preview = document.createElement("img");
      preview.alt = captureFileName(item, Number(details.dataset.index));
    } else if (type.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "wma"].includes(ext)) {
      preview = document.createElement("audio");
      preview.controls = true;
      preview.preload = "metadata";
    } else {
      preview = document.createElement("video");
      preview.controls = true;
      preview.preload = "metadata";
    }
    preview.className = "capture-preview";
    detail.insertBefore(preview, $(".capture-download-panel", detail));
    if (!isHls || !(preview instanceof HTMLVideoElement)) return void (preview.src = item.url);
    if (preview.canPlayType("application/vnd.apple.mpegurl")) return void (preview.src = item.url);
    loadHlsLibrary().then((HlsClass) => {
      if (!details.isConnected || !HlsClass.isSupported()) {
        showPreviewError(detail, t("hlsUnsupported"));
        return;
      }
      const hls = new HlsClass({ enableWorker: false });
      details._captureHls = hls;
      hls.loadSource(item.url);
      hls.attachMedia(preview);
      hls.on(HlsClass.Events.ERROR, (_event, data) => {
        if (data && data.fatal) showPreviewError(detail, t("hlsPreviewFailed"));
      });
    }).catch((error) => showPreviewError(detail, error.message));
  }
  function cloneCaptureDefaults() {
    return {
      Ext: CAPTURE_DEFAULTS.Ext.map((item) => ({ ...item })),
      Type: CAPTURE_DEFAULTS.Type.map((item) => ({ ...item }))
    };
  }
  function setCaptureRulesStatus(message, error = false) {
    if (message) setStatus(message, error);
  }
  function createRuleRow(kind, item = {}) {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.dataset.kind = kind;
    const state = document.createElement("input");
    state.type = "checkbox";
    state.className = "rule-state";
    state.checked = item.state !== false;
    const value = document.createElement("input");
    value.type = "text";
    value.className = "rule-value";
    value.placeholder = kind === "Ext" ? "mp4" : "video/*";
    value.value = String(kind === "Ext" ? (item.ext || "") : (item.type || ""));
    const size = document.createElement("input");
    size.type = "number";
    size.className = "rule-size";
    size.min = "0";
    size.step = "1";
    size.placeholder = "0";
    size.value = Number(item.size) > 0 ? String(item.size) : "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-remove";
    remove.title = t("delete");
    remove.textContent = "×";
    row.append(state, value, size, remove);
    return row;
  }
  function renderRuleRows(kind) {
    const root = $(kind === "Ext" ? "#extensionRules" : "#typeRules");
    root.textContent = "";
    const fragment = document.createDocumentFragment();
    captureRules[kind].forEach((item) => fragment.appendChild(createRuleRow(kind, item)));
    root.appendChild(fragment);
  }
  function renderCaptureRules() {
    chrome.storage.sync.get(CAPTURE_DEFAULTS, (items) => {
      const defaults = cloneCaptureDefaults();
      captureRules = {
        Ext: Array.isArray(items.Ext) ? items.Ext.map((item) => ({ ...item })) : defaults.Ext,
        Type: Array.isArray(items.Type) ? items.Type.map((item) => ({ ...item })) : defaults.Type
      };
      renderRuleRows("Ext");
      renderRuleRows("Type");
      setCaptureRulesStatus("");
    });
  }
  function readRuleRows(kind) {
    const root = $(kind === "Ext" ? "#extensionRules" : "#typeRules");
    const rows = [];
    root.querySelectorAll(".rule-row").forEach((row) => {
      const value = $(".rule-value", row).value.trim().toLowerCase();
      if (!value) return;
      const sizeText = $(".rule-size", row).value.trim();
      const size = sizeText === "" ? 0 : Number(sizeText);
      if (!Number.isFinite(size) || size < 0) throw new Error(t("minimumSizeError"));
      if (kind === "Type" && !/^[^\s/]+\/[^\s/]+$/.test(value)) throw new Error(t("mediaTypeFormatError"));
      rows.push(kind === "Ext"
        ? { ext: value.replace(/^\./, ""), size, state: $(".rule-state", row).checked }
        : { type: value, size, state: $(".rule-state", row).checked });
    });
    return rows;
  }
  function updateValueState(row) { const action = $(".action", row).value; const fixed = Object.prototype.hasOwnProperty.call(FIXED, action); $(".value", row).disabled = fixed; if (fixed) $(".value", row).value = FIXED[action]; }
  function renderShortcuts() {
    const root = $("#shortcutRows"); const fragment = document.createDocumentFragment(); root.textContent = "";
    settings.keyBindings.forEach((item, index) => {
      const row = document.createElement("div"); row.className = "shortcut-row"; row.dataset.index = index;
      const action = document.createElement("select"); action.className = "action";
      Object.entries(ACTIONS).forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; action.appendChild(option); });
      const keyInput = document.createElement("input"); keyInput.className = "key"; keyInput.type = "text"; keyInput.placeholder = t("keyPlaceholder");
      const value = document.createElement("input"); value.className = "value"; value.type = "number"; value.step = "0.01";
      const forceLabel = document.createElement("label"); forceLabel.className = "force-label";
      const force = document.createElement("input"); force.className = "force"; force.type = "checkbox"; forceLabel.append(force, document.createTextNode(" " + t("exclusive")));
      const remove = document.createElement("button"); remove.className = "remove"; remove.type = "button"; remove.title = t("delete"); remove.textContent = "×";
      row.append(action, keyInput, value, forceLabel, remove);
      $(".action", row).value = item.action; const key = $(".key", row); key.dataset.code = Number.isInteger(item.key) && item.key > 0 ? item.key : ""; key.value = keyName(item.key);
      $(".value", row).value = item.value ?? ""; $(".force", row).checked = item.force === true || item.force === "true"; updateValueState(row); fragment.appendChild(row);
    });
    root.appendChild(fragment);
  }
  function readShortcuts() {
    const result = []; let valid = true;
    document.querySelectorAll(".shortcut-row").forEach((row) => { const action = $(".action", row).value; const key = Number($(".key", row).dataset.code); const input = $(".value", row); const fixed = Object.prototype.hasOwnProperty.call(FIXED, action); const value = fixed ? FIXED[action] : Number(input.value); if (Number.isInteger(key) && key > 0 && ((!fixed && (!Number.isFinite(value) || value <= 0)) || (action === "fast" && (value < MIN_RATE || value > MAX_RATE)))) valid = false; result.push({ action, key: Number.isInteger(key) && key > 0 ? key : null, value: Number.isFinite(value) ? value : 0, force: $(".force", row).checked, predefined: false }); });
    if (!valid) throw new Error(t("invalidShortcut")); return result;
  }
  function save(patch, message, complete) {
    settings = { ...settings, ...patch };
    setStatus(message);
    chrome.storage.local.set(settings);
    chrome.storage.sync.set(patch, () => {
      if (chrome.runtime.lastError) return setStatus(t("saveFailed", chrome.runtime.lastError.message), true);
      if (typeof complete === "function") complete();
    });
  }
  function applyPlaybackStateToCapture(enabled) {
    if (enabled) {
      $("#captureCardSummary").textContent = t("reloadingPage");
      if (currentTabId >= 0) chrome.tabs.reload(currentTabId);
      return;
    }
    captureItems = [];
    renderCaptureList();
    $("#captureCardSummary").textContent = t("captureStopped");
    if (currentTabId >= 0) {
      chrome.runtime.sendMessage({ Message: "clearData", type: true, tabId: currentTabId }, () => void chrome.runtime.lastError);
    }
  }

  // Paint the popup immediately; sync storage can take a noticeable amount of time.
  settings = cloneDefaults();
  renderGeneral();
  renderShortcuts();
  setStatus(t("statusEnabled"));
  function openPage(panelId) {
    const panel = $("#" + panelId);
    if (!panel) return;
    $("#mainMenu").classList.add("hidden");
    document.querySelectorAll(".subpage").forEach((page) => page.classList.toggle("hidden", page !== panel));
    $(".content").scrollTop = 0;
    if (panelId === "capturePanel") renderCapture();
    if (panelId === "captureRulesPanel") renderCaptureRules();
  }
  function openMainMenu() {
    document.querySelectorAll(".subpage").forEach((page) => page.classList.add("hidden"));
    $("#mainMenu").classList.remove("hidden");
    $(".content").scrollTop = 0;
    document.querySelectorAll("#captureList audio, #captureList video").forEach((media) => media.pause());
  }
  document.addEventListener("click", (event) => {
    const entry = event.target.closest("[data-page]");
    if (entry) {
      event.preventDefault();
      openPage(entry.dataset.page);
      return;
    }
    if (event.target.closest("[data-back]")) {
      event.preventDefault();
      openMainMenu();
      return;
    }
    if (event.target.closest(".remove")) { event.target.closest(".shortcut-row").remove(); }
  });
  $("#enabled").addEventListener("change", () => {
    const enabled = $("#enabled").checked;
    if (!currentHost) return save({ enabled }, enabledLabel(enabled), () => applyPlaybackStateToCapture(enabled));
    const siteEnabled = { ...(settings.siteEnabled || {}), [currentHost]: enabled };
    save({ siteEnabled }, t("currentSiteStatus", enabledLabel(enabled)), () => applyPlaybackStateToCapture(enabled));
  });
  $("#saveGeneral").addEventListener("click", () => { const opacity = Number($("#controllerOpacity").value); if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return setStatus(t("opacityError"), true); save({ startHidden: $("#startHidden").checked, rememberSpeed: $("#rememberSpeed").checked, forceLastSavedSpeed: $("#forceLastSavedSpeed").checked, audioBoolean: $("#audioBoolean").checked, controllerOpacity: opacity }, t("playbackSaved")); });
  $("#saveShortcuts").addEventListener("click", () => { try { save({ keyBindings: readShortcuts() }, t("shortcutsSaved")); } catch (error) { setStatus(error.message, true); } });
  $("#resetShortcuts").addEventListener("click", () => { const keyBindings = cloneDefaults().keyBindings; settings.keyBindings = keyBindings; renderShortcuts(); save({ keyBindings }, t("shortcutsReset")); });
  $("#resetGeneral").addEventListener("click", () => { const defaults = cloneDefaults(); const patch = { startHidden: defaults.startHidden, rememberSpeed: defaults.rememberSpeed, forceLastSavedSpeed: defaults.forceLastSavedSpeed, audioBoolean: defaults.audioBoolean, controllerOpacity: defaults.controllerOpacity }; settings = { ...settings, ...patch }; renderGeneral(); save(patch, t("playbackReset")); });
  $("#captureFilter").addEventListener("input", renderCaptureList);
  $("#captureSort").addEventListener("click", () => {
    const nextMode = { default: "name", name: "size", size: "default" };
    const labels = { default: t("sortDefault"), name: t("sortName"), size: t("sortSize") };
    captureSortMode = nextMode[captureSortMode];
    $("#captureSort").textContent = labels[captureSortMode];
    $("#captureSort").title = t("sortTitle", labels[captureSortMode]);
    renderCaptureList();
  });
  function startHlsDownload(item, playlistUrl, index, audioUrl = "") {
    hlsQualityOptions.delete(item.url);
    setHlsDownloadState(item.url, { state: "starting", message: t("creatingFullDownload") }, true);
    sendRuntimeMessage({
      Message: "startHlsDownload",
      sourceUrl: item.url,
      url: playlistUrl,
      audioUrl,
      referer: item.referer || item.initiator || "",
      fileName: captureFileName(item, index)
    }, response => {
      if (!response.ok) {
        setHlsDownloadState(item.url, { state: "error", message: t("downloadFailed", response.error) }, true);
        return;
      }
      setHlsDownloadState(item.url, { state: "loading", jobId: response.jobId, message: t("readingPlaylist") }, true);
    });
  }
  function prepareHlsDownload(item, index) {
    const cached = hlsQualityOptions.get(item.url);
    if (cached && cached.length) {
      setHlsDownloadState(item.url, { state: "choice", message: t("chooseDownload") }, true);
      return;
    }
    setHlsDownloadState(item.url, { state: "probing", message: t("readingQualities") }, true);
    sendRuntimeMessage({ Message: "probeHls", url: item.url, referer: item.referer || item.initiator || "" }, response => {
      if (!response.ok) {
        setHlsDownloadState(item.url, { state: "error", message: t("qualityReadFailed", response.error) }, true);
        return;
      }
      if (!response.variants || !response.variants.length) return setHlsDownloadState(item.url, { state: "error", message: t("noDownloadOptions") }, true);
      hlsQualityOptions.set(item.url, response.variants);
      const usable = response.variants.some(variant => variant.supported);
      setHlsDownloadState(item.url, {
        state: usable ? "choice" : "error",
        message: usable ? t("chooseDownload") : (response.variants[0].reason || t("noDownloadQuality"))
      }, true);
    });
  }
  function prepareDirectDownload(item) {
    hlsQualityOptions.set(item.url, [{
      direct: true,
      supported: true,
      url: item.url,
      label: captureFormat(item) + " · " + captureSize(item.size)
    }]);
    setHlsDownloadState(item.url, { state: "choice", message: t("chooseDownload") }, true);
  }
  function startDirectDownload(item, index) {
    hlsQualityOptions.delete(item.url);
    setHlsDownloadState(item.url, { state: "starting", message: t("creatingDownload") }, true);
    const downloadOptions = {
      url: item.url,
      filename: captureFileName(item, index),
      saveAs: false
    };
    const referer = String(item.referer || item.initiator || "");
    if (/^https?:\/\//i.test(referer)) {
      downloadOptions.headers = [{ name: "Referer", value: referer }];
    }
    chrome.downloads.download(downloadOptions, () => {
      const error = chrome.runtime.lastError;
      const message = error
        ? t("downloadFailed", error.message)
        : t(downloadOptions.headers ? "downloadWithReferer" : "downloadStarted");
      setHlsDownloadState(item.url, { state: error ? "error" : "complete", message }, true);
      setStatus(message, Boolean(error));
    });
  }
  function prepareItemDownload(item, index) {
    const state = hlsDownloadStates.get(item.url);
    if (state && ["probing", "starting", "loading", "downloading", "saving", "cancelling"].includes(state.state)) return;
    if (isHlsItem(item)) prepareHlsDownload(item, index);
    else prepareDirectDownload(item);
  }
  async function copyCaptureUrl(url) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(url);
      return;
    }
    const input = document.createElement("textarea");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    let copied = false;
    try {
      input.select();
      copied = document.execCommand("copy");
    } finally {
      input.remove();
    }
    if (!copied) throw new Error("copy failed");
  }
  $("#captureList").addEventListener("click", (event) => {
    const copy = event.target.closest(".capture-copy");
    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      const details = copy.closest(".capture-item");
      const item = details && captureItems[Number(details.dataset.index)];
      if (!item || !item.url) return;
      copyCaptureUrl(String(item.url)).then(() => {
        setStatus(t("linkCopied"));
      }).catch(() => {
        setStatus(t("copyFailed"), true);
      });
      return;
    }
    const quality = event.target.closest("[data-hls-quality]");
    if (quality) {
      event.preventDefault();
      event.stopPropagation();
      const details = quality.closest(".capture-item");
      const index = Number(details.dataset.index);
      const item = captureItems[index];
      const variants = item && hlsQualityOptions.get(item.url);
      const variant = variants && variants[Number(quality.dataset.hlsQuality)];
      if (item && variant && variant.supported) {
        if (variant.direct) startDirectDownload(item, index);
        else startHlsDownload(item, variant.url, index, variant.audioUrl || "");
      }
      return;
    }
    const summary = event.target.closest(".capture-item > summary");
    if (summary) {
      event.preventDefault();
      const name = event.target.closest(".capture-name");
      if (name) summary.parentElement.open = !summary.parentElement.open;
    }
  });
  $("#captureList").addEventListener("toggle", (event) => {
    if (!event.target.matches(".capture-item")) return;
    if (event.target.open) {
      const index = Number(event.target.dataset.index);
      const item = captureItems[index];
      if (item && item.url) prepareItemDownload(item, index);
      mountCapturePreview(event.target);
      return;
    }
    const preview = $(".capture-preview", event.target);
    if (preview && typeof preview.pause === "function") preview.pause();
  }, true);
  $("#captureRulesPanel").addEventListener("click", (event) => {
    const remove = event.target.closest(".rule-remove");
    if (remove) {
      remove.closest(".rule-row").remove();
      setCaptureRulesStatus(t("notSaved"));
      return;
    }
    const add = event.target.closest("[data-add-rule]");
    if (!add) return;
    const kind = add.dataset.addRule;
    const root = $(kind === "Ext" ? "#extensionRules" : "#typeRules");
    root.appendChild(createRuleRow(kind));
    root.scrollTop = root.scrollHeight;
    setCaptureRulesStatus(t("notSaved"));
  });
  $("#saveCaptureRules").addEventListener("click", () => {
    try {
      const Ext = readRuleRows("Ext");
      const Type = readRuleRows("Type");
      chrome.storage.sync.set({ Ext, Type }, () => {
        if (chrome.runtime.lastError) return setCaptureRulesStatus(t("saveFailed", chrome.runtime.lastError.message), true);
        captureRules = { Ext, Type };
        setCaptureRulesStatus(t("captureRulesSaved"));
      });
    } catch (error) {
      setCaptureRulesStatus(error.message, true);
    }
  });
  $("#resetCaptureRules").addEventListener("click", () => {
    captureRules = cloneCaptureDefaults();
    renderRuleRows("Ext");
    renderRuleRows("Type");
    chrome.storage.sync.set({ Ext: captureRules.Ext, Type: captureRules.Type }, () => {
      setCaptureRulesStatus(chrome.runtime.lastError ? t("restoreFailed", chrome.runtime.lastError.message) : t("captureRulesReset"), Boolean(chrome.runtime.lastError));
    });
  });
  $("#addShortcut").addEventListener("click", () => { settings.keyBindings.push({ action: "faster", key: null, value: 0.1, force: false }); renderShortcuts(); });
  $("#shortcutRows").addEventListener("change", (event) => { const row = event.target.closest(".shortcut-row"); if (row && event.target.classList.contains("action")) updateValueState(row); });
  $("#shortcutRows").addEventListener("keydown", (event) => { if (!event.target.classList.contains("key")) return; event.preventDefault(); if (["Backspace", "Delete", "Escape"].includes(event.key)) { event.target.value = ""; event.target.dataset.code = ""; return; } const code = event.keyCode || event.which; if (code) { event.target.dataset.code = code; event.target.value = keyName(code); } });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    currentTabId = tabs[0] && Number.isInteger(tabs[0].id) ? tabs[0].id : -1;
    try { currentHost = new URL(tabs[0].url).hostname; } catch (_) { currentHost = ""; }
    renderGeneral();
    renderCapture();
    siteStatus();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.Message === "hlsDownloadProgress" && message.sourceUrl) {
      const previous = hlsDownloadStates.get(message.sourceUrl) || {};
      const next = { ...previous, state: message.state, jobId: message.jobId, message: message.message || "" };
      setHlsDownloadState(message.sourceUrl, next, false);
      if (message.state === "complete") setStatus(message.message || t("completeMp4Started"));
      if (message.state === "error") setStatus(message.message || t("m3u8DownloadFailed"), true);
      return;
    }
    if (!message || message.tabId !== currentTabId || !message.url || !siteIsEnabled()) return;
    if (captureItems.some((item) => item.url === message.url)) return;
    const index = captureItems.length;
    captureItems.push(message);
    const query = $("#captureFilter").value.trim().toLowerCase();
    if (captureSortMode === "default" && !query) {
      const root = $("#captureList");
      const empty = $(".capture-empty", root);
      if (empty) empty.remove();
      root.appendChild(createCaptureItem(message, index));
      updateCaptureSummary(captureItems.length);
      return;
    }
    renderCaptureList();
  });
  const normalizeKeyBindings = (bindings) => {
    const defaults = cloneDefaults().keyBindings;
    const normalized = Array.isArray(bindings) && bindings.length ? bindings.map((item) => ({ ...item })) : defaults;
    if (!normalized.some((item) => item.action === "display")) {
      normalized.unshift({ ...defaults.find((item) => item.action === "display") });
    }
    return normalized;
  };
  const applyStored = (stored) => {
    settings = { ...cloneDefaults(), ...stored, keyBindings: normalizeKeyBindings(stored.keyBindings) };
    renderGeneral();
    renderShortcuts();
    renderCapture();
    siteStatus();
  };
  chrome.storage.local.get(DEFAULTS, (cached) => {
    if (!chrome.runtime.lastError && cached && cached.keyBindings) applyStored(cached);
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      if (chrome.runtime.lastError) { if (!cached || !cached.keyBindings) setStatus(enabledLabel(settings.enabled)); return; }
      const missingDisplay = !Array.isArray(stored.keyBindings) || !stored.keyBindings.some((item) => item.action === "display");
      if (missingDisplay) {
        stored.keyBindings = normalizeKeyBindings(stored.keyBindings);
        chrome.storage.sync.set({ keyBindings: stored.keyBindings });
      }
      applyStored(stored);
      chrome.storage.local.set(stored);
    });
  });
});
