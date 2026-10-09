var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var tc = {
  settings: {
    lastSpeed: 1.0, // default 1x
    enabled: PLAYBACK_DEFAULTS.enabled,
    speeds: {}, // empty object to hold speed for each source

    displayKeyCode: 72, // default: H
    rememberSpeed: PLAYBACK_DEFAULTS.rememberSpeed,
    forceLastSavedSpeed: PLAYBACK_DEFAULTS.forceLastSavedSpeed,
    audioBoolean: PLAYBACK_DEFAULTS.audioBoolean,
    startHidden: PLAYBACK_DEFAULTS.startHidden,
    controllerOpacity: PLAYBACK_DEFAULTS.controllerOpacity,
    keyBindings: [],
    siteEnabled: Object.assign({}, PLAYBACK_DEFAULTS.siteEnabled),
    blacklist: `\
      www.instagram.com
      twitter.com
      vine.co
      imgur.com
      teams.microsoft.com
    `.replace(regStrip, ""),
    defaultLogLevel: 4,
    logLevel: 3
  },

  // Holds a reference to all of the AUDIO/VIDEO DOM elements we've attached to
  mediaElements: [],

  // The media element most recently played or directly interacted with. Keyboard
  // shortcuts use this instead of changing every media element on the page.
  activeMedia: null
};

/* Log levels (depends on caller specifying the correct level)
  1 - none
  2 - error
  3 - warning
  4 - info
  5 - debug
  6 - debug high verbosity + stack trace on each message
*/
function log(message, level) {
  verbosity = tc.settings.logLevel;
  if (typeof level === "undefined") {
    level = tc.settings.defaultLogLevel;
  }
  if (verbosity >= level) {
    if (level === 2) {
      console.log("ERROR:" + message);
    } else if (level === 3) {
      console.log("WARNING:" + message);
    } else if (level === 4) {
      console.log("INFO:" + message);
    } else if (level === 5) {
      console.log("DEBUG:" + message);
    } else if (level === 6) {
      console.log("DEBUG (VERBOSE):" + message);
      console.trace();
    }
  }
}

chrome.storage.sync.get(tc.settings, function (storage) {
  // A storage failure must not prevent the content script from starting.
  storage = Object.assign({}, tc.settings, storage || {});
  tc.settings.keyBindings = Array.isArray(storage.keyBindings)
    ? storage.keyBindings
    : [];
  if (tc.settings.keyBindings.length == 0) {
    tc.settings.keyBindings = PLAYBACK_DEFAULTS.keyBindings.map(function (item) {
      return Object.assign({}, item);
    });
    const legacyKeys = {
      display: Number(storage.displayKeyCode),
      slower: Number(storage.slowerKeyCode),
      faster: Number(storage.fasterKeyCode),
      rewind: Number(storage.rewindKeyCode),
      advance: Number(storage.advanceKeyCode),
      reset: Number(storage.resetKeyCode),
      fast: Number(storage.fastKeyCode)
    };
    tc.settings.keyBindings.forEach(function (item) {
      if (legacyKeys[item.action] > 0) item.key = legacyKeys[item.action];
    });
    const legacyValues = {
      slower: Number(storage.speedStep),
      faster: Number(storage.speedStep),
      rewind: Number(storage.rewindTime),
      advance: Number(storage.advanceTime),
      fast: Number(storage.fastSpeed)
    };
    tc.settings.keyBindings.forEach(function (item) {
      if (legacyValues[item.action] > 0) item.value = legacyValues[item.action];
    });

    chrome.storage.sync.set({
      keyBindings: tc.settings.keyBindings,
      displayKeyCode: tc.settings.displayKeyCode,
      rememberSpeed: tc.settings.rememberSpeed,
      forceLastSavedSpeed: tc.settings.forceLastSavedSpeed,
      audioBoolean: tc.settings.audioBoolean,
      startHidden: tc.settings.startHidden,
      enabled: tc.settings.enabled,
      controllerOpacity: tc.settings.controllerOpacity,
      blacklist: tc.settings.blacklist.replace(regStrip, ""),
      siteEnabled: tc.settings.siteEnabled
    });
  }
  tc.settings.lastSpeed = Number(storage.lastSpeed);
  tc.settings.displayKeyCode = Number(storage.displayKeyCode);
  tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
  tc.settings.forceLastSavedSpeed = Boolean(storage.forceLastSavedSpeed);
  tc.settings.audioBoolean = Boolean(storage.audioBoolean);
  tc.settings.enabled = Boolean(storage.enabled);
  tc.settings.siteEnabled = storage.siteEnabled && typeof storage.siteEnabled === "object"
    ? storage.siteEnabled
    : {};
  if (Object.prototype.hasOwnProperty.call(tc.settings.siteEnabled, location.hostname)) {
    tc.settings.enabled = Boolean(tc.settings.siteEnabled[location.hostname]);
  }
  tc.settings.startHidden = Boolean(storage.startHidden);
  tc.settings.controllerOpacity = Number(storage.controllerOpacity);
  tc.settings.blacklist = String(storage.blacklist);

  // ensure that there is a "display" binding (for upgrades from versions that had it as a separate binding)
  if (
    tc.settings.keyBindings.filter((x) => x.action == "display").length == 0
  ) {
    const displayBinding = PLAYBACK_DEFAULTS.keyBindings.find(function (item) {
      return item.action === "display";
    });
    tc.settings.keyBindings.unshift(Object.assign({}, displayBinding, {
      key: Number(storage.displayKeyCode) || displayBinding.key
    }));
    // Earlier versions only added this binding in memory, so the popup could not display it.
    chrome.storage.sync.set({ keyBindings: tc.settings.keyBindings });
  }

  initializeWhenReady(document);
});

