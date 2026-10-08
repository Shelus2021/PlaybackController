const OTHER_PAGE_LIMIT = 100;

chrome.alarms.create("nowClear", { when: Date.now() + 3000 });  // 3秒后清理立即清理一次
chrome.alarms.create("clear", { periodInMinutes: 60 }); // 60分钟清理一次冗余数据
chrome.alarms.onAlarm.addListener(function (alarm) {
    alarm.name == "clear" && clearRedundant();
    alarm.name == "nowClear" && clearRedundant();
});

// 保存Referer
chrome.webRequest.onSendHeaders.addListener(
    function (data) {
        let referer = getReferer(data);
        if (referer) {
            refererData["requestId" + data.requestId] = referer;
        }
    }, { urls: ["<all_urls>"] }, ['requestHeaders',
        chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS].filter(Boolean)
);
// onResponseStarted 浏览器接收到第一个字节触发，保证有更多信息判断资源类型
chrome.webRequest.onResponseStarted.addListener(
    function (data) {
        try {
            if (refererData["requestId" + data.requestId]) {
                data.referer = refererData["requestId" + data.requestId];
                delete refererData["requestId" + data.requestId];
            }
            findMedia(data);
        } catch (e) { console.log(e, data); }
    }, { urls: ["<all_urls>"] }, ["responseHeaders"]
);
// 删除失败的refererData
chrome.webRequest.onErrorOccurred.addListener(
    function (data) {
        delete refererData["requestId" + data.requestId];
    }, { urls: ["<all_urls>"] }
);

