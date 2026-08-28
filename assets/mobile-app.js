(function () {
  const APP_TOKEN_KEY = 'blys_app_push_token';
  const APP_READY_FLAG = 'blys_app_push_ready';
  const APP_SWITCH_KEY = 'blys_native_push_switch';
  const APP_DIAG_KEY = 'blys_native_push_diag';
  const APP_BRIDGE = {
    enabled: false,
    nativePush: false,
    provider: '',
    token: '',
    initPromise: null
  };

  function isNativeApp() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
        return true;
      }
    } catch (e) {}
    const href = String(location.href || '');
    const host = String(location.hostname || '');
    if (href.startsWith('capacitor://')) return true;
    if (href.includes('/android_asset/')) return true;
    if (host === 'localhost' && /^https?:/i.test(href)) return true;
    return false;
  }

  if (isNativeApp()) {
    document.documentElement.classList.add('blys-native-app');
  }

  function canUseNativePush() {
    return isNativeApp() && !!(getGetuiPushPlugin() || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications));
  }

  function canUseLocalNotifications() {
    return isNativeApp() && !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function readDiag() {
    try {
      return JSON.parse(localStorage.getItem(APP_DIAG_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function writeDiag(patch) {
    const next = Object.assign({}, readDiag(), patch || {}, { updatedAt: nowIso() });
    localStorage.setItem(APP_DIAG_KEY, JSON.stringify(next));
    try {
      window.dispatchEvent(new CustomEvent('blys:native-push-diag', { detail: next }));
    } catch (e) {}
    return next;
  }

  function clearDiagError() {
    writeDiag({ lastError: '', lastErrorAt: '' });
    localStorage.removeItem('blys_native_push_error');
  }

  function setDiagError(message, extra) {
    const text = message ? String(message) : 'unknown error';
    localStorage.setItem('blys_native_push_error', text);
    writeDiag(Object.assign({
      lastError: text,
      lastErrorAt: nowIso()
    }, extra || {}));
  }

  function tokenPreview(token) {
    const value = token ? String(token) : '';
    if (!value) return '';
    if (value.length <= 18) return value;
    return value.slice(0, 10) + '...' + value.slice(-8);
  }

  function isPushWanted() {
    return localStorage.getItem(APP_SWITCH_KEY) !== 'off';
  }

  function getNativeDiagPlugin() {
    return window.Capacitor && window.Capacitor.Plugins
      ? window.Capacitor.Plugins.NativePushDiag
      : null;
  }

  function getGetuiPushPlugin() {
    return window.Capacitor && window.Capacitor.Plugins
      ? window.Capacitor.Plugins.GetuiPush
      : null;
  }

  function saveToken(token) {
    APP_BRIDGE.token = token || '';
    if (token) localStorage.setItem(APP_TOKEN_KEY, token);
    else localStorage.removeItem(APP_TOKEN_KEY);
    writeDiag({
      tokenPresent: !!token,
      tokenPreview: tokenPreview(token),
      tokenUpdatedAt: token ? nowIso() : '',
    });
  }

  async function postNativePushToken(token, platform) {
    if (!token || !window.sbRpc || !window.__user || !window.__user.loggedIn || !window.__user.token) return false;
    const d = await window.sbRpc('save_native_push_token', {
      p_token: window.__user.token,
      p_device_token: token,
      p_platform: platform || APP_BRIDGE.provider || 'android',
      p_user_agent: navigator.userAgent || ''
    }, { timeoutMs: 10000 });
    return !!(d && d.ok);
  }

  async function deleteNativePushToken(token) {
    if (!token || !window.sbRpc || !window.__user || !window.__user.loggedIn || !window.__user.token) return false;
    const d = await window.sbRpc('delete_native_push_token', {
      p_token: window.__user.token,
      p_device_token: token
    }, { timeoutMs: 10000 });
    return !!(d && d.ok);
  }

  async function fetchNativeFirebaseStatus() {
    const plugin = getNativeDiagPlugin();
    if (!plugin || typeof plugin.getStatus !== 'function') {
      return null;
    }
    try {
      const result = await plugin.getStatus();
      const token = result && result.token ? String(result.token) : '';
      const tokenError = result && result.tokenError ? String(result.tokenError) : '';
      writeDiag({
        firebasePackageName: result && result.packageName ? String(result.packageName) : '',
        googlePlayServicesAvailable: !!(result && result.googlePlayServicesAvailable),
        googlePlayServicesCode: result && typeof result.googlePlayServicesCode !== 'undefined' ? String(result.googlePlayServicesCode) : '',
        firebaseApps: result && typeof result.firebaseApps !== 'undefined' ? String(result.firebaseApps) : '',
        firebaseTokenCheckAt: nowIso(),
        firebaseTokenError: tokenError
      });
      if (token) {
        saveToken(token);
      }
      if (tokenError) {
        setDiagError(tokenError, {
          firebaseTokenCheckAt: nowIso()
        });
      }
      return result;
    } catch (e) {
      setDiagError(e && e.message ? e.message : 'native firebase status failed');
      return null;
    }
  }

  async function ensureLocalNotificationReady() {
    const LocalNotifications = canUseLocalNotifications() ? window.Capacitor.Plugins.LocalNotifications : null;
    if (!LocalNotifications) return null;
    let localPerm = null;
    try {
      localPerm = await LocalNotifications.checkPermissions();
      if (!localPerm || localPerm.display !== 'granted') {
        localPerm = await LocalNotifications.requestPermissions();
      }
      writeDiag({
        localNotificationsPlugin: true,
        localPermission: localPerm && localPerm.display ? String(localPerm.display) : 'unknown',
        localPermissionCheckedAt: nowIso()
      });
    } catch (e) {}
    try {
      await LocalNotifications.createChannel({
        id: 'chat_messages',
        name: '聊天消息',
        description: '聊天室新消息提醒',
        importance: 5,
        visibility: 1,
        sound: 'default'
      });
      writeDiag({ localChannelReady: true, localChannelReadyAt: nowIso() });
    } catch (e) {}
    return localPerm;
  }

  async function fetchGetuiStatus() {
    const plugin = getGetuiPushPlugin();
    if (!plugin || typeof plugin.getStatus !== 'function') return null;
    try {
      const result = await plugin.getStatus();
      const token = result && (result.cid || result.token) ? String(result.cid || result.token) : '';
      const error = result && result.error ? String(result.error) : '';
      writeDiag({
        pushProvider: 'getui',
        getuiPlugin: true,
        getuiConfigured: !!(result && result.configured),
        getuiAppidPresent: !!(result && result.appidPresent),
        getuiPushTurnedOn: !!(result && result.pushTurnedOn),
        getuiSdkVersion: result && result.sdkVersion ? String(result.sdkVersion) : '',
        getuiCidPresent: !!token,
        getuiOnline: !!(result && result.online),
        getuiLastEvent: result && result.lastEvent ? String(result.lastEvent) : '',
        getuiLastTitle: result && result.lastTitle ? String(result.lastTitle) : '',
        getuiLastBody: result && result.lastBody ? String(result.lastBody) : '',
        getuiLastAt: result && result.lastAt ? String(result.lastAt) : '',
        getuiStatusCheckedAt: nowIso()
      });
      if (token) {
        APP_BRIDGE.provider = 'getui_android';
        saveToken(token);
      }
      if (error) setDiagError(error, { getuiStatusCheckedAt: nowIso() });
      return result;
    } catch (e) {
      setDiagError(e && e.message ? e.message : 'getui status failed');
      return null;
    }
  }

  async function ensureGetuiNativePush() {
    const plugin = getGetuiPushPlugin();
    if (!plugin || typeof plugin.initialize !== 'function') return null;
    APP_BRIDGE.enabled = true;
    APP_BRIDGE.nativePush = true;
    APP_BRIDGE.provider = 'getui_android';
    clearDiagError();
    writeDiag({
      nativeApp: true,
      pushProvider: 'getui',
      getuiPlugin: true,
      nativePushPlugin: true,
      switchWanted: isPushWanted(),
      initStartedAt: nowIso()
    });
    await ensureLocalNotificationReady();
    const result = await plugin.initialize();
    await fetchGetuiStatus();
    const token = APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || '';
    localStorage.setItem(APP_READY_FLAG, token ? 'on' : 'off');
    writeDiag({
      registrationOk: !!token,
      registrationAt: nowIso(),
      appReady: token ? 'on' : 'off',
      tokenSaveMessage: token ? '' : '等待个推 CID，下次打开或回前台会自动补注册'
    });
    if (result && result.configured === false) {
      setDiagError('个推 AppId 未配置，请填写 getui.properties 后重打包', {
        appReady: 'off'
      });
      return { ok: false, msg: 'getui-not-configured' };
    }
    if (!token) return { ok: false, msg: 'getui-cid-pending' };
    return { ok: true, provider: 'getui' };
  }

  async function ensureNativePush() {
    if (!canUseNativePush()) return { ok: false, msg: 'not-native' };
    if (APP_BRIDGE.initPromise) return APP_BRIDGE.initPromise;
    APP_BRIDGE.initPromise = (async () => {
      try {
        const getuiResult = await ensureGetuiNativePush();
        if (getuiResult) {
          if (!getuiResult.ok) APP_BRIDGE.initPromise = null;
          return getuiResult;
        }
        const PushNotifications = window.Capacitor.Plugins.PushNotifications;
        const LocalNotifications = canUseLocalNotifications() ? window.Capacitor.Plugins.LocalNotifications : null;
        APP_BRIDGE.enabled = true;
        APP_BRIDGE.nativePush = true;
        APP_BRIDGE.provider = 'firebase_android';
        clearDiagError();
        writeDiag({
          nativeApp: true,
          nativePushPlugin: true,
          localNotificationsPlugin: !!LocalNotifications,
          switchWanted: isPushWanted(),
          initStartedAt: nowIso()
        });

        if (LocalNotifications) {
          try {
            let localPerm = await LocalNotifications.checkPermissions();
            if (!localPerm || localPerm.display !== 'granted') {
              localPerm = await LocalNotifications.requestPermissions();
            }
            writeDiag({
              localPermission: localPerm && localPerm.display ? String(localPerm.display) : 'unknown',
              localPermissionCheckedAt: nowIso()
            });
          } catch (e) {}
          try {
            await LocalNotifications.createChannel({
              id: 'chat_messages',
              name: '聊天消息',
              description: '聊天室新消息提醒',
              importance: 5,
              visibility: 1,
              sound: 'default'
            });
            writeDiag({ localChannelReady: true, localChannelReadyAt: nowIso() });
          } catch (e) {}
        }

        PushNotifications.addListener('registration', async (token) => {
          const value = token && token.value ? token.value : '';
          saveToken(value);
          localStorage.setItem(APP_READY_FLAG, value ? 'on' : 'off');
          writeDiag({
            registrationOk: !!value,
            registrationAt: nowIso(),
            appReady: value ? 'on' : 'off'
          });
          if (!isPushWanted()) return;
          try {
            const saved = await postNativePushToken(value, 'firebase_android');
            writeDiag({
              tokenSavedToServer: !!saved,
              tokenSavedAt: nowIso(),
              tokenSaveMessage: saved ? 'token synced to server' : 'save_native_push_token returned false'
            });
          } catch (e) {
            setDiagError(e && e.message ? e.message : 'save_native_push_token failed', {
              tokenSavedToServer: false,
              tokenSavedAt: nowIso(),
              tokenSaveMessage: 'save_native_push_token exception'
            });
          }
        });

        PushNotifications.addListener('registrationError', (error) => {
          const text = error && error.error ? String(error.error) : (error && error.message ? String(error.message) : 'native push register error');
          setDiagError(text, { registrationOk: false, registrationAt: nowIso() });
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          const url = notification && notification.notification && notification.notification.data && notification.notification.data.url;
          writeDiag({
            lastNotificationActionAt: nowIso(),
            lastNotificationActionUrl: url || ''
          });
          if (url) location.href = url;
        });

        PushNotifications.addListener('pushNotificationReceived', async (notification) => {
          writeDiag({
            lastPushReceivedAt: nowIso(),
            lastPushTitle: notification && notification.title ? String(notification.title) : '',
            lastPushBody: notification && notification.body ? String(notification.body) : ''
          });
          if (!LocalNotifications) return;
          try {
            const title = notification && notification.title ? String(notification.title) : '白鹿原上';
            const body = notification && notification.body ? String(notification.body) : '你有一条新消息';
            const data = notification && notification.data ? notification.data : {};
            await LocalNotifications.schedule({
              notifications: [{
                id: Date.now() % 2147483647,
                title,
                body,
                schedule: { at: new Date(Date.now() + 100) },
                extra: data,
                channelId: 'chat_messages',
                sound: 'default'
              }]
            });
            writeDiag({
              lastForegroundPopupAt: nowIso(),
              lastForegroundPopupOk: true
            });
          } catch (e) {}
        });

        let perm = await PushNotifications.checkPermissions();
        if (!perm || perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
        writeDiag({
          nativePermission: perm && perm.receive ? String(perm.receive) : 'unknown',
          nativePermissionCheckedAt: nowIso()
        });
        if (!perm || perm.receive !== 'granted') {
          localStorage.setItem(APP_READY_FLAG, 'off');
          writeDiag({ appReady: 'off' });
          return { ok: false, msg: 'permission-denied' };
        }
        await PushNotifications.register();
        setTimeout(() => { fetchNativeFirebaseStatus().catch(() => {}); }, 1200);
        return { ok: true };
      } catch (e) {
        setDiagError(e && e.message ? String(e.message) : 'native push init error', {
          initFailedAt: nowIso()
        });
        APP_BRIDGE.initPromise = null;
        return { ok: false, msg: 'native-init-failed' };
      }
    })();
    return APP_BRIDGE.initPromise;
  }

  async function bootstrapNativePush() {
    writeDiag({
      switchWanted: isPushWanted(),
      bootstrapAt: nowIso(),
      loggedIn: !!(window.__user && window.__user.loggedIn)
    });
    const result = await ensureNativePush();
    if (!result || !result.ok) return result;
    if (!isPushWanted()) return { ok: true, msg: 'disabled' };
    const token = APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || '';
    if (token) {
      try {
            const saved = await postNativePushToken(token, APP_BRIDGE.provider);
        writeDiag({
          tokenSavedToServer: !!saved,
          tokenSavedAt: nowIso(),
          tokenSaveMessage: saved ? 'token synced to server' : 'save_native_push_token returned false'
        });
      } catch (e) {
        setDiagError(e && e.message ? e.message : 'bootstrap save token failed', {
          tokenSavedToServer: false,
          tokenSavedAt: nowIso()
        });
      }
    } else {
      await fetchGetuiStatus();
      const getuiToken = APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || '';
      if (APP_BRIDGE.provider === 'getui_android' && getuiToken) {
        try {
          const saved = await postNativePushToken(getuiToken, 'getui_android');
          writeDiag({
            tokenSavedToServer: !!saved,
            tokenSavedAt: nowIso(),
            tokenSaveMessage: saved ? 'getui cid synced to server' : 'save_native_push_token returned false'
          });
          return result;
        } catch (e) {
          setDiagError(e && e.message ? e.message : 'getui cid save failed', {
            tokenSavedToServer: false,
            tokenSavedAt: nowIso()
          });
        }
      }
      await fetchNativeFirebaseStatus();
      const nativeToken = APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || '';
      if (nativeToken) {
        try {
          const saved = await postNativePushToken(nativeToken, APP_BRIDGE.provider);
          writeDiag({
            tokenSavedToServer: !!saved,
            tokenSavedAt: nowIso(),
            tokenSaveMessage: saved ? 'token synced to server' : 'save_native_push_token returned false'
          });
        } catch (e) {
          setDiagError(e && e.message ? e.message : 'native firebase token save failed', {
            tokenSavedToServer: false,
            tokenSavedAt: nowIso()
          });
        }
      }
    }
    return result;
  }

  async function enableNativePush(options) {
    const opts = options || {};
    localStorage.setItem(APP_SWITCH_KEY, 'on');
    APP_BRIDGE.initPromise = null;
    const getui = getGetuiPushPlugin();
    if (getui && typeof getui.turnOn === 'function') {
      try { await getui.turnOn(); } catch (e) {}
    }
    writeDiag({ switchWanted: true, switchChangedAt: nowIso(), tokenSaveMessage: '正在开启 App 提醒...' });
    const result = await bootstrapNativePush();
    if (!opts.skipSelfTest && getui && typeof getui.testLocalNotification === 'function') {
      try {
        const testResult = await getui.testLocalNotification();
        writeDiag({
          localAlertSelfTestAt: nowIso(),
          localAlertSelfTestOk: !!(testResult && testResult.ok)
        });
      } catch (e) {
        setDiagError(e && e.message ? e.message : 'local alert self test failed', {
          localAlertSelfTestAt: nowIso(),
          localAlertSelfTestOk: false
        });
      }
    }
    return result;
  }

  async function disableNativePush() {
    localStorage.setItem(APP_SWITCH_KEY, 'off');
    localStorage.setItem(APP_READY_FLAG, 'off');
    writeDiag({
      switchWanted: false,
      switchChangedAt: nowIso(),
      appReady: 'off'
    });
    const token = APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || '';
    const getui = getGetuiPushPlugin();
    if (getui && typeof getui.turnOff === 'function') {
      try { await getui.turnOff(); } catch (e) {}
    }
    if (token) {
      try {
        const deleted = await deleteNativePushToken(token);
        writeDiag({
          tokenDeletedFromServer: !!deleted,
          tokenDeletedAt: nowIso()
        });
      } catch (e) {
        setDiagError(e && e.message ? e.message : 'delete_native_push_token failed', {
          tokenDeletedFromServer: false,
          tokenDeletedAt: nowIso()
        });
      }
    }
    return { ok: true };
  }

  async function resetNativePush() {
    await disableNativePush();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await enableNativePush({ skipSelfTest: true });
  }

  async function getDiagnostics() {
    const token = APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || '';
    const base = readDiag();
    return Object.assign({}, base, {
      nativeApp: isNativeApp(),
      pageOrigin: location.origin || '',
      pageHref: location.href || '',
      nativePushPlugin: canUseNativePush(),
      nativeDiagPlugin: !!getNativeDiagPlugin(),
      getuiPlugin: !!getGetuiPushPlugin(),
      pushProvider: APP_BRIDGE.provider || base.pushProvider || '',
      localNotificationsPlugin: canUseLocalNotifications(),
      switchWanted: isPushWanted(),
      appReady: localStorage.getItem(APP_READY_FLAG) || 'off',
      tokenPresent: !!token,
      tokenPreview: tokenPreview(token),
      lastError: localStorage.getItem('blys_native_push_error') || base.lastError || '',
      loggedIn: !!(window.__user && window.__user.loggedIn)
    });
  }

  window.addEventListener('blys:user:change', async function (event) {
    const detail = event && event.detail ? event.detail : null;
    if (!detail || !detail.loggedIn) return;
    await bootstrapNativePush();
  });

  window.addEventListener('load', function () {
    if (!isNativeApp()) return;
    setTimeout(() => { bootstrapNativePush().catch(() => {}); }, 600);
    setTimeout(() => { bootstrapNativePush().catch(() => {}); }, 3000);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && isNativeApp()) {
      setTimeout(() => { bootstrapNativePush().catch(() => {}); }, 200);
    }
  });

  window.BLYS_APP = {
    isNativeApp,
    canUseNativePush,
    ensureNativePush,
    enableNotifications: enableNativePush,
    disableNotifications: disableNativePush,
    resetNotifications: resetNativePush,
    getDiagnostics,
    getNativeToken: function () { return APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || ''; },
    getLastError: function () { return localStorage.getItem('blys_native_push_error') || ''; },
    saveNativeTokenToProfile: postNativePushToken
  };
})();