// Keep an already-open page in sync with changes made in the popup/options.
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "sync") return;

  ["rememberSpeed", "forceLastSavedSpeed", "audioBoolean", "startHidden"].forEach(
    function (key) {
      if (changes[key]) tc.settings[key] = Boolean(changes[key].newValue);
    }
  );
  if (changes.keyBindings && Array.isArray(changes.keyBindings.newValue)) {
    tc.settings.keyBindings = changes.keyBindings.newValue;
  }
  if (changes.siteEnabled && changes.siteEnabled.newValue && typeof changes.siteEnabled.newValue === "object") {
    tc.settings.siteEnabled = changes.siteEnabled.newValue;
    if (Object.prototype.hasOwnProperty.call(tc.settings.siteEnabled, location.hostname)) {
      tc.settings.enabled = Boolean(tc.settings.siteEnabled[location.hostname]);
    }
    if (!tc.settings.enabled) {
      tc.mediaElements.slice().forEach(function (media) { if (media.vsc) media.vsc.remove(); });
    } else if (!document.body.classList.contains("vsc-initialized")) {
      initializeWhenReady(document);
    } else if (tc.videoController) {
      document.querySelectorAll(tc.settings.audioBoolean ? "video,audio" : "video").forEach(function (media) {
        if (!media.vsc) media.vsc = new tc.videoController(media);
      });
    }
  }
  if (changes.controllerOpacity) {
    var opacity = Number(changes.controllerOpacity.newValue);
    if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) {
      tc.settings.controllerOpacity = opacity;
      tc.mediaElements.forEach(function (media) {
        var panel = media.vsc && media.vsc.div.shadowRoot.querySelector("#controller");
        if (panel) panel.style.opacity = opacity;
      });
    }
  }

  if (changes.enabled) {
    tc.settings.enabled = Boolean(changes.enabled.newValue);
    if (!tc.settings.enabled) {
      tc.mediaElements.slice().forEach(function (media) {
        if (media.vsc) media.vsc.remove();
      });
    } else if (!document.body.classList.contains("vsc-initialized")) {
      initializeWhenReady(document);
    } else if (tc.videoController) {
      document
        .querySelectorAll(tc.settings.audioBoolean ? "video,audio" : "video")
        .forEach(function (media) {
          if (!media.vsc) media.vsc = new tc.videoController(media);
        });
    }
  }
});

function getKeyBindings(action, what = "value") {
  try {
    return tc.settings.keyBindings.find((item) => item.action === action)[what];
  } catch (e) {
    return false;
  }
}

function setKeyBindings(action, value) {
  tc.settings.keyBindings.find((item) => item.action === action)[
    "value"
  ] = value;
}

