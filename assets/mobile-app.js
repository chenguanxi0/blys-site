(function () {
  const APP_TOKEN_KEY = 'blys_app_push_token';
  const APP_READY_FLAG = 'blys_app_push_ready';
  const APP_BRIDGE = {
    enabled: false,
    nativePush: false,
    token: '',
    initPromise: null
  };

  function isNativeApp() {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  }

  function canUseNativePush() {
    return isNativeApp() && !!window.CapacitorCustomPlatform === false;
  }

  function saveToken(token) {
    APP_BRIDGE.token = token || '';
    if (token) localStorage.setItem(APP_TOKEN_KEY, token);
    else localStorage.removeItem(APP_TOKEN_KEY);
  }

  async function postNativePushToken(token) {
    if (!token || !window.sbRpc || !window.__user || !window.__user.loggedIn || !window.__user.token) return false;
    const d = await window.sbRpc('save_native_push_token', {
      p_token: window.__user.token,
      p_device_token: token,
      p_platform: 'android',
      p_user_agent: navigator.userAgent || ''
    }, { timeoutMs: 10000 });
    return !!(d && d.ok);
  }

  async function ensureNativePush() {
    if (!canUseNativePush()) return { ok: false, msg: 'not-native' };
    if (APP_BRIDGE.initPromise) return APP_BRIDGE.initPromise;
    APP_BRIDGE.initPromise = (async () => {
      try {
        const mod = await import('https://unpkg.com/@capacitor/push-notifications@7.0.3/dist/plugin.js');
        const PushNotifications = mod.PushNotifications;
        APP_BRIDGE.enabled = true;
        APP_BRIDGE.nativePush = true;

        PushNotifications.addListener('registration', async (token) => {
          const value = token && token.value ? token.value : '';
          saveToken(value);
          localStorage.setItem(APP_READY_FLAG, value ? 'on' : 'off');
          try { await postNativePushToken(value); } catch (e) {}
        });

        PushNotifications.addListener('registrationError', (error) => {
          const text = error && error.error ? String(error.error) : (error && error.message ? String(error.message) : 'native push register error');
          localStorage.setItem('blys_native_push_error', text);
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          const url = notification && notification.notification && notification.notification.data && notification.notification.data.url;
          if (url) location.href = url;
        });

        let perm = await PushNotifications.checkPermissions();
        if (!perm || perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
        if (!perm || perm.receive !== 'granted') {
          localStorage.setItem(APP_READY_FLAG, 'off');
          return { ok: false, msg: 'permission-denied' };
        }
        await PushNotifications.register();
        return { ok: true };
      } catch (e) {
        localStorage.setItem('blys_native_push_error', e && e.message ? String(e.message) : 'native push init error');
        return { ok: false, msg: 'native-init-failed' };
      }
    })();
    return APP_BRIDGE.initPromise;
  }

  window.addEventListener('blys:user:change', async function (event) {
    const detail = event && event.detail ? event.detail : null;
    if (!detail || !detail.loggedIn) return;
    const result = await ensureNativePush();
    if (!result || !result.ok) return;
    const token = APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || '';
    if (token) {
      try { await postNativePushToken(token); } catch (e) {}
    }
  });

  window.BLYS_APP = {
    isNativeApp,
    canUseNativePush,
    ensureNativePush,
    getNativeToken: function () { return APP_BRIDGE.token || localStorage.getItem(APP_TOKEN_KEY) || ''; },
    getLastError: function () { return localStorage.getItem('blys_native_push_error') || ''; },
    saveNativeTokenToProfile: postNativePushToken
  };
})();
