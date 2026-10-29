/* 过词：专注一次性筛词。WordParser comes from Losecloud/Word-Memo (MIT). */
'use strict';
(() => {
  const KEY = 'guoci.v1';
  const $ = id => document.getElementById(id);
  const key = text => String(text || '').trim().toLowerCase();
  const id = () => 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const clone = value => JSON.parse(JSON.stringify(value));
  const dictionary = window.GUOCI_DICTIONARY || {};
  const dictionaryRevisions = window.GUOCI_DICTIONARY_REVISIONS || {};
  const own = (object, property) => Object.prototype.hasOwnProperty.call(object, property);
  let persisted, state, viewingBook, editingWord, busy = false, toastTimer;

  function definitions(word) {
    return (word.definitions || []).map(d => [d.pos, d.meaning].filter(Boolean).join(' ')).filter(Boolean).join('\n');
  }
  function hasMeaning(word) { return (word.definitions || []).some(d => String(d.meaning || '').trim()); }
  function normalize(raw) {
    const text = WordParser.cleanWord(String(typeof raw === 'string' ? raw : raw.word || ''));
    if (!WordParser.isValidEnglishWord(text)) return null;
    const result = { word: text, phonetic: String(raw.phonetic || ''), definitions: [], meaningSource: raw.meaningSource === 'manual' ? 'manual' : 'provided' };
    if (Array.isArray(raw.definitions)) result.definitions = raw.definitions.map(d => ({ pos: String(d.pos || ''), meaning: String(d.meaning || ''), example: String(d.example || '') }));
    else result.definitions = [{ pos: String(raw.pos || ''), meaning: String(raw.meaning || raw.translation || ''), example: '' }];
    if (!hasMeaning(result)) {
      const entry = own(dictionary, key(text)) ? dictionary[key(text)] : null;
      if (Array.isArray(entry)) {
        result.phonetic ||= entry[0] || '';
        result.definitions = [{ pos: '', meaning: String(entry[1] || ''), example: '' }];
        result.meaningSource = 'dictionary';
      }
    }
    return result;
  }
  function unique(words) {
    const map = new Map();
    for (const raw of words) {
      if (!raw || !['string', 'object'].includes(typeof raw)) continue;
      const word = normalize(raw);
      if (!word) continue;
      const old = map.get(key(word.word));
      if (!old || (!hasMeaning(old) && hasMeaning(word))) map.set(key(word.word), word);
    }
    return [...map.values()];
  }
  function initial() {
    return { version: 1, books: [
      { id: 'sample', name: '示例 · 已学单词', words: unique(WordParser.getDemoWords().slice(0, 8)) },
      { id: 'forgotten', name: '待复习', words: [] }
    ], sourceId: 'sample', targetId: 'forgotten', shuffle: false, session: null };
  }
  function valid(data) {
    return data && data.version === 1 && Array.isArray(data.books) && data.books.every(b => b && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.words));
  }
  function warn(message) { $('storageWarning').hidden = false; $('storageWarning').textContent = message; }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600); }
  try {
    persisted = localStorage.getItem(KEY);
    if (persisted !== null) {
      state = JSON.parse(persisted);
      if (!valid(state)) throw new Error('已保存数据的格式异常');
    } else state = initial();
  } catch (e) {
    warn('无法读取本地存储：' + e.message + '。为保护已有数据，本页不会覆盖存储；可导出备份后检查浏览器设置。');
    state = initial();
    persisted = undefined;
  }
  function commit(change) {
    if (persisted === undefined) throw new Error('本地存储不可用，未保存此次操作。请先检查浏览器设置。');
    if (localStorage.getItem(KEY) !== persisted) throw new Error('另一个窗口修改了数据。请刷新此页后继续，以免覆盖。');
    const next = clone(state);
    change(next);
    const json = JSON.stringify(next);
    try { localStorage.setItem(KEY, json); }
    catch (e) { warn('保存失败，可能是浏览器空间不足。此次操作未生效，请先备份全部数据。'); throw new Error('保存失败，请先备份全部。'); }
    state = next;
    persisted = json;
  }
  function book(bookId, data = state) { return data.books.find(b => b.id === bookId); }
  function localDay() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  function dailyState(data = state) {
    const target = Number.isInteger(data.daily?.target) && data.daily.target >= 1 && data.daily.target <= 10000 ? data.daily.target : 100;
    const words = data.daily?.date === localDay() && Array.isArray(data.daily.words) ? [...new Set(data.daily.words.map(key).filter(Boolean))] : [];
    return { date: localDay(), target, words };
  }
  function countToday(data, word) {
    data.daily = dailyState(data);
    const wordKey = key(word.word);
    if (!data.daily.words.includes(wordKey)) data.daily.words.push(wordKey);
  }
  function renderDaily() {
    const daily = dailyState(), count = daily.words.length;
    $('dailyCount').textContent = count;
    $('dailyTarget').textContent = `/ ${daily.target} 词`;
    $('dailyMessage').textContent = count >= daily.target ? '今日目标已完成 ✓' : `还差 ${daily.target - count} 词`;
    $('dailyFill').style.width = `${Math.min(100, count / daily.target * 100)}%`;
    $('dailyProgress').setAttribute('aria-valuemax', daily.target);
    $('dailyProgress').setAttribute('aria-valuenow', Math.min(count, daily.target));
    $('dailyProgress').setAttribute('aria-valuetext', `今天已过 ${count} 个不同单词，目标 ${daily.target} 个`);
  }
  function refreshDay() {
    if (state.daily?.date !== localDay() && persisted !== undefined) commit(data => { data.daily = dailyState(data); });
    renderDaily();
  }
  function fillMissingMeanings(data) {
    const fill = w => {
      if (hasMeaning(w)) return;
      const filled = normalize(w);
      if (filled && hasMeaning(filled)) Object.assign(w, filled);
    };
    data.books.forEach(b => b.words.forEach(fill));
    if (data.session) {
      data.session.queue.forEach(fill);
      if (data.session.last) fill(data.session.last.word);
    }
  }
  function option(select, value, text) { const el = document.createElement('option'); el.value = value; el.textContent = text; select.append(el); }
  function renderSetup() {
    $('source').replaceChildren(); $('target').replaceChildren();
    for (const b of state.books) {
      option($('source'), b.id, `${b.name}（${b.words.length}）`);
      if (b.id !== state.sourceId) option($('target'), b.id, b.name);
    }
    $('source').value = state.sourceId;
    $('target').value = state.targetId;
    $('shuffle').checked = state.shuffle;
    const source = book(state.sourceId);
    const missing = source ? source.words.filter(w => !hasMeaning(w)).length : 0;
    $('setupInfo').textContent = missing ? `${missing} 个词缺少释义，可在单词本「查看」中勾选「只看暂无释义」后逐个编辑。` : '每个词只过一次，不记得的词自动归集，不会反复插回。';
    $('start').disabled = !source?.words.length || !book(state.targetId) || state.sourceId === state.targetId;
    $('resume').hidden = !state.session;
    if (state.session) $('resume').textContent = `继续「${book(state.session.sourceId)?.name || '上次过词'}」 · ${state.session.index} / ${state.session.queue.length}`;
  }
  function button(label, handler) { const el = document.createElement('button'); el.textContent = label; el.addEventListener('click', guard(handler)); return el; }
  function oldDictionaryMeaning(word) {
    const wordKey = key(word.word);
    const revision = own(dictionaryRevisions, wordKey) ? dictionaryRevisions[wordKey] : null;
    return word.meaningSource !== 'manual' && revision && word.definitions?.length === 1 && !word.definitions[0].pos && word.definitions[0].meaning === revision.before ? revision : null;
  }
  function updateDictionaryMeanings(bookId) {
    const target = book(bookId);
    const keys = new Set(target.words.filter(oldDictionaryMeaning).map(w => key(w.word)));
    if (!keys.size) return;
    if (!confirm(`更新「${target.name}」中 ${keys.size} 个词的旧词库释义？\n只替换与旧词库文本完全相同的释义，并同步其他单词本和当前队列；你重新填写的不同内容会保留。建议先备份全部。`)) return;
    commit(data => {
      const update = w => {
        const revision = keys.has(key(w.word)) && oldDictionaryMeaning(w);
        if (revision) {
          w.previousDictionaryMeaning = revision.before;
          w.definitions = [{pos: '', meaning: revision.after, example: ''}];
          w.meaningSource = 'dictionary';
        }
      };
      data.books.forEach(b => b.words.forEach(update));
      if (data.session) { data.session.queue.forEach(update); if (data.session.last) update(data.session.last.word); }
    });
    renderBooks(); renderSetup();
    toast(`已更新 ${keys.size} 个词的旧词库释义，过词进度保留。`);
  }
  function renderBooks() {
    $('bookCount').textContent = state.books.length;
    $('books').replaceChildren();
    state.books.forEach(b => {
      const item = document.createElement('article'); item.className = 'book';
      const icon = document.createElement('span'); icon.className = 'book-icon'; icon.textContent = '▤';
      const title = document.createElement('h3'); title.textContent = b.name;
      const info = document.createElement('p'); const missing = b.words.filter(w => !hasMeaning(w)).length;
      info.textContent = `${b.words.length} 个单词${missing ? ' · ' + missing + ' 个缺释义' : ''}`;
      const actions = document.createElement('div'); actions.className = 'book-actions';
      const remove = button('删除', () => deleteBook(b.id)); remove.className = 'danger';
      actions.append(
        button('选中过词', () => { setSource(b.id); $('start').focus(); }),
        button('查看', () => view(b.id)),
        button('导出 CSV', () => exportCSV(b.id)),
        button('导出 JSON', () => download(b.name + '.json', JSON.stringify({ version: 1, name: b.name, words: b.words }, null, 2), 'application/json')),
        remove
      );
      if (missing) actions.append(button(`补全释义（${missing}）`, () => view(b.id, true)));
      const outdated = b.words.filter(oldDictionaryMeaning).length;
      if (outdated) actions.append(button(`更新词库释义（${outdated}）`, () => updateDictionaryMeanings(b.id)));
      item.append(icon, title, info, actions); $('books').append(item);
    });
  }
  function library() { $('review').hidden = true; $('library').hidden = false; refreshDay(); renderSetup(); renderBooks(); window.scrollTo(0, 0); }
  function setSource(sourceId) {
    commit(data => {
      data.sourceId = sourceId;
      if (data.targetId === sourceId) data.targetId = data.books.find(b => b.id !== sourceId)?.id || '';
    }); renderSetup();
  }
  function deleteBook(bookId) {
    const target = book(bookId);
    if (!target) throw new Error('单词本不存在。');
    if (state.books.length <= 1) throw new Error('至少保留一个单词本，不能删除最后一本。');
    const hasSession = state.session && (state.session.sourceId === bookId || state.session.targetId === bookId);
    const note = hasSession ? '这会同时清除当前未完成的过词进度。' : '删除后无法从本机恢复，建议先导出备份。';
    if (!confirm(`确定删除「${target.name}」吗？\n${note}`)) return;
    commit(data => {
      data.books = data.books.filter(b => b.id !== bookId);
      const first = data.books[0];
      if (!data.books.some(b => b.id === data.sourceId)) data.sourceId = first?.id || '';
      if (!data.books.some(b => b.id === data.targetId) || data.targetId === data.sourceId) data.targetId = data.books.find(b => b.id !== data.sourceId)?.id || '';
      if (data.session && (data.session.sourceId === bookId || data.session.targetId === bookId)) data.session = null;
    });
    library();
    toast(`已删除「${target.name}」。`);
  }
  function start() {
    const source = book(state.sourceId);
    if (!source?.words.length || !book(state.targetId) || state.targetId === source.id) throw new Error('请选择不同的来源和接收单词本。');
    if (state.session && state.session.index < state.session.queue.length && !confirm('开始新的一遍会替换未完成的过词进度。已归集的单词仍会保留。继续吗？')) return;
    commit(data => {
      const queue = clone(source.words);
      if (data.shuffle) for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
      data.session = { sourceId: source.id, targetId: data.targetId, queue, index: 0, remembered: 0, forgotten: 0, corrected: [], last: null, revealed: false };
    }); renderReview(); window.scrollTo(0, 0);
  }
  function add(data, word) {
    const target = book(data.session.targetId, data);
    if (!target) throw new Error('接收单词本不存在，请回到单词本重新开始。');
    const found = target.words.find(w => key(w.word) === key(word.word));
    if (!found) target.words.push(clone(word));
    else if (!hasMeaning(found) && hasMeaning(word)) Object.assign(found, clone(word));
  }
  function inTarget(word) { return book(state.session.targetId)?.words.some(w => key(w.word) === key(word.word)); }
  function renderReview() {
    const s = state.session; if (!s) return library();
    $('library').hidden = true; $('review').hidden = false;
    $('sessionName').textContent = book(s.sourceId)?.name || '过词';
    $('progressText').textContent = `${s.index} / ${s.queue.length}`;
    $('progressFill').style.width = (s.queue.length ? s.index / s.queue.length * 100 : 0) + '%';
    const target = book(s.targetId);
    $('targetNote').textContent = '遗忘词 → ' + (target?.name || '未设置');
    $('previous').hidden = !s.last;
    if (s.last) {
      $('previousWord').textContent = s.last.word.word;
      $('previousMeaning').textContent = definitions(s.last.word) || '暂无释义（可在源单词本重新导入补充）';
      const added = inTarget(s.last.word);
      $('previousAction').textContent = added ? '✓ 已在「' + target.name + '」' : '记错了？点击加入 ↗';
      $('previous').setAttribute('aria-label', `上一词 ${s.last.word.word}：${definitions(s.last.word) || '暂无释义'}。${added ? '已加入接收单词本' : '点击加入接收单词本'}`);
    }
    const done = s.index >= s.queue.length;
    $('finished').hidden = !done; $('currentCard').hidden = done;
    if (done) {
      $('summary').textContent = `共 ${s.queue.length} 个词 · 记得 ${s.remembered} · 不记得 ${s.forgotten} · 上一词补选 ${s.corrected.length}`;
      $('finishTarget').textContent = `「${target?.name || ''}」现有 ${target?.words.length || 0} 个词（按英文去重）。`;
      return;
    }
    const word = s.queue[s.index];
    $('wordNumber').textContent = `WORD ${String(s.index + 1).padStart(2, '0')}`;
    $('word').textContent = word.word; $('phonetic').textContent = word.phonetic;
    $('prompt').hidden = s.revealed; $('answer').hidden = !s.revealed;
    $('meaning').textContent = definitions(word) || '词典未收录此词。请点击右上方「补充 / 修改释义」，或导入带中文释义的单词表。';
    $('added').textContent = `✓ 已加入「${target?.name || ''}」`;
    $('answerButtons').hidden = s.revealed; $('next').hidden = !s.revealed;
  }
  function answer(remembered) {
    const s = state.session; if (!s || s.index >= s.queue.length) return;
    commit(data => {
      const session = data.session, word = session.queue[session.index];
      if (session.revealed) { session.last = { word: clone(word), remembered: false }; session.index++; session.revealed = false; }
      else if (remembered) { countToday(data, word); session.remembered++; session.last = { word: clone(word), remembered: true }; session.index++; }
      else { countToday(data, word); add(data, word); session.forgotten++; session.revealed = true; }
    }); renderReview(); renderDaily();
    document.activeElement?.blur();
  }
  function correctPrevious() {
    const s = state.session; if (!s?.last) return;
    if (inTarget(s.last.word)) return toast('这个词已经在接收单词本中。');
    commit(data => {
      const session = data.session; add(data, session.last.word);
      if (session.last.remembered && !session.corrected.includes(key(session.last.word.word))) session.corrected.push(key(session.last.word.word));
    }); renderReview(); toast('已将上一词加入「' + book(state.session.targetId).name + '」。');
  }
  function guard(fn) { return async event => { try { await fn(event); } catch (e) { toast(e.message || '操作失败'); } }; }
  function on(id, event, fn) { $(id).addEventListener(event, guard(fn)); }
  function download(name, text, type = 'text/plain') {
    const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const csv = value => '"' + String(value || '').replace(/"/g, '""') + '"';
  function exportCSV(bookId) {
    const b = book(bookId); if (!b) throw new Error('单词本不存在。');
    const rows = [['word', 'phonetic', 'pos', 'meaning'], ...b.words.map(w => [w.word, w.phonetic, w.definitions?.length === 1 ? w.definitions[0].pos : '', w.definitions?.length === 1 ? w.definitions[0].meaning : definitions(w)])];
    download(b.name + '.csv', '\uFEFF' + rows.map(row => row.map(csv).join(',')).join('\r\n'), 'text/csv');
  }
  // RFC 4180：保留引号、逗号、单元格内换行；也接受 Tab 分隔的粘贴数据。
  function table(text, separator) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if (c === separator && !quoted) { row.push(cell.trim()); cell = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (quoted) throw new Error('CSV 中的引号没有闭合，请检查文件。');
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  function parse(text, fileName = '') {
    text = text.replace(/^\uFEFF/, '').trim();
    if (!text) return [];
    if (/\.json$/i.test(fileName) || /^[\[{]/.test(text)) {
      const json = JSON.parse(text);
      if (Array.isArray(json.books)) throw new Error('这是完整备份，请使用右上角「恢复备份」。');
      const words = Array.isArray(json) ? json : json.words;
      if (!Array.isArray(words)) throw new Error('JSON 需为单词数组，或包含 words 数组。');
      return words;
    }
    const first = text.split(/\r?\n/)[0];
    const separator = first.includes('\t') ? '\t' : first.includes(',') ? ',' : '\t';
    const rows = table(text, separator);
    if (!rows.length) return [];
    const aliases = { word: ['word', '单词', '英文', 'term'], phonetic: ['phonetic', '音标'], pos: ['pos', '词性'], meaning: ['meaning', '释义', '中文释义', '中文', 'translation'] };
    const header = rows[0].map(key);
    const mapped = field => header.findIndex(h => aliases[field].includes(h));
    const hasHeader = mapped('word') >= 0;
    return (hasHeader ? rows.slice(1) : rows).map(row => {
      if (hasHeader) return { word: row[mapped('word')] || '', phonetic: row[mapped('phonetic')] || '', pos: row[mapped('pos')] || '', meaning: row[mapped('meaning')] || '' };
      return { word: row[0], pos: row.length >= 3 ? row[1] : '', meaning: row.length >= 3 ? row.slice(2).join(separator) : row[1] || '' };
    });
  }
  function view(bookId, missingOnly = false) { viewingBook = bookId; $('viewTitle').textContent = book(bookId).name; $('wordSearch').value = ''; $('missingOnly').checked = missingOnly; renderWordList(); $('bookDialog').showModal(); }
  function openEditor(word, origin) {
    if (!word) throw new Error('单词不存在。');
    editingWord = { key: key(word.word), origin };
    $('editTitle').textContent = word.word + ' · 修改释义';
    $('editPhonetic').value = word.phonetic || '';
    $('editPos').value = word.definitions?.length === 1 ? word.definitions[0].pos : '';
    $('editMeaning').value = word.definitions?.length === 1 ? word.definitions[0].meaning : definitions(word);
    $('editStatus').textContent = '';
    $('editDialog').showModal();
  }
  function deleteWord(bookId, wordText) {
    const target = book(bookId);
    const wordKey = key(wordText);
    const removed = target?.words.find(w => key(w.word) === wordKey);
    if (!target || !removed) throw new Error('单词不存在。');
    const session = state.session;
    const affectsQueue = session?.sourceId === bookId && session.queue.some(w => key(w.word) === wordKey);
    const note = affectsQueue ? '这个单词也会从当前未完成的过词进度中移除。' : '删除后无法从本机恢复，建议先导出备份。';
    if (!confirm(`确定从「${target.name}」删除「${removed.word}」吗？\n${note}`)) return;
    commit(data => {
      const currentBook = book(bookId, data);
      currentBook.words = currentBook.words.filter(w => key(w.word) !== wordKey);
      const currentSession = data.session;
      if (!currentSession) return;
      if (currentSession.sourceId === bookId) {
        const removedBefore = currentSession.queue.slice(0, currentSession.index).filter(w => key(w.word) === wordKey).length;
        currentSession.queue = currentSession.queue.filter(w => key(w.word) !== wordKey);
        currentSession.index = Math.max(0, Math.min(currentSession.index - removedBefore, currentSession.queue.length));
      }
      if (currentSession.last && key(currentSession.last.word.word) === wordKey) currentSession.last = null;
      if (Array.isArray(currentSession.corrected)) currentSession.corrected = currentSession.corrected.filter(k => k !== wordKey);
    });
    renderWordList(); renderSetup(); renderBooks();
    toast(`已从「${target.name}」删除「${removed.word}」。`);
  }
  function renderWordList() {
    const words = book(viewingBook)?.words || [], search = key($('wordSearch').value);
    $('wordList').replaceChildren();
    const missing = words.filter(w => !hasMeaning(w)).length;
    const filtered = words.filter(w => (!$('missingOnly').checked || !hasMeaning(w)) && key(w.word + ' ' + definitions(w)).includes(search));
    $('wordListCount').textContent = `显示 ${filtered.length} / ${words.length} 词 · ${missing} 个缺释义`;
    filtered.slice(0, 300).forEach(w => {
      const row = document.createElement('div'); row.className = 'word-row';
      const term = document.createElement('strong'); term.textContent = w.word;
      const meaning = document.createElement('span'); meaning.textContent = hasMeaning(w) ? definitions(w) : '暂无释义';
      if (!hasMeaning(w)) meaning.className = 'missing-meaning';
      const actions = document.createElement('div'); actions.className = 'word-actions';
      const edit = button(hasMeaning(w) ? '编辑' : '添加释义', () => openEditor(w, 'library')); edit.className = 'small';
      edit.setAttribute('aria-label', `编辑 ${w.word} 的释义`);
      const remove = button('删除', () => deleteWord(viewingBook, w.word)); remove.className = 'danger small';
      actions.append(edit, remove);
      row.append(term, meaning, actions); $('wordList').append(row);
    });
    if (!filtered.length) $('wordList').textContent = search ? '没有匹配的单词。' : $('missingOnly').checked ? '本单词本没有缺释义的单词。' : '还没有单词。';
    if (filtered.length > 300) { const hint = document.createElement('p'); hint.className = 'help'; hint.textContent = `共 ${filtered.length} 个匹配，仅显示前 300 个。可搜索缩小范围，导出包含全部单词。`; $('wordList').append(hint); }
  }
  on('home', 'click', e => { e.preventDefault(); library(); });
  ['leave', 'finishHome'].forEach(x => on(x, 'click', library));
  on('source', 'change', () => setSource($('source').value));
  on('target', 'change', () => commit(data => { data.targetId = $('target').value; }));
  on('shuffle', 'change', () => commit(data => { data.shuffle = $('shuffle').checked; }));
  on('start', 'click', start); on('again', 'click', () => { commit(data => { data.sourceId = data.session.sourceId; data.targetId = data.session.targetId; }); start(); });
  on('resume', 'click', () => { renderReview(); window.scrollTo(0, 0); });
  on('remember', 'click', () => answer(true)); on('forgot', 'click', () => answer(false)); on('next', 'click', () => answer(true));
  on('previous', 'click', correctPrevious);
  on('newTarget', 'click', () => $('nameDialog').showModal());
  on('nameForm', 'submit', e => { e.preventDefault(); const name = $('targetName').value.trim(); if (!name) throw new Error('请输入名称。'); commit(data => { const newId = id(); data.books.push({ id: newId, name, words: [] }); data.targetId = newId; }); $('nameDialog').close(); renderSetup(); renderBooks(); });
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => $(el.dataset.close).close()));
  on('importOpen', 'click', () => { $('importBook').replaceChildren(); option($('importBook'), '', '新建单词本'); state.books.forEach(b => option($('importBook'), b.id, b.name)); $('importStatus').textContent = ''; $('importFile').value = ''; $('importText').value = ''; $('bookName').value = ''; $('nameLabel').hidden = false; $('importDialog').showModal(); });
  on('importBook', 'change', () => { $('nameLabel').hidden = !!$('importBook').value; });
  on('importFile', 'change', () => { const file = $('importFile').files[0]; if (file && !$('bookName').value) $('bookName').value = file.name.replace(/\.[^.]+$/, ''); $('importStatus').textContent = file ? '将导入所选文件；若下方也有粘贴内容，会一同导入并去重。' : ''; });
  on('importForm', 'submit', async e => {
    e.preventDefault(); if (busy) return; busy = true; $('importSubmit').disabled = true;
    try {
      let raw = [];
      const file = $('importFile').files[0];
      if (file) { if (file.size > 20 * 1024 * 1024) throw new Error('单文件请控制在 20 MB 内。'); raw.push(...parse(await file.text(), file.name)); }
      raw.push(...parse($('importText').value));
      const words = unique(raw); if (!words.length) throw new Error('没有识别到有效英文单词，请检查格式。');
      let importedId = $('importBook').value; let added = 0;
      const name = $('bookName').value.trim() || '导入的单词';
      commit(data => {
        if (!importedId) { importedId = id(); data.books.push({ id: importedId, name, words: [] }); }
        const target = book(importedId, data), map = new Map(target.words.map(w => [key(w.word), w]));
        for (const word of words) { const old = map.get(key(word.word)); if (old) { if (hasMeaning(word) || !hasMeaning(old)) Object.assign(old, word); } else { target.words.push(word); map.set(key(word.word), word); added++; } }
        data.sourceId = importedId; if (data.targetId === importedId) data.targetId = data.books.find(b => b.id !== importedId)?.id || '';
      });
      $('importDialog').close(); library(); toast(`识别 ${words.length} 词，新增 ${added} 词，更新 ${words.length - added} 词；忽略无效或重复行 ${raw.length - words.length}。`);
    } catch (error) { $('importStatus').textContent = error.message; } finally { busy = false; $('importSubmit').disabled = false; }
  });
  on('backup', 'click', () => download('过词-完整备份-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(state, null, 2), 'application/json'));
  on('restore', 'change', async () => {
    const input = $('restore'); const file = input.files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份请控制在 20 MB 内。');
      const imported = JSON.parse(await file.text()); if (!valid(imported)) throw new Error('不是兼容的过词备份文件。');
      // 非破坏性恢复：生成新 ID 并保留现有单词本，不载入不可信的会话状态。
      commit(data => { imported.books.forEach(b => data.books.push({ id: id(), name: b.name.slice(0, 80) + '（恢复）', words: unique(b.words) })); });
      library(); toast(`已恢复 ${imported.books.length} 本单词本；现有数据已保留。`);
    } finally { input.value = ''; }
  });
  on('exportTarget', 'click', () => exportCSV(state.session.targetId));
  on('wordSearch', 'input', renderWordList);
  on('missingOnly', 'change', renderWordList);
  on('goalOpen', 'click', () => { $('goalInput').value = dailyState().target; $('goalStatus').textContent = ''; $('goalDialog').showModal(); });
  on('goalForm', 'submit', e => {
    e.preventDefault();
    try {
      const target = Number($('goalInput').value);
      if (!Number.isInteger(target) || target < 1 || target > 10000) throw new Error('请输入 1～10000 之间的整数。');
      commit(data => { data.daily = { ...dailyState(data), target }; });
      $('goalDialog').close(); renderDaily();
    } catch (error) { $('goalStatus').textContent = error.message; }
  });
  on('editWord', 'click', () => openEditor(state.session?.queue[state.session.index], 'review'));
  on('editForm', 'submit', e => {
    e.preventDefault();
    try {
      if (!editingWord) throw new Error('请重新选择要编辑的单词。');
      const meaning = $('editMeaning').value.trim(); if (!meaning) throw new Error('请输入中文释义。');
      commit(data => {
        const updated = { phonetic: $('editPhonetic').value.trim(), definitions: [{ pos: $('editPos').value.trim(), meaning, example: '' }], meaningSource: 'manual' };
        const update = w => { if (key(w.word) === editingWord.key) Object.assign(w, clone(updated)); };
        data.books.forEach(b => b.words.forEach(update));
        if (data.session) { data.session.queue.forEach(update); if (data.session.last) update(data.session.last.word); }
      });
      const origin = editingWord.origin;
      editingWord = null; $('editDialog').close();
      if (origin === 'review') renderReview();
      else { renderWordList(); renderSetup(); renderBooks(); }
    } catch (error) { $('editStatus').textContent = error.message; }
  });
  document.addEventListener('keydown', guard(e => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || $('review').hidden || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
    const s = state.session; if (!s || s.index >= s.queue.length) return;
    if (e.key === '1' || (e.key === 'Enter' && s.revealed)) { e.preventDefault(); answer(true); }
    else if (e.key === '2' && !s.revealed) { e.preventDefault(); answer(false); }
  }));
  window.addEventListener('storage', e => { if (e.key === KEY) warn('另一窗口已修改数据，请刷新后继续。'); });
  if (persisted !== undefined) {
    try {
      commit(data => { fillMissingMeanings(data); data.daily = dailyState(data); });
    } catch (error) { warn(error.message); }
  }
  window.addEventListener('focus', guard(refreshDay));
  document.addEventListener('visibilitychange', guard(() => { if (!document.hidden) refreshDay(); }));
  setInterval(guard(() => { if (state.daily?.date !== localDay()) refreshDay(); }), 1000);
  library();
})();