function defineVideoController() {
  // Data structures
  // ---------------
  // videoController (JS object) instances:
  //   video = AUDIO/VIDEO DOM element
  //   parent = A/V DOM element's parentElement OR
  //            (A/V elements discovered from the Mutation Observer)
  //            A/V element's parentNode OR the node whose children changed.
  //   div = Controller's DOM element (which happens to be a DIV)
  //   speedIndicator = DOM element in the Controller of the speed indicator

  // added to AUDIO / VIDEO DOM elements
  //    vsc = reference to the videoController
  tc.videoController = function (target, parent) {
    if (target.vsc) {
      return target.vsc;
    }

    tc.mediaElements.push(target);

    this.video = target;
    this.parent = target.parentElement || parent;
    var storedSpeed = tc.settings.speeds[target.currentSrc];
    if (!tc.settings.rememberSpeed) {
      if (!storedSpeed) {
        log(
          "Overwriting stored speed to 1.0 due to rememberSpeed being disabled",
          5
        );
        storedSpeed = 1.0;
      }
      setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
    } else {
      log("Recalling stored speed due to rememberSpeed being enabled", 5);
      storedSpeed = tc.settings.lastSpeed;
    }

    log("Explicitly setting playbackRate to: " + storedSpeed, 5);
    target.playbackRate = storedSpeed;

    this.div = this.initializeControls();

    var mediaEventAction = function (event) {
      markActiveMedia(event.target);
      var storedSpeed = tc.settings.speeds[event.target.currentSrc];
      if (!tc.settings.rememberSpeed) {
        if (!storedSpeed) {
          log("Overwriting stored speed to 1.0 (rememberSpeed not enabled)", 4);
          storedSpeed = 1.0;
        }
        // resetSpeed isn't really a reset, it's a toggle
        log("Setting reset keybinding to fast", 5);
        setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
      } else {
        log(
          "Storing lastSpeed into tc.settings.speeds (rememberSpeed enabled)",
          5
        );
        storedSpeed = tc.settings.lastSpeed;
      }
      // TODO: Check if explicitly setting the playback rate to 1.0 is
      // necessary when rememberSpeed is disabled (this may accidentally
      // override a website's intentional initial speed setting interfering
      // with the site's default behavior)
      if (Math.abs(event.target.playbackRate - storedSpeed) > 0.001) {
        log("Explicitly setting playbackRate to: " + storedSpeed, 4);
        setSpeed(event.target, storedSpeed);
      }
    };

    target.addEventListener(
      "play",
      (this.handlePlay = mediaEventAction.bind(this))
    );

    target.addEventListener("seeked", (this.handleSeek = function (event) {
      var video = event.target;
      if (!video.vsc || !video.vsc.pendingSeek) return;

      var pendingSeek = video.vsc.pendingSeek;
      video.vsc.pendingSeek = null;
      if (!pendingSeek.resume) return;
      // Some site players pause in reaction to a programmatic currentTime
      // change. Restore the state that existed before the extension sought.
      setTimeout(function () {
        if (!video.isConnected || !video.vsc || video.ended || !video.paused) return;
        var playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(function () {});
        }
      }, 0);
    }));

    target.addEventListener("mousedown", (this.handleActivate = function () {
      markActiveMedia(target);
    }), true);

    var observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          log("mutation of A/V element", 5);
          var controller = this.div;
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add("vsc-nosource");
          } else {
            controller.classList.remove("vsc-nosource");
          }
        }
      });
    });
    observer.observe(target, {
      attributeFilter: ["src", "currentSrc"]
    });
  };

  tc.videoController.prototype.remove = function () {
    this.div.remove();
    this.video.removeEventListener("play", this.handlePlay);
    this.video.removeEventListener("seeked", this.handleSeek);
    this.video.removeEventListener("mousedown", this.handleActivate, true);
    if (tc.activeMedia === this.video) tc.activeMedia = null;
    delete this.video.vsc;
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx != -1) {
      tc.mediaElements.splice(idx, 1);
    }
  };

  tc.videoController.prototype.initializeControls = function () {
    log("initializeControls Begin", 5);
    const document = this.video.ownerDocument;
    const speed = this.video.playbackRate.toFixed(2);
    var top = Math.max(this.video.offsetTop, 0) + "px",
      left = Math.max(this.video.offsetLeft, 0) + "px";

    log("Speed variable set to: " + speed, 5);

    var wrapper = document.createElement("div");
    wrapper.classList.add("vsc-controller");

    if (!this.video.src && !this.video.currentSrc) {
      wrapper.classList.add("vsc-nosource");
    }

    if (tc.settings.startHidden) {
      wrapper.classList.add("vsc-hidden");
    }

    var shadow = wrapper.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = '@import url("' + chrome.runtime.getURL("shadow.css") + '");';
    var controller = document.createElement("div");
    controller.id = "controller";
    controller.style.top = top;
    controller.style.left = left;
    controller.style.opacity = tc.settings.controllerOpacity;
    var draggable = document.createElement("span");
    draggable.dataset.action = "drag";
    draggable.className = "draggable";
    draggable.textContent = speed;
    var controls = document.createElement("span");
    controls.id = "controls";
    [["rewind", "rw", "ariaRewind", "↶"], ["slower", "speedButton", "ariaSlower", "−"], ["reset", "resetSpeed", "ariaReset", "↻"], ["faster", "speedButton", "ariaFaster", "＋"], ["advance", "rw", "ariaAdvance", "↷"]].forEach(function (item) {
      var button = document.createElement("button");
      button.dataset.action = item[0];
      button.className = item[1];
      button.setAttribute("aria-label", extensionMessage(item[2]));
      button.textContent = item[3];
      controls.appendChild(button);
    });
    controller.append(draggable, controls);
    shadow.append(style, controller);
    shadow.querySelector(".draggable").addEventListener(
      "mousedown",
      (e) => {
        e.preventDefault();
        runAction(e.target.dataset["action"], false, e);
        e.stopPropagation();
      },
      true
    );

    shadow.querySelectorAll("button").forEach(function (button) {
      button.addEventListener(
        "click",
        (e) => {
          runAction(
            e.target.dataset["action"],
            getKeyBindings(e.target.dataset["action"]),
            e
          );
          e.stopPropagation();
        },
        true
      );
    });

    shadow
      .querySelector("#controller")
      .addEventListener("click", (e) => e.stopPropagation(), false);
    shadow
      .querySelector("#controller")
      .addEventListener("mousedown", (e) => e.stopPropagation(), false);

    this.speedIndicator = shadow.querySelector("span");
    var fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    switch (true) {
      case location.hostname == "www.amazon.com":
      case location.hostname == "www.reddit.com":
      case /hbogo\./.test(location.hostname):
        // insert before parent to bypass overlay
        this.parent.parentElement.insertBefore(fragment, this.parent);
        break;
      case location.hostname == "www.facebook.com":
        // this is a monstrosity but new FB design does not have *any*
        // semantic handles for us to traverse the tree, and deep nesting
        // that we need to bubble up from to get controller to stack correctly
        let p = this.parent.parentElement.parentElement.parentElement
          .parentElement.parentElement.parentElement.parentElement;
        p.insertBefore(fragment, p.firstChild);
        break;
      case location.hostname == "tv.apple.com":
        // insert after parent for correct stacking context
        this.parent.getRootNode().querySelector(".scrim").prepend(fragment);
      default:
        // Note: when triggered via a MutationRecord, it's possible that the
        // target is not the immediate parent. This appends the controller as
        // the first element of the target, which may not be the parent.
        this.parent.insertBefore(fragment, this.parent.firstChild);
    }
    return wrapper;
  };
}

