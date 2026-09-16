// node --test tools/test-media-egress.cjs
// Set BLYS_TEST_BROWSER=1 (and make playwright resolvable) to include isolated Chrome/IndexedDB tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { create, createStorage } = require('../public/assets/chat-media-cache.js');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const baseline = name => execFileSync('git', ['show', '5182c3c:' + name], { cwd: root, encoding: 'utf8', maxBuffer: 2000000 }).replace(/\r\n/g, '\n');
const chat = read('public/chat.html');
const app = read('public/assets/app.js');
const image = { ok: true, image: 'data:image/png;base64,aGVsbG8=' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function fn(source, name, indent = '    ') {
  const pattern = new RegExp('^' + indent + '(?:async )?function ' + name + '\\(', 'm');
  const start = source.search(pattern);
  assert.notEqual(start, -1, name + ' exists');
  const end = source.indexOf('\n' + indent + '}', start);
  return source.slice(start, end + indent.length + 2);
}

test('notification implementation and message polling paths are unchanged', () => {
  const before = baseline('public/chat.html');
  const marker = '// ===== 新消息提醒 =====';
  assert.ok(chat.includes(marker));
  assert.equal(chat.slice(chat.indexOf(marker)), before.slice(before.indexOf(marker)));
  for (const name of ['startChatPoll', 'pollChatRoomUnread', 'pollChatUnreadRooms', 'refreshPrivateUnreadBadge', 'startPrivateUnreadPolling']) {
    assert.equal(fn(chat, name), fn(before, name), name);
  }
  const stripApproval = code => code.split('\n').filter(line => !line.includes('const imageScope = getChatMediaScope();') && !line.includes('approveChatMediaList(')).join('\n');
  for (const name of ['loadChatMessages', 'loadPrivateMessages']) {
    assert.equal(stripApproval(fn(chat, name)), fn(before, name), name);
  }
  assert.equal(fn(app, 'sbRpc', ''), fn(baseline('public/assets/app.js'), 'sbRpc', ''));
  for (const file of ['public/sw.js', 'public/assets/mobile-app.js']) assert.equal(read(file), baseline(file), file);
});

test('all chat inline scripts and changed JavaScript parse', () => {
  assert.match(chat, /<script async fetchpriority="low" src="assets\/chat-media-cache\.js/);
  for (const [, attrs, body] of chat.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!attrs.includes('src=')) new vm.Script(body);
  }
  new vm.Script(app);
  new vm.Script(read('public/assets/chat-media-cache.js'));
});

test('concurrent/repeated image loads share bytes, not errors', async () => {
  const cache = create(); cache.setScope('user-a');
  const pending = deferred(); let calls = 0;
  const loader = () => { calls++; return pending.promise; };
  const first = cache.load('private:1', loader);
  const second = cache.load('private:1', loader);
  pending.resolve(image);
  assert.deepEqual(await Promise.all([first, second]), [image, image]);
  assert.deepEqual(await cache.load('private:1', loader), image);
  assert.equal(calls, 1);
  let errors = 0;
  const bad = async () => { errors++; throw new Error('offline'); };
  await assert.rejects(cache.load('private:2', bad));
  await assert.rejects(cache.load('private:2', bad));
  assert.equal(errors, 2);
});

test('persistent images require fresh list authorization; first private fetch still records receipt', async () => {
  let fetches = 0, gets = 0;
  const storage = { get: async () => { gets++; return { at: Date.now(), value: image }; } };
  const cache = create({ storage }); cache.setScope('user');
  const denied = await cache.load('private:1', async () => { fetches++; return { ok: false }; });
  assert.equal(denied.ok, false);
  assert.equal(gets, 0);
  cache.approve('private:1');
  assert.deepEqual(await cache.load('private:1', async () => { fetches++; return image; }), image);
  assert.equal(gets, 1);
  assert.equal(fetches, 1);
  const cache2 = create({ storage: { get: async () => null } }); cache2.setScope('new-receiver');
  cache2.approve('private:1');
  await cache2.load('private:1', async () => { fetches++; return image; });
  assert.equal(fetches, 2, 'receiver without a downloaded image must call original receipt endpoint');
});

test('scope changes and recall/delete reject late responses and memory hits', async () => {
  const writes = [];
  const cache = create({ storage: { put: async (...args) => writes.push(args) } });
  cache.setScope('old');
  const pending = deferred();
  const request = cache.load('private:1', () => pending.promise);
  cache.setScope('new'); pending.resolve(image);
  await assert.rejects(request, { code: 'MEDIA_STALE' });
  await settle(); assert.equal(writes.length, 0);
  const pending2 = deferred();
  const request2 = cache.load('library:2', () => pending2.promise);
  cache.invalidate('library:2'); pending2.resolve(image);
  await assert.rejects(request2, { code: 'MEDIA_STALE' });
  cache.seed('private:3', image);
  const hit = cache.load('private:3', async () => image);
  cache.invalidate('private:3');
  await assert.rejects(hit, { code: 'MEDIA_STALE' });
});

test('storage failure, expiry, LRU limits and fresh-list removal remain safe', async () => {
  let time = 1000, calls = 0;
  const cache = create({ now: () => time, ttl: 100, maxBytes: image.image.length,
    storage: { get: async () => { throw new Error('blocked'); }, put: async () => { throw new Error('quota'); } } });
  cache.setScope('a');
  const loader = async () => { calls++; return image; };
  cache.approve('library:1'); await cache.load('library:1', loader);
  await cache.load('library:2', loader);
  await cache.load('library:1', loader);
  assert.equal(calls, 3, 'LRU bound evicts older image');
  time += 101; await cache.load('library:1', loader);
  assert.equal(calls, 4);
  cache.reconcile('library:', ['library:2']);
  await cache.load('library:1', loader);
  assert.equal(calls, 5);
  assert.equal(createStorage({}), null);
  assert.equal(createStorage({ get indexedDB() { throw new Error('SecurityError'); } }), null);
  await settle();
});

test('latest-idea metadata requests coalesce only while pending and retain RPC fallback', async () => {
  let calls = 0, fallback = 0;
  const pending = deferred();
  const context = vm.createContext({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON: 'test',
    setTimeout, clearTimeout, AbortController,
    fetch: async (url, options) => { calls++; assert.ok(url.includes('select=id,idea_date,title,updated_at')); assert.equal(options.cache, 'no-store'); return pending.promise; },
    sbRpc: async name => { fallback++; assert.equal(name, 'list_daily_ideas'); return { ok: true, list: [] }; }
  });
  vm.runInContext('let latestIdeaRequest = null;\n' + fn(app, 'fetchLatestDailyIdea', ''), context);
  const first = context.fetchLatestDailyIdea(), second = context.fetchLatestDailyIdea();
  assert.equal(first, second);
  pending.resolve({ ok: true, json: async () => [{ id: 1 }] });
  await first; assert.equal(calls, 1);
  await context.fetchLatestDailyIdea(); assert.equal(calls, 2, 'no TTL/result caching');
  context.fetch = async () => ({ ok: false });
  await context.fetchLatestDailyIdea(); assert.equal(fallback, 1);
});

test('image receipt checks continue for unseen images, stop only once all visible images are seen', async () => {
  let unseen = false, calls = 0;
  const context = vm.createContext({ currentRoom: 'private', currentPrivateConversationId: 'c',
    __user: { loggedIn: true, token: 'test' }, console,
    document: { getElementById: () => ({ querySelector: selector => {
      assert.equal(selector, '.chat-image-seen-status:not(.seen)'); return unseen ? {} : null;
    } }) },
    sbRpc: async name => { calls++; assert.equal(name, 'list_private_image_receipts'); return []; }
  });
  vm.runInContext(fn(chat, 'refreshPrivateImageSeenStatuses'), context);
  await context.refreshPrivateImageSeenStatuses(); assert.equal(calls, 0);
  unseen = true;
  await context.refreshPrivateImageSeenStatuses(); assert.equal(calls, 1);
  await context.refreshPrivateImageSeenStatuses(); assert.equal(calls, 2);
});

test('real browser: IndexedDB reuse, account cleanup and gallery reorder/delete races', { skip: !process.env.BLYS_TEST_BROWSER }, async t => {
  const { chromium } = require('playwright');
  const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="chatLibraryModal" hidden><div id="chatLibraryGrid"></div></div><div id="chatImageViewer" hidden></div><div id="chatMessages"></div>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = 'http://127.0.0.1:' + server.address().port;
  async function init() {
    await page.goto(url);
    await page.addScriptTag({ path: path.join(root, 'public/assets/chat-media-cache.js') });
  }
  await init();
  const first = await page.evaluate(async image => {
    window.storage = BlysMediaCache.createStorage();
    window.cache = BlysMediaCache.create({ storage });
    cache.setScope('secret-token-A'); cache.approve('private:1');
    await cache.load('private:1', async () => image);
    for (let i = 0; i < 30 && !await storage.get('secret-token-A', 'private:1'); i++) await new Promise(r => setTimeout(r, 20));
    const entry = await storage.get('secret-token-A', 'private:1');
    return entry && entry.value.image;
  }, image);
  assert.equal(first, image.image);
  await init();
  assert.equal(await page.evaluate(async () => {
    window.storage = BlysMediaCache.createStorage(); window.cache = BlysMediaCache.create({ storage });
    cache.setScope('secret-token-A'); cache.approve('private:1');
    return (await cache.load('private:1', () => { throw new Error('must use disk cache after reload'); })).image;
  }), image.image);
  assert.equal(await page.evaluate(async () => {
    cache.setScope('different-account');
    for (let i = 0; i < 30; i++) {
      if (!await storage.get('secret-token-A', 'private:1')) return true;
      await new Promise(r => setTimeout(r, 20));
    }
    return false;
  }), true, 'logout/account switch purges old account bytes');

  const functions = ['getChatMediaScope', 'getChatMediaCache', 'closeChatImageViewer', 'openChatImageLibrary', 'closeChatImageLibrary', 'renderChatImageLibrary', 'loadChatImageLibraryPreviews', 'moveChatLibraryImage', 'deleteChatLibraryImage'];
  await page.addScriptTag({ content: `
    var __user = { loggedIn:true, token:'admin-test',email:'test',isAdmin:true }, currentRoom='private',currentPrivateConversationId='c';
    var chatImageLibraryItems=[],chatLibraryLoadVersion=0,chatMediaCache=null,chatMediaScopeValue=null;
    function isBlysAdminUser(){return true;}
    function esc(value){return String(value || '').replace(/"/g, '&quot;');}
    window.confirm=()=>true;window.alert=message=>{throw new Error(message);};
    var imageCalls=0,listCalls=0,pendingImages={},serverItems=[{id:'a',file_name:'A'},{id:'b',file_name:'B'}];
    async function sbRpc(name,p){
      if(name==='admin_private_image_library_list'){listCalls++;return {ok:true,list:serverItems.map(item=>({...item}))};}
      if(name==='admin_private_image_library_get'){imageCalls++;return new Promise(resolve=>pendingImages[p.p_id]=resolve);}
      if(name==='admin_private_image_library_delete'){serverItems=serverItems.filter(item=>item.id!==p.p_id);return {ok:true};}
      return {ok:true};
    }
    ${functions.map(name => fn(chat, name)).join('\n')}
  ` });
  await page.evaluate(() => openChatImageLibrary());
  await page.waitForFunction(() => !!pendingImages.a);
  await page.evaluate(() => moveChatLibraryImage(0, 1));
  await page.evaluate(image => pendingImages.a(image), image);
  await page.waitForFunction(() => !!pendingImages.b);
  assert.equal(await page.locator('[data-library-select="1"] img').getAttribute('alt'), 'A', 'late image follows its ID after sort');
  await page.evaluate(image => pendingImages.b(image), image);
  await page.waitForFunction(() => chatImageLibraryItems.every(item => item.image));
  await page.evaluate(async () => { closeChatImageLibrary(); await openChatImageLibrary(); });
  assert.deepEqual(await page.evaluate(() => ({ images: imageCalls, lists: listCalls })), { images: 2, lists: 2 });
  await page.evaluate(async () => {
    serverItems.push({id:'c',file_name:'C'});
    await openChatImageLibrary();
  });
  await page.waitForFunction(() => !!pendingImages.c);
  await page.evaluate(async () => deleteChatLibraryImage(chatImageLibraryItems.findIndex(item => item.id === 'c')));
  await page.evaluate(image => pendingImages.c(image), image);
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => chatImageLibraryItems.some(item => item.id === 'c')), false, 'deleted image is not resurrected by late response');
});