function findMedia(data, retryCount = 0) {
    // 等待后台配置和缓存初始化完成。
    if (!G || !G.initSyncComplete || G.tabId == undefined || cacheData.init) {
        if (retryCount < 5) setTimeout(() => findMedia(data, retryCount + 1), 233);
        return;
    }
    // 屏蔽特殊页面发起的资源
    if (data.initiator != "null" &&
        data.initiator != undefined &&
        isSpecialPage(data.initiator)) { return; }
    if (data.originUrl &&
        isSpecialPage(data.originUrl)) { return; }
    // 屏蔽特殊页面的资源
    if (isSpecialPage(data.url)) { return; }
    let urlParsing = new URL(data.url);
    // 去掉会导致同一 Google Video 资源重复出现的范围参数。
    if (urlParsing.host.includes("googlevideo.com")) {
        data.url = data.url.replace(reYoutube, "");
        urlParsing = new URL(data.url);
    }

    let [name, ext] = fileNameParse(urlParsing.pathname);

    const header = getResponseHeadersValue(data);
    // 通过视频范围计算完整视频大小
    if (header["range"]) {
        const size = header["range"].match(reRange);
        if (size) {
            header["size"] = parseInt(header["size"] * (size[3] / (size[2] - size[1])));
        }
    }

    //检查后缀
    let filter = false;
    if (!filter && ext != undefined) {
        filter = CheckExtension(ext, header["size"]);
        if (filter == "break") { return; }
    }

    //检查类型
    if (!filter && header["type"] != undefined) {
        filter = CheckType(header["type"], header["size"]);
        if (filter == "break") { return; }
    }

    //查找附件
    if (!filter && header["attachment"] != undefined) {
        const res = header["attachment"].match(reFilename);
        if (res && res[1]) {
            [name, ext] = fileNameParse(decodeURIComponent(res[1]));
            filter = CheckExtension(ext, 0);
            if (filter == "break") { return; }
        }
    }

    //放过类型为media的资源
    if (data.type == "media") {
        filter = true;
    }

    if (!filter) { return; }

    if (cacheData[data.tabId] == undefined) {
        cacheData[data.tabId] = [];
    }

    // 查重 避免CPU占用 大于500 强制开启
    if (cacheData[data.tabId].length <= 500) {
        const findId = data.tabId == -1 ? G.tabId : data.tabId;
        for (let item of (cacheData[findId] || [])) {
            if (item.url.length == data.url.length &&
                item.cacheURL.pathname == urlParsing.pathname &&
                item.cacheURL.host == urlParsing.host &&
                item.cacheURL.search == urlParsing.search) { return; }
        }
    }
    chrome.tabs.get(data.tabId == -1 ? G.tabId : data.tabId, async function (webInfo) {
        if (chrome.runtime.lastError) { return; }
        const sourceUrl = data.tabId == -1 ? (data.referer || data.initiator || webInfo?.url) : webInfo?.url;
        if (!mediaRetrievalEnabled(sourceUrl)) { return; }
        const info = {
            name: name,
            url: data.url,
            size: header["size"],
            ext: ext,
            type: data.mime ?? header["type"],
            tabId: data.tabId,
            initiator: data.initiator,
            referer: data.referer,
            cacheURL: { host: urlParsing.host, search: urlParsing.search, pathname: urlParsing.pathname },
            incognito: Boolean(data.incognito)
        };
        // 幽灵资源 查源
        if (info.tabId == -1 && info.referer) {
            if (webInfo?.url == info.referer) {
                info.tabId = webInfo.id;
            } else {
                const newWebInfo = await new Promise(resolve => {
                    chrome.tabs.query({ url: info.referer }, tabs => resolve(chrome.runtime.lastError ? [] : tabs));
                });
                if (newWebInfo.length > 0) {
                    webInfo = newWebInfo[0];
                    info.tabId = newWebInfo[0].id;
                }
            }
        }
        // 不存在 initiator 和 referer 使用web url代替initiator
        if (info.initiator == undefined || info.initiator == "null") {
            info.initiator = info.referer ?? webInfo?.url;
        }
        // 装载页面信息
        info.title = webInfo?.title ?? "NULL";
        // 发送到 popup
        chrome.runtime.sendMessage(info, function () {
            if (chrome.runtime.lastError) { return; }
        });
        // 储存数据
        if (cacheData[info.tabId] == undefined) {
            cacheData[info.tabId] = [];
        }
        cacheData[info.tabId].push(info);
        // 视频切片太多 频繁储存 严重影响性能
        // 当前标签媒体数量大于100 开启防抖 等待5秒储存 或 积累10个资源储存一次。
        if (cacheData[info.tabId].length >= 100 && debounceCount <= 10) {
            debounceCount++;
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                persistMediaData();
                refreshIcon(info.tabId);
            }, 5000);
        } else {
            clearTimeout(debounce);
            debounceCount = 0;
            persistMediaData();
            refreshIcon(info.tabId);
        }
    });
}

// 仅接收弹窗发出的当前标签清理请求。
chrome.runtime.onMessage.addListener(function (Message, _sender, sendResponse) {
    if (Message.Message == "getMediaData") {
        sendResponse({ ok: true, items: cacheData[Message.tabId] || [] });
        return false;
    }
    if (Message.Message == "clearData" && Message.type) {
        delete cacheData[Message.tabId];
        persistMediaData();
        SetIcon({ tabId: Message.tabId });
        clearRedundant();
        sendResponse("OK");
        return true;
    }
    return false;
});
//切换标签，更新全局变量G.tabId 更新图标
chrome.tabs.onActivated.addListener(function (activeInfo) {
    G.tabId = activeInfo.tabId;
    if (cacheData[G.tabId] !== undefined) {
        SetIcon({ number: cacheData[G.tabId].length, tabId: G.tabId });
        return;
    }
    SetIcon({ tabId: G.tabId });
});

// 标签更新 清除数据
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (changeInfo.status == "loading") {
        delete cacheData[tabId];
        persistMediaData();
        SetIcon({ tabId: tabId });
    }
});
// 标签关闭 清除数据
chrome.tabs.onRemoved.addListener(function (tabId) {
    // 清理缓存数据
    delete cacheData[tabId];
    persistMediaData();
    refererData = {};
});