var coolDown = false;
function refreshCoolDown() {
  log("Begin refreshCoolDown", 5);
  if (coolDown) {
    clearTimeout(coolDown);
  }
  coolDown = setTimeout(function () {
    coolDown = false;
  }, 1000);
  log("End refreshCoolDown", 5);
}

function setupListener() {
  /**
   * This function is run whenever a video speed rate change occurs.
   * It is used to update the speed that shows up in the display as well as save
   * that latest speed into the local storage.
   *
   * @param {*} video The video element to update the speed indicators for.
   */
  function updateSpeedFromEvent(video) {
    // It's possible to get a rate change on a VIDEO/AUDIO that doesn't have
    // a video controller attached to it.  If we do, ignore it.
    if (!video.vsc)
      return;
    var speedIndicator = video.vsc.speedIndicator;
    var src = video.currentSrc;
    var speed = Number(video.playbackRate.toFixed(2));

    log("Playback rate changed to " + speed, 4);

    log("Updating controller with new speed", 5);
    speedIndicator.textContent = speed.toFixed(2);
    tc.settings.speeds[src] = speed;
    log("Storing lastSpeed in settings for the rememberSpeed feature", 5);
    tc.settings.lastSpeed = speed;
    log("Syncing chrome settings for lastSpeed", 5);
    chrome.storage.sync.set({ lastSpeed: speed }, function () {
      log("Speed setting saved: " + speed, 5);
    });
    // show the controller for 1000ms if it's hidden.
    runAction("blink", null, null, video);
  }

  document.addEventListener(
    "ratechange",
    function (event) {
      if (coolDown) {
        log("Speed event propagation blocked", 4);
        event.stopImmediatePropagation();
      }
      var video = event.target;
      if (
        video.vsc &&
        video.vsc.extensionRateUntil > performance.now() &&
        Math.abs(video.playbackRate - video.vsc.extensionRate) > 0.001
      ) {
        event.stopImmediatePropagation();
        setTimeout(function () {
          if (video.isConnected && video.vsc) {
            video.playbackRate = video.vsc.extensionRate;
          }
        }, 0);
        return;
      }

      /**
       * If the last speed is forced, only update the speed based on events created by
       * video speed instead of all video speed change events.
       */
      if (tc.settings.forceLastSavedSpeed) {
        if (event.detail && event.detail.origin === "videoSpeed") {
          video.playbackRate = event.detail.speed;
          updateSpeedFromEvent(video);
        } else {
          video.playbackRate = tc.settings.lastSpeed;
        }
        event.stopImmediatePropagation();
      } else {
        updateSpeedFromEvent(video);
      }
    },
    true
  );
}

