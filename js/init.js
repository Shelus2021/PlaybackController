// 全局变量
var G = {};
// 缓存数据
var cacheData = { init: true };
var refererData = {};
// 当前活动标签页。
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    G.tabId = tabs[0] && Number.isInteger(tabs[0].id) ? tabs[0].id : -1;
});
// 所有设置变量 默认值
G.OptionLists = {
    Ext: MEDIA_RETRIEVAL_DEFAULTS.Ext.map(item => ({ ...item })),
    Type: MEDIA_RETRIEVAL_DEFAULTS.Type.map(item => ({ ...item })),
    enabled: PLAYBACK_DEFAULTS.enabled,
    siteEnabled: { ...PLAYBACK_DEFAULTS.siteEnabled },
    mediaRetrievalEnabled: PLAYBACK_DEFAULTS.mediaRetrievalEnabled,
    mediaRetrievalSiteEnabled: { ...PLAYBACK_DEFAULTS.mediaRetrievalSiteEnabled }
};
G.initSyncComplete = false;

// Init
InitOptions();

// 正则预编译
const reFilename = /filename="?([^"]+)"?/;
const reRange = /([\d]+)-([\d]+)\/([\d]+)/;
const reYoutube = /&(range|rbuf|rn|cver|altitags|pot|fallback_count|sq)=[^&]*/g;

// 防抖
let debounce = undefined;
let debounceCount = 0;

// 初始变量
function InitOptions() {
    // 断开重新连接后 立刻把local里MediaData数据交给cacheData
    chrome.storage.local.get({ MediaData: {} }, function (items) {
        if (items.MediaData.init) {
            cacheData = {};
            return;
        }
        cacheData = items.MediaData;
    });
    // 读取sync配置数据 交给全局变量G
    chrome.storage.sync.get(G.OptionLists, function (items) {
        // Ext的Array转为Map类型
        items.Ext = new Map(items.Ext.map(item => [item.ext, item]));
        G = { ...items, ...G };
        G.initSyncComplete = true;
    });
}

// Private-window media stays in memory and is never written to storage.local.
function persistMediaData() {
    const persisted = {};
    for (const [tabId, items] of Object.entries(cacheData)) {
        if (!Array.isArray(items)) { continue; }
        const nonPrivateItems = items.filter(item => !item.incognito);
        if (nonPrivateItems.length) { persisted[tabId] = nonPrivateItems; }
    }
    chrome.storage.local.set({ MediaData: persisted });
}
// 监听变化，新值给全局变量
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace == "local" && changes.MediaData) {
        if (changes.MediaData.newValue?.init) { cacheData = {}; }
        return;
    }
    if (namespace != "sync") { return; }
    for (let [key, { newValue }] of Object.entries(changes)) {
        if (key == "Ext") {
            G.Ext = new Map(newValue.map(item => [item.ext, item]));
            continue;
        }
        G[key] = newValue;
    }
});
// 扩展升级，清空本地储存
chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason == "update") {
        chrome.storage.sync.remove(["BlockedExt", "enable", "youtube", "refreshClear", "checkDuplicates", "OtherAutoClear"]);
        chrome.storage.local.clear(function () {
            InitOptions();
        });
    }
});

// 清理冗余数据
function clearRedundant() {
    // console.log("clearRedundant");
    chrome.tabs.query({}, function (tabs) {
        let allTabId = [-1];    // 初始化一个-1 防止断开sw重连后 幽灵数据丢失
        for (let item of tabs) {
            allTabId.push(item.id);
        }
        if (!cacheData.init) {
            // 清理 缓存数据
            for (let key in cacheData) {
                if (!allTabId.includes(parseInt(key))) {
                    delete cacheData[key];
                }
            }
            persistMediaData();
        }
    });
    refererData = {};
}

