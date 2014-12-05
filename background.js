var animationFrames = 36;
var animationSpeed = 10; // ms
var canvas = document.getElementById('canvas');
var canvasContext = canvas.getContext('2d');
var pollIntervalMin = 1;  // 1 minute
var pollIntervalMax = 60;  // 1 hour
var requestTimeout = 1000 * 2;  // 2 seconds
var rotation = 0;
var loadingAnimation = new LoadingAnimation();

// Legacy support for pre-event-pages.
var oldChromeVersion = !chrome.runtime;
var requestTimerId;

function getDoGoodUrl() {
  return "http://dogood.to/";
}

function timestamp() {
  return (new Date()).getTime();
}

function getDeedsUrl() {
  if(!localStorage.hasOwnProperty('timestamp')) {
    localStorage.timestamp = 0;
  }

  return getDoGoodUrl() + "api/deeds/count.json?timestamp=" + localStorage.timestamp;
}

function isDoGoodUrl(url) {
  return url.indexOf(getDoGoodUrl()) == 0;
}

function LoadingAnimation() {
  this.timerId_ = 0;
  this.maxCount_ = 8;  // Total number of states in animation
  this.current_ = 0;  // Current state
  this.maxDot_ = 4;  // Max number of dots in animation
}

LoadingAnimation.prototype.paintFrame = function() {
  var text = "";
  for (var i = 0; i < this.maxDot_; i++) {
    text += (i == this.current_) ? "." : " ";
  }
  if (this.current_ >= this.maxDot_)
    text += "";

  chrome.browserAction.setBadgeText({text:text});
  this.current_++;
  if (this.current_ == this.maxCount_)
    this.current_ = 0;
}

LoadingAnimation.prototype.start = function() {
  if (this.timerId_)
    return;

  var self = this;
  this.timerId_ = window.setInterval(function() {
    self.paintFrame();
  }, 100);
}

LoadingAnimation.prototype.stop = function() {
  if (!this.timerId_)
    return;

  window.clearInterval(this.timerId_);
  this.timerId_ = 0;
}

function updateIcon() {
  if (!localStorage.hasOwnProperty('unreadCount')) {
    chrome.browserAction.setBadgeBackgroundColor({color:[190, 190, 190, 230]});
    chrome.browserAction.setBadgeText({text:"?"});
  } else {
    chrome.browserAction.setBadgeBackgroundColor({color:[208, 0, 24, 255]});
    chrome.browserAction.setBadgeText({
      text: localStorage.unreadCount != "0" ? localStorage.unreadCount : ""
    });
  }
}

function scheduleRequest() {
  console.log('scheduleRequest');
  var randomness = Math.random() * 2;
  var exponent = Math.pow(2, localStorage.requestFailureCount || 0);
  var multiplier = Math.max(randomness * exponent, 1);
  var delay = Math.min(multiplier * pollIntervalMin, pollIntervalMax);
  delay = Math.round(delay);
  console.log('Scheduling for: ' + delay);

  if (oldChromeVersion) {
    if (requestTimerId) {
      window.clearTimeout(requestTimerId);
    }
    requestTimerId = window.setTimeout(onAlarm, delay*60*1000);
  } else {
    console.log('Creating alarm');
    // Use a repeating alarm so that it fires again if there was a problem
    // setting the next alarm.
    chrome.alarms.create('refresh', {periodInMinutes: delay});
  }
}

// ajax stuff
function startRequest(params) {
  // Schedule request immediately. We want to be sure to reschedule, even in the
  // case where the extension process shuts down while this request is
  // outstanding.
  if (params && params.scheduleRequest) scheduleRequest();

  function stopLoadingAnimation() {
    if (params && params.showLoadingAnimation) loadingAnimation.stop();
  }

  if (params && params.showLoadingAnimation)
    loadingAnimation.start();

  getDeedsCount(
    function(count) {
      stopLoadingAnimation();
      updateUnreadDeedCount(count);
    },
    function() {
      stopLoadingAnimation();
      delete localStorage.unreadCount;
      updateIcon();
    }
  );
}