function initializeWhenReady(document) {
  log("Begin initializeWhenReady", 5);
  if (!tc.settings.enabled) return;
  window.addEventListener('load', () => {
    initializeNow(window.document);
  });
  if (document) {
    if (document.readyState === "complete") {
      initializeNow(document);
    } else {
      document.onreadystatechange = () => {
        if (document.readyState === "complete") {
          initializeNow(document);
        }
      };
    }
  }
  log("End initializeWhenReady", 5);
}
function inIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}
function getShadow(parent) {
  let result = [];
  function getChild(parent) {
    if (parent.firstElementChild) {
      var child = parent.firstElementChild;
      do {
        result.push(child);
        getChild(child);
        if (child.shadowRoot) {
          result.push(getShadow(child.shadowRoot));
        }
        child = child.nextElementSibling;
      } while (child);
    }
  }
  getChild(parent);
  return result.flat(Infinity);
}

function initializeNow(document) {
  log("Begin initializeNow", 5);
  if (!tc.settings.enabled) return;
  // enforce init-once due to redundant callers
  if (!document.body || document.body.classList.contains("vsc-initialized")) {
    return;
  }
  try {
    setupListener();
  } catch {
    // no operation
  }
  document.body.classList.add("vsc-initialized");
  log("initializeNow: vsc-initialized added to document body", 5);

  if (document === window.document) {
    defineVideoController();
  } else {
    var link = document.createElement("link");
    link.href = chrome.runtime.getURL("inject.css");
    link.type = "text/css";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  var docs = Array(document);
  try {
    if (inIframe()) docs.push(window.top.document);
  } catch (e) {}

  docs.forEach(function (doc) {
    doc.addEventListener(
      "keydown",
      function (event) {
        var keyCode = event.keyCode;
        log("Processing keydown event: " + keyCode, 6);

        // Ignore if following modifier is active.
        if (
          !event.getModifierState ||
          event.getModifierState("Alt") ||
          event.getModifierState("Control") ||
          event.getModifierState("Fn") ||
          event.getModifierState("Meta") ||
          event.getModifierState("Hyper") ||
          event.getModifierState("OS")
        ) {
          log("Keydown event ignored due to active modifier: " + keyCode, 5);
          return;
        }

        // Ignore keydown event if typing in an input box
        if (
          event.target.nodeName === "INPUT" ||
          event.target.nodeName === "TEXTAREA" ||
          event.target.isContentEditable
        ) {
          return false;
        }

        // Ignore keydown event if typing in a page without vsc
        if (!tc.mediaElements.length) {
          return false;
        }

        var item = tc.settings.keyBindings.find((item) => item.key === keyCode);
        if (item) {
          var activeMedia = getActiveMedia(event.currentTarget);
          if (!activeMedia) return false;
          runAction(item.action, item.value, null, activeMedia);
          if (item.force === true || item.force === "true") {
            // disable websites key bindings
            event.preventDefault();
            event.stopPropagation();
          }
        }

        return false;
      },
      true
    );
  });

  function checkForVideo(node, parent, added) {
    // Only proceed with supposed removal if node is missing from DOM
    if (!added && document.body.contains(node)) {
      return;
    }
    if (
      node.nodeName === "VIDEO" ||
      (node.nodeName === "AUDIO" && tc.settings.audioBoolean)
    ) {
      if (added) {
        node.vsc = new tc.videoController(node, parent);
      } else {
        if (node.vsc) {
          node.vsc.remove();
        }
      }
    } else if (node.children != undefined) {
      for (var i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        checkForVideo(child, child.parentNode || parent, added);
      }
    }
  }

  var observer = new MutationObserver(function (mutations) {
    // Process the DOM nodes lazily
    requestIdleCallback(
      (_) => {
        mutations.forEach(function (mutation) {
          switch (mutation.type) {
            case "childList":
              mutation.addedNodes.forEach(function (node) {
                if (typeof node === "function") return;
                checkForVideo(node, node.parentNode || mutation.target, true);
              });
              mutation.removedNodes.forEach(function (node) {
                if (typeof node === "function") return;
                checkForVideo(node, node.parentNode || mutation.target, false);
              });
              break;
            case "attributes":
              if (
                mutation.target.attributes["aria-hidden"] &&
                mutation.target.attributes["aria-hidden"].value == "false"
              ) {
                var flattenedNodes = getShadow(document.body);
                var node = flattenedNodes.filter(
                  (x) => x.tagName == "VIDEO"
                )[0];
                if (node) {
                  if (node.vsc)
                    node.vsc.remove();
                  checkForVideo(node, node.parentNode || mutation.target, true);
                }
              }
              break;
          }
        });
      },
      { timeout: 1000 }
    );
  });
  observer.observe(document, {
    attributeFilter: ["aria-hidden"],
    childList: true,
    subtree: true
  });

  if (tc.settings.audioBoolean) {
    var mediaTags = document.querySelectorAll("video,audio");
  } else {
    var mediaTags = document.querySelectorAll("video");
  }

  mediaTags.forEach(function (video) {
    video.vsc = new tc.videoController(video);
  });

  var frameTags = document.getElementsByTagName("iframe");
  Array.prototype.forEach.call(frameTags, function (frame) {
    // Ignore frames we don't have permission to access (different origin).
    try {
      var childDocument = frame.contentDocument;
    } catch (e) {
      return;
    }
    initializeWhenReady(childDocument);
  });
  log("End initializeNow", 5);
}

function setSpeed(video, speed) {
  log("setSpeed started: " + speed, 5);
  var speedvalue = speed.toFixed(2);
  video.vsc.extensionRate = Number(speedvalue);
  video.vsc.extensionRateUntil = performance.now() + 3000;
  tc.settings.lastSpeed = Number(speedvalue);
  if (tc.settings.forceLastSavedSpeed) {
    video.dispatchEvent(
      new CustomEvent("ratechange", {
        detail: { origin: "videoSpeed", speed: speedvalue }
      })
    );
  } else {
    video.playbackRate = Number(speedvalue);
  }
  var speedIndicator = video.vsc.speedIndicator;
  speedIndicator.textContent = speedvalue;
  tc.settings.lastSpeed = Number(speedvalue);
  refreshCoolDown();
  log("setSpeed finished: " + speed, 5);
}

function markActiveMedia(media) {
  if (!media || !media.vsc) return;
  tc.activeMedia = media;
  media.vsc.lastActivatedAt = performance.now();
}

function getActiveMedia(doc) {
  var mediaTags = tc.mediaElements.filter(function (media) {
    return media &&
      media.isConnected &&
      media.vsc &&
      media.ownerDocument === doc &&
      !media.classList.contains("vsc-cancelled");
  });
  if (!mediaTags.length) return null;

  var playing = mediaTags.filter(function (media) {
    return !media.paused && !media.ended;
  });

  if (tc.activeMedia && mediaTags.includes(tc.activeMedia)) {
    if (!tc.activeMedia.paused || !playing.length) return tc.activeMedia;
  }

  if (playing.length) {
    return playing.reduce(function (latest, media) {
      return (media.vsc.lastActivatedAt || 0) > (latest.vsc.lastActivatedAt || 0)
        ? media
        : latest;
    });
  }

  // On pages where no video has played yet, prefer the largest visible media.
  return mediaTags.reduce(function (best, media) {
    var rect = media.getBoundingClientRect();
    var area = rect.width > 0 && rect.height > 0 ? rect.width * rect.height : 0;
    var bestRect = best.getBoundingClientRect();
    var bestArea = bestRect.width > 0 && bestRect.height > 0
      ? bestRect.width * bestRect.height
      : 0;
    return area > bestArea ? media : best;
  });
}

function seekMedia(video, offset) {
  var pendingSeek = {
    resume: !video.paused && !video.ended
  };
  video.vsc.pendingSeek = pendingSeek;
  video.currentTime += offset;

  // A media element can complete a seek synchronously (for example, in a fully
  // buffered short clip). Preserve playback in that case as well.
  if (pendingSeek.resume && !video.seeking && video.paused && !video.ended) {
    video.vsc.pendingSeek = null;
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {});
    }
  }

  // Do not let a seek that produced no seeked event affect a later, unrelated
  // seek performed by the page or by the user.
  setTimeout(function () {
    if (video.vsc && video.vsc.pendingSeek === pendingSeek) {
      video.vsc.pendingSeek = null;
    }
  }, 2000);
}

