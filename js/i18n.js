"use strict";

function extensionMessage(key, substitutions, fallback) {
  try {
    const values = Array.isArray(substitutions)
      ? substitutions.map(String)
      : (substitutions === undefined || substitutions === null ? undefined : String(substitutions));
    const value = chrome.i18n.getMessage(key, values);
    if (value) return value;
  } catch (_) {}
  return fallback || key;
}

function localizeDocument(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = extensionMessage(node.dataset.i18n, null, node.textContent);
  });
  [["data-i18n-title", "title"], ["data-i18n-placeholder", "placeholder"], ["data-i18n-aria-label", "aria-label"], ["data-i18n-alt", "alt"]].forEach(([dataName, attribute]) => {
    scope.querySelectorAll("[" + dataName + "]").forEach((node) => {
      const key = node.getAttribute(dataName);
      node.setAttribute(attribute, extensionMessage(key, null, node.getAttribute(attribute)));
    });
  });
  const title = scope.querySelector && scope.querySelector("title[data-i18n]");
  if (title) document.title = title.textContent;
  document.documentElement.lang = /^zh\b/i.test(chrome.i18n.getUILanguage()) ? "zh-CN" : "en";
}