//检查扩展名以及大小限制
function CheckExtension(ext, size) {
    const Ext = G.Ext.get(ext);
    if (!Ext) { return false; }
    if (!Ext.state) { return "break"; }
    if (Ext.size != 0 && size != undefined && size <= Ext.size * 1024) { return "break"; }
    return true;
}
//检查类型以及大小限制
function CheckType(dataType, dataSize) {
    for (let key in G.Type) {
        let TypeSplit = dataType.split("/");
        let OptionSplit = G.Type[key].type.split("/");
        if (OptionSplit[0] == TypeSplit[0] && (OptionSplit[1] == TypeSplit[1] || OptionSplit[1] == "*")) {
            if (G.Type[key].size != 0 && dataSize != undefined && dataSize <= G.Type[key].size * 1024) {
                return "break";
            }
            return G.Type[key].state ? true : "break";
        }
    }
    return false;
}

// 获取文件名 后缀
function fileNameParse(pathname) {
    let fileName = decodeURI(pathname.split("/").pop());
    let ext = fileName.split(".");
    ext = ext.length == 1 ? undefined : ext.pop().toLowerCase();
    return [fileName, ext ? ext : undefined];
}
//获取Header属性的值
function getResponseHeadersValue(data) {
    let header = {};
    if (data.responseHeaders == undefined || data.responseHeaders.length == 0) { return header; }
    for (let item of data.responseHeaders) {
        switch (item.name.toLowerCase()) {
            case "content-length": header["size"] = item.value; break;
            case "content-type": header["type"] = item.value.split(";")[0].toLowerCase(); break;
            case "content-disposition": header["attachment"] = item.value; break;
            case "content-range": header["range"] = item.value; break;
        }
    }
    return header;
}
function getReferer(data) {
    if (data.requestHeaders == undefined || data.requestHeaders.length == 0) { return false; }
    for (let item of data.requestHeaders) {
        if (item.name.toLowerCase() == "referer") {
            return item.value;
        }
    }
    return false;
}
function refreshIcon(tabId) {
    if (tabId != -1) {
        cacheData[tabId] && SetIcon({ number: cacheData[tabId].length, tabId: tabId });
    } else {
        SetIcon({ tips: true, number: cacheData[-1]?.length || 0 });
        //自动清理幽灵数据
        if (cacheData[-1] && cacheData[-1].length > OTHER_PAGE_LIMIT) {
            delete cacheData[-1];
            persistMediaData();
            SetIcon({ tips: false });
        }
    }
}
//设置扩展图标
function SetIcon(obj) {
    if (obj.tips != undefined) {
        chrome.action.setTitle({ title: obj.tips ? extensionMessage("browserTitleOther", obj.number || 0) : extensionMessage("browserTitleCurrent", 0) });
    } else if (obj.number == 0 || obj.number == undefined) {
        chrome.action.setTitle({ title: extensionMessage("browserTitleCurrent", 0), tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    } else {
        chrome.action.setTitle({ title: extensionMessage("browserTitleCurrent", obj.number), tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    }
}

function mediaRetrievalEnabled(url) {
    let host = "";
    try { host = new URL(url).hostname; } catch (e) { host = ""; }
    if (host && G.siteEnabled && Object.prototype.hasOwnProperty.call(G.siteEnabled, host)) {
        return Boolean(G.siteEnabled[host]);
    }
    return G.enabled !== false;
}

// 判断特殊页面
function isSpecialPage(url) {
    if (!url || url == "null") { return true; }
    return !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:"));
}

// 测试
// chrome.storage.local.get(function (data) { console.log(data.MediaData) });
// chrome.declarativeNetRequest.getSessionRules(function (rules) { console.log(rules); });
// chrome.tabs.query({}, function (tabs) { for (let item of tabs) { console.log(item.id); } });