function runAction(action, value, e, targetMedia) {
  log("runAction Begin", 5);

  var mediaTags = targetMedia ? [targetMedia] : tc.mediaElements;

  // Get the controller that was used if called from a button press event e
  if (e) {
    var targetController = e.target.getRootNode().host;
  }

  mediaTags.forEach(function (v) {
    var controller = v.vsc.div;

    // Don't change video speed if the video has a different controller
    if (e && !(targetController == controller)) {
      return;
    }

    if (e) markActiveMedia(v);

    showController(controller);

    if (!v.classList.contains("vsc-cancelled")) {
      if (action === "rewind") {
        log("Rewind", 5);
        seekMedia(v, -value);
      } else if (action === "advance") {
        log("Fast forward", 5);
        seekMedia(v, value);
      } else if (action === "faster") {
        log("Increase speed", 5);
        // Maximum playback speed in Chrome is set to 16:
        // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=166
        var s = Math.min(
          (v.playbackRate < 0.1 ? 0.0 : v.playbackRate) + value,
          16
        );
        setSpeed(v, s);
      } else if (action === "slower") {
        log("Decrease speed", 5);
        // Video min rate is 0.0625:
        // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=165
        var s = Math.max(v.playbackRate - value, 0.07);
        setSpeed(v, s);
      } else if (action === "reset") {
        log("Reset speed", 5);
        resetSpeed(v, 1.0);
      } else if (action === "display") {
        log("Showing controller", 5);
        controller.classList.add("vsc-manual");
        controller.classList.toggle("vsc-hidden");
      } else if (action === "blink") {
        log("Showing controller momentarily", 5);
        // if vsc is hidden, show it briefly to give the use visual feedback that the action is excuted.
        if (
          controller.classList.contains("vsc-hidden") ||
          controller.blinkTimeOut !== undefined
        ) {
          clearTimeout(controller.blinkTimeOut);
          controller.classList.remove("vsc-hidden");
          controller.blinkTimeOut = setTimeout(
            () => {
              controller.classList.add("vsc-hidden");
              controller.blinkTimeOut = undefined;
            },
            value ? value : 1000
          );
        }
      } else if (action === "drag") {
        handleDrag(v, e);
      } else if (action === "fast") {
        resetSpeed(v, value);
      } else if (action === "pause") {
        pause(v);
      } else if (action === "muted") {
        muted(v);
      } else if (action === "mark") {
        setMark(v);
      } else if (action === "jump") {
        jumpToMark(v);
      }
    }
  });
  log("runAction End", 5);
}

