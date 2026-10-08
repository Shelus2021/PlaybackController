// 兼容Firefox的manifest V2
if (typeof (browser) == "object") {
    chrome.action = browser.browserAction;
}