function getDeedsCount(onSuccess, onError) {
  var xhr = new XMLHttpRequest();
  var abortTimerId = window.setTimeout(function() {
    xhr.abort();  // synchronously calls onreadystatechange
  }, requestTimeout);

  function handleSuccess(count) {
    localStorage.requestFailureCount = 0;
    window.clearTimeout(abortTimerId);
    if (onSuccess)
      onSuccess(count);
  }

  var invokedErrorCallback = false;
  function handleError() {
    ++localStorage.requestFailureCount;
    window.clearTimeout(abortTimerId);
    if (onError && !invokedErrorCallback)
      onError();
    invokedErrorCallback = true;
  }

  try {
    xhr.onreadystatechange = function() {
      if (xhr.readyState != 4)
        return;

      if (xhr.responseText) {
        var response = JSON.parse(xhr.responseText);
        console.log(response);
        handleSuccess(response.count);
        return;
      }

      handleError();
    };

    xhr.onerror = function(error) {
      handleError();
    };

    xhr.open("GET", getDeedsUrl(), true);
    xhr.send(null);
  } catch(e) {
    handleError();
  }
}

function updateUnreadDeedCount(count) {
  var changed = localStorage.unreadCount != count;
  localStorage.unreadCount = count;
  updateIcon();
}

function goToDoGood() {
  chrome.tabs.getAllInWindow(undefined, function(tabs) {
    for (var i = 0, tab; tab = tabs[i]; i++) {
      if (tab.url && isDoGoodUrl(tab.url)) {
        chrome.tabs.update(tab.id, {selected: true});
        startRequest({scheduleRequest:false, showLoadingAnimation:false});
        return;
      }
    }

    chrome.tabs.create({url: getDoGoodUrl()});
  });

  localStorage.timestamp = timestamp();
}

function onInit() {
  console.log('onInit');
  localStorage.requestFailureCount = 0;  // used for exponential backoff
  startRequest({scheduleRequest:true, showLoadingAnimation:true});
  if (!oldChromeVersion) {
    chrome.alarms.create('watchdog', {periodInMinutes:5});
  }
}

function onAlarm(alarm) {
  console.log('Got alarm', alarm);
  // |alarm| can be undefined because onAlarm also gets called from
  // window.setTimeout on old chrome versions.
  if (alarm && alarm.name == 'watchdog') {
    onWatchdog();
  } else {
    startRequest({scheduleRequest:true, showLoadingAnimation:false});
  }
}

function onWatchdog() {
  chrome.alarms.get('refresh', function(alarm) {
    if (alarm) {
      console.log('Refresh alarm exists. Yay.');
    } else {
      console.log('Refresh alarm doesn\'t exist!? ' +
                  'Refreshing now and rescheduling.');
      startRequest({scheduleRequest:true, showLoadingAnimation:false});
    }
  });
}

if (oldChromeVersion) {
  updateIcon();
  onInit();
} else {
  chrome.runtime.onInstalled.addListener(onInit);
  chrome.alarms.onAlarm.addListener(onAlarm);
}

var filters = {
  url: [{urlContains: getDoGoodUrl().replace(/^https?\:\/\//, '')}]
};

function onNavigate(details) {
  if (details.url && isDoGoodUrl(details.url)) {
    localStorage.timestamp = timestamp();
    startRequest({scheduleRequest:false, showLoadingAnimation:false});
  }
}
if (chrome.webNavigation && chrome.webNavigation.onDOMContentLoaded &&
    chrome.webNavigation.onReferenceFragmentUpdated) {
  chrome.webNavigation.onDOMContentLoaded.addListener(onNavigate, filters);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(
      onNavigate, filters);
} else {
  chrome.tabs.onUpdated.addListener(function(_, details) {
    onNavigate(details);
  });
}

chrome.browserAction.onClicked.addListener(goToDoGood);

if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(function() {
    console.log('Starting browser... updating icon.');
    startRequest({scheduleRequest:false, showLoadingAnimation:false});
    updateIcon();
  });
} else {
  chrome.windows.onCreated.addListener(function() {
    console.log('Window created... updating icon.');
    startRequest({scheduleRequest:false, showLoadingAnimation:false});
    updateIcon();
  });
}