function pause(v) {
  if (v.paused) {
    log("Resuming video", 5);
    v.play();
  } else {
    log("Pausing video", 5);
    v.pause();
  }
}

function resetSpeed(v, target) {
  if (v.playbackRate === target) {
    if (v.playbackRate === getKeyBindings("reset")) {
      if (target !== 1.0) {
        log("Resetting playback speed to 1.0", 4);
        setSpeed(v, 1.0);
      } else {
        log('Toggling playback speed to "fast" speed', 4);
        setSpeed(v, getKeyBindings("fast"));
      }
    } else {
      log('Toggling playback speed to "reset" speed', 4);
      setSpeed(v, getKeyBindings("reset"));
    }
  } else {
    log('Toggling playback speed to "reset" speed', 4);
    setKeyBindings("reset", v.playbackRate);
    setSpeed(v, target);
  }
}

function muted(v) {
  v.muted = v.muted !== true;
}

function setMark(v) {
  log("Adding marker", 5);
  v.vsc.mark = v.currentTime;
}

function jumpToMark(v) {
  log("Recalling marker", 5);
  if (v.vsc.mark && typeof v.vsc.mark === "number") {
    v.currentTime = v.vsc.mark;
  }
}

function handleDrag(video, e) {
  const controller = video.vsc.div;
  const shadowController = controller.shadowRoot.querySelector("#controller");
  const dragDocument = video.ownerDocument;
  const dragWindow = dragDocument.defaultView;

  video.classList.add("vcs-dragging");
  shadowController.classList.add("dragging");
  // Measure the expanded controls in their normal horizontal layout.
  shadowController.classList.remove("controls-below");

  const initialMouseXY = [e.clientX, e.clientY];
  let didDrag = false;
  const initialControllerXY = [
    parseInt(shadowController.style.left),
    parseInt(shadowController.style.top)
  ];
  const controllerStyle = shadowController.ownerDocument.defaultView.getComputedStyle(
    shadowController
  );
  const collapsedWidth =
    shadowController.querySelector(".draggable").getBoundingClientRect().width +
    parseFloat(controllerStyle.paddingLeft) +
    parseFloat(controllerStyle.paddingRight) +
    parseFloat(controllerStyle.borderLeftWidth) +
    parseFloat(controllerStyle.borderRightWidth);
  const collapsedHeight = shadowController.getBoundingClientRect().height;
  const leftMargin = parseFloat(controllerStyle.marginLeft) || 0;
  const topMargin = parseFloat(controllerStyle.marginTop) || 0;
  const videoLeft = Math.max(video.offsetLeft, 0);
  // The controller carries a visual left margin. Offset the draggable origin
  // by that margin so its visible edge can sit flush with either video edge.
  const minLeft = videoLeft - leftMargin;
  const videoRight = videoLeft + video.offsetWidth;
  const maxLeft = Math.max(
    minLeft,
    videoRight - collapsedWidth - leftMargin
  );
  const videoTop = Math.max(video.offsetTop, 0);
  const minTop = videoTop - topMargin;
  const videoBottom = videoTop + video.offsetHeight;
  const maxTop = Math.max(
    minTop,
    videoBottom - collapsedHeight - topMargin
  );
  const expandedWidth =
    collapsedWidth +
    6 +
    Array.from(shadowController.querySelectorAll("#controls button")).reduce(
      (width, button) => width + button.getBoundingClientRect().width,
      0
    );
  shadowController.classList.toggle(
    "controls-below",
    initialControllerXY[0] + leftMargin + expandedWidth > videoRight
  );

  const startDragging = (e) => {
    let style = shadowController.style;
    let dx = e.clientX - initialMouseXY[0];
    let dy = e.clientY - initialMouseXY[1];
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;
    e.preventDefault();
    // Keep the controller inside the containing player. In particular, do not
    // let a leftward drag move it into negative coordinates where it gets clipped.
    const left = Math.min(
      maxLeft,
      Math.max(minLeft, initialControllerXY[0] + dx)
    );
    const top = Math.min(
      maxTop,
      Math.max(minTop, initialControllerXY[1] + dy)
    );
    shadowController.classList.toggle(
      "controls-below",
      left + leftMargin + expandedWidth > videoRight
    );
    style.left = left + "px";
    style.top = top + "px";
  };

  const stopDragging = (event) => {
    dragDocument.removeEventListener("mousemove", startDragging, true);
    dragDocument.removeEventListener("mouseup", stopDragging, true);
    dragWindow.removeEventListener("blur", stopDragging);

    if (didDrag && event && event.type === "mouseup") {
      event.preventDefault();
      event.stopImmediatePropagation();

      // Firefox may still synthesize a click after mouseup. Consume that one
      // click in the capture phase so the page below the pointer is untouched.
      const suppressClick = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopImmediatePropagation();
        dragDocument.removeEventListener("click", suppressClick, true);
      };
      dragDocument.addEventListener("click", suppressClick, true);
      dragWindow.setTimeout(
        () => dragDocument.removeEventListener("click", suppressClick, true),
        0
      );
    }

    shadowController.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };

  dragDocument.addEventListener("mouseup", stopDragging, true);
  dragDocument.addEventListener("mousemove", startDragging, true);
  dragWindow.addEventListener("blur", stopDragging);
}

var timer = null;
function showController(controller) {
  log("Showing controller", 4);
  controller.classList.add("vcs-show");

  if (timer) clearTimeout(timer);

  timer = setTimeout(function () {
    controller.classList.remove("vcs-show");
    timer = false;
    log("Hiding controller", 5);
  }, 2000);
}
