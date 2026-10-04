/**
 * 用户端智能客服（流式对话 · 重构版）
 * 功能：深度思考区块 / 联网搜索区块（可折叠）/ 快捷 chip / sessionStorage 历史保留
 * 依赖 user/js/core.js 的 showToast / switchUserTab
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var CONVERSATION_KEY = 'foxmc_ai_conversation_id';
  function loadConversationId() {
    try { return sessionStorage.getItem(CONVERSATION_KEY) || ''; } catch (e) { return ''; }
  }
  function saveConversationId(id) {
    try { if (id) sessionStorage.setItem(CONVERSATION_KEY, id); } catch (e) {}
  }
  function clearConversationId() {
    try { sessionStorage.removeItem(CONVERSATION_KEY); } catch (e) {}
  }

  /* ── SSE 流式请求封装 ── */
  function streamChat(payload, handlers) {
    var controller = new AbortController();
    var settled = false;
    function finishDone(data) {
      if (settled) return;
      settled = true;
      if (handlers.onDone) handlers.onDone(data);
    }
    function finishError(message, data) {
      if (settled) return;
      settled = true;
      if (handlers.onError) handlers.onError(message, data || {});
    }
    var body = new FormData();
    Object.keys(payload).forEach(function (k) { body.append(k, payload[k]); });

    fetch('ai_chat.php', { method: 'POST', body: body, signal: controller.signal })
      .then(function (resp) {
        var ct = resp.headers.get('Content-Type') || '';
        if (!resp.ok || ct.indexOf('text/event-stream') === -1) {
          return resp.text().then(function (t) {
            var msg = '请求失败';
            var data = null;
            try { data = JSON.parse(t); msg = data.message || msg; } catch (e) {}
            finishError(msg, data);
            throw new Error('non-sse');
          });
        }
        var reader = resp.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buffer = '';
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) {
              if (!settled) finishError('连接提前结束，请重试');
              return;
            }
            buffer += decoder.decode(res.value, { stream: true });
            var frames = buffer.split('\n\n');
            buffer = frames.pop();
            frames.forEach(function (frame) {
              var event = 'message', dataStr = '';
              frame.split('\n').forEach(function (line) {
                if (line.indexOf('event:') === 0) event = line.slice(6).trim();
                else if (line.indexOf('data:') === 0) dataStr += line.slice(5).trim();
              });
              if (!dataStr) return;
              var data;
              try { data = JSON.parse(dataStr); } catch (e) { return; }
              switch (event) {
                case 'delta':        if (handlers.onDelta)       handlers.onDelta(data.text || ''); break;
                case 'reasoning':    if (handlers.onReasoning)   handlers.onReasoning(data.text || ''); break;
                case 'search_start': if (handlers.onSearchStart) handlers.onSearchStart(data.query || ''); break;
                case 'search_done':  if (handlers.onSearchDone)  handlers.onSearchDone(data.query || ''); break;
                case 'sources':      if (handlers.onSources)     handlers.onSources(data.items || []); break;
                case 'done':         finishDone(data); break;
                case 'error':        finishError(data.message || '请求失败', data); break;
              }
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        if (err && (err.name === 'AbortError' || err.message === 'non-sse')) return;
        finishError('网络错误，请重试');
      });

    return { abort: function () { settled = true; controller.abort(); } };
  }

  /* ── 模块状态 ── */
  var history    = [];   // [{role,content}]
  var conversationId = '';
  var current    = null;
  var quotaTimer = null;

  /* ── DOM helper ── */
  function scrollBottom(el) { el.scrollTop = el.scrollHeight; }

  /* ── 追加用户消息 ── */
  function appendUserMsg(container, text) {
    var wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg-user';
    var bubble = document.createElement('div');
    bubble.className = 'ai-msg-bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    container.appendChild(wrap);
    scrollBottom(container);
  }

  /**
   * 创建 AI 回复容器（含可选思考/联网区块 + 正文气泡）
   * 返回控制器，供后续追加文本。
   */
  var AGENT_AVATAR_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var AGENT_NAME = '在线客服';
  var AGENT_AVATAR_URL = '';   // 后台管理员头像 URL，init 时填充

  function buildAgentMeta() {
    var meta = document.createElement('div');
    meta.className = 'ai-msg-meta';
    var avatar = document.createElement('span');
    avatar.className = 'ai-bubble-avatar';
    if (AGENT_AVATAR_URL) {
      var img = document.createElement('img');
      img.src = AGENT_AVATAR_URL;
      img.alt = AGENT_NAME;
      // 加载失败降级为默认 SVG 图标
      img.onerror = function () { avatar.innerHTML = AGENT_AVATAR_SVG; };
      avatar.appendChild(img);
    } else {
      avatar.innerHTML = AGENT_AVATAR_SVG;
    }
    var name = document.createElement('span');
    name.className = 'ai-bubble-name';
    name.textContent = AGENT_NAME;
    meta.appendChild(avatar);
    meta.appendChild(name);
    return meta;
  }

  function createAssistantEntry(container, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg-assistant';
    wrap.appendChild(buildAgentMeta());

    /* 思考区块 */
    var reasoningBlock = null, reasoningBody = null;
    if (opts.withThinking) {
      reasoningBlock = document.createElement('details');
      reasoningBlock.className = 'ai-reasoning-block is-thinking';
      reasoningBlock.open = true;
      reasoningBlock.innerHTML =
        '<summary>' +
          '<span class="ai-block-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a8 8 0 0 1 8 8c0 3.5-2 6.5-5 7.7V20a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2.3C6 16.5 4 13.5 4 10a8 8 0 0 1 8-8z"/></svg></span>' +
          '<span class="ai-block-title">思考中</span>' +
          '<svg class="ai-block-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</summary>' +
        '<div class="ai-reasoning-body"></div>';
      reasoningBody = reasoningBlock.querySelector('.ai-reasoning-body');
      wrap.appendChild(reasoningBlock);
    }

    /* 联网区块 */
    var searchBlock = null;
    if (opts.withSearch) {
      searchBlock = document.createElement('details');
      searchBlock.className = 'ai-search-block is-searching';
      searchBlock.open = true;
      searchBlock.innerHTML =
        '<summary>' +
          '<span class="ai-block-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>' +
          '<span class="ai-block-title">正在联网搜索</span>' +
          '<svg class="ai-block-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</summary>' +
        '<div class="ai-search-body"></div>';
      wrap.appendChild(searchBlock);
    }

    /* 正文气泡 */
    var bubble = document.createElement('div');
    bubble.className = 'ai-msg-bubble';
    wrap.appendChild(bubble);
    container.appendChild(wrap);
    scrollBottom(container);

    return {
      appendReasoning: function (text) {
        if (reasoningBody) { reasoningBody.textContent += text; scrollBottom(container); }
      },
      finishReasoning: function () {
        if (reasoningBlock) {
          reasoningBlock.classList.remove('is-thinking');
          reasoningBlock.open = false;
          var t = reasoningBlock.querySelector('.ai-block-title');
          if (t) t.textContent = '已深度思考';
        }
      },
      finishSearch: function (query) {
        if (searchBlock) {
          searchBlock.classList.remove('is-searching');
          searchBlock.open = false;
          var t = searchBlock.querySelector('.ai-block-title');
          if (t) t.textContent = '已联网搜索';
          if (query) {
            var body = searchBlock.querySelector('.ai-search-body');
            if (body && !body.textContent) {
              var tag = document.createElement('span');
              tag.className = 'ai-search-query';
              tag.textContent = query;
              body.appendChild(tag);
            }
          }
        }
      },
      appendContent: function (text) { bubble.textContent += text; scrollBottom(container); },
      setSources: function (sources) {
        if (!Array.isArray(sources) || !sources.length) return;
        var list = document.createElement('div');
        list.className = 'ai-source-list';
        var label = document.createElement('div');
        label.className = 'ai-source-label';
        label.textContent = '参考来源';
        list.appendChild(label);
        sources.slice(0, 8).forEach(function (source) {
          if (!source || !/^https:\/\//i.test(source.url || '')) return;
          var link = document.createElement('a');
          link.className = 'ai-source-link';
          link.href = source.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          var host = '';
          try { host = new URL(source.url).hostname; } catch (e) {}
          link.textContent = (source.title || source.url) + (host ? ' · ' + host : '');
          list.appendChild(link);
        });
        if (list.querySelector('.ai-source-link')) wrap.appendChild(list);
      },
      setTyping:     function (on)   { bubble.classList.toggle('ai-typing', on); },
      getContent:    function ()     { return bubble.textContent; },
    };
  }

  /* ── 配额显示 ── */
  function updateQuotaDisplay(quotaEl, quota) {
    if (!quotaEl) return;
    if (quota) {
      quotaEl.dataset.remaining    = String(quota.remaining == null ? -1 : quota.remaining);
      quotaEl.dataset.limit        = String(quota.limit || 0);
      quotaEl.dataset.resetSeconds = String(quota.reset_seconds || 0);
    }
    var remaining    = parseInt(quotaEl.dataset.remaining    || '-1', 10);
    var limit        = parseInt(quotaEl.dataset.limit        || '0',  10);
    var resetSeconds = parseInt(quotaEl.dataset.resetSeconds || '0',  10);

    if (quotaTimer) { clearInterval(quotaTimer); quotaTimer = null; }
    quotaEl.classList.remove('is-cooling', 'is-visible');

    if (limit <= 0) {
      quotaEl.classList.add('is-visible');
      quotaEl.textContent = '今日次数：不限';
      return;
    }
    quotaEl.classList.add('is-visible');
    if (remaining > 0) {
      quotaEl.textContent = '剩余：' + remaining + ' / ' + limit;
      return;
    }
    function fmtD(s) {
      s = Math.max(0, parseInt(s || 0, 10));
      var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
      if (h > 0) return h + '小时' + String(m).padStart(2,'0') + '分';
      if (m > 0) return m + '分' + String(sec).padStart(2,'0') + '秒';
      return sec + '秒';
    }
    function tick() {
      quotaEl.classList.add('is-cooling');
      quotaEl.textContent = '已用完，' + fmtD(resetSeconds) + '后重置';
      resetSeconds -= 1;
      quotaEl.dataset.resetSeconds = String(Math.max(0, resetSeconds));
      if (resetSeconds < 0 && quotaTimer) clearInterval(quotaTimer);
    }
    tick();
    quotaTimer = setInterval(tick, 1000);
  }

  /* ── 主初始化 ── */
  function initAiChat() {
    var container   = document.getElementById('aiChatMessages');
    var form        = document.getElementById('aiChatForm');
    var input       = document.getElementById('aiChatInput');
    var sendBtn     = document.getElementById('aiChatSend');
    var stopBtn     = document.getElementById('aiChatStop');
    var newBtn      = document.getElementById('aiChatNew');
    var quotaEl     = document.getElementById('aiChatQuota');
    var csrfEl      = document.getElementById('aiChatCsrf');
    var thinkBtn    = document.getElementById('aiThinkToggle');
    var searchBtn   = document.getElementById('aiSearchToggle');
    var suggestions = document.getElementById('aiSuggestions');
    var thinkBadge  = document.getElementById('aiCapBadgeThink');
    var searchBadge = document.getElementById('aiCapBadgeSearch');

    if (!container || !form || !input || container.dataset.inited) return;
    container.dataset.inited = '1';

    var welcome  = container.getAttribute('data-welcome') || '';
    AGENT_AVATAR_URL = container.getAttribute('data-avatar') || '';
    var thinkOn  = false;
    var searchOn = false;

    /* 能力开关 */
    function toggleCap(btn, badge, on) {
      if (btn)   btn.classList.toggle('active', on);
      if (badge) badge.hidden = !on;
    }
    if (thinkBtn)  thinkBtn.addEventListener('click',  function () { thinkOn  = !thinkOn;  toggleCap(thinkBtn,  thinkBadge,  thinkOn);  });
    if (searchBtn) searchBtn.addEventListener('click', function () { searchOn = !searchOn; toggleCap(searchBtn, searchBadge, searchOn); });

    /* 渲染历史 */
    function renderHistory() {
      container.innerHTML = '';
      if (welcome && !history.length) {
        var w = document.createElement('div');
        w.className = 'ai-msg ai-msg-assistant';
        w.appendChild(buildAgentMeta());
        var b = document.createElement('div');
        b.className = 'ai-msg-bubble';
        b.textContent = welcome;
        w.appendChild(b);
        container.appendChild(w);
      }
      history.forEach(function (m) {
        if (m.role === 'user') {
          appendUserMsg(container, m.content);
        } else {
          var e = createAssistantEntry(container, {});
          e.appendContent(m.content);
          e.setSources(m.sources || []);
        }
      });
    }
    conversationId = loadConversationId();
    renderHistory();
    var historyFd = new FormData();
    historyFd.append('action', 'history');
    historyFd.append('csrf', csrfEl ? csrfEl.value : (window.userCsrf || ''));
    historyFd.append('conversation_id', conversationId);
    fetch('ai_chat.php', { method: 'POST', body: historyFd })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || data.status !== 'success') return;
        conversationId = data.conversation_id || '';
        if (conversationId) saveConversationId(conversationId); else clearConversationId();
        history = Array.isArray(data.messages) ? data.messages : [];
        renderHistory();
        if (data.quota) updateQuotaDisplay(quotaEl, data.quota);
        if (thinkBtn && data.capabilities) thinkBtn.hidden = !data.capabilities.thinking;
        if (searchBtn && data.capabilities) searchBtn.hidden = !data.capabilities.search;
      })
      .catch(function () {});
    updateQuotaDisplay(quotaEl, null);

    /* 繁忙状态 */
    function setBusy(busy) {
      if (sendBtn) sendBtn.disabled = busy;
      if (input)   input.disabled   = busy;
      if (stopBtn) stopBtn.hidden   = !busy;
    }

    /* 刷新对话 */
    function resetConversation() {
      if (current) { current.abort(); current = null; }
      clearConversationId();
      conversationId = '';
      history = [];
      setBusy(false);
      container.innerHTML = '';
      if (welcome) {
        var w = document.createElement('div');
        w.className = 'ai-msg ai-msg-assistant';
        w.appendChild(buildAgentMeta());
        var b = document.createElement('div');
        b.className = 'ai-msg-bubble';
        b.textContent = welcome;
        w.appendChild(b);
        container.appendChild(w);
      }
      if (suggestions) suggestions.style.display = '';
      if (quotaTimer) { clearInterval(quotaTimer); quotaTimer = null; }
      updateQuotaDisplay(quotaEl, null);
    }
    if (newBtn) newBtn.addEventListener('click', resetConversation);

    /* 快捷 chip */
    if (suggestions) {
      suggestions.querySelectorAll('.ai-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var q = chip.getAttribute('data-q') || chip.textContent.trim();
          if (input) {
            input.value = q;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 140) + 'px';
          }
          suggestions.style.display = 'none';
          send();
        });
      });
    }

    /* 输入框自适应高度 */
    if (input) {
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
    }

    /* 停止 */
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        if (current) { current.abort(); current = null; }
        setBusy(false);
      });
    }

    /* 表单提交 */
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });

    /* 核心发送逻辑 */
    function send() {
      var msg = input ? input.value.trim() : '';
      if (!msg || current) return;

      if (suggestions) suggestions.style.display = 'none';

      appendUserMsg(container, msg);
      history.push({ role: 'user', content: msg });

      if (input) { input.value = ''; input.style.height = 'auto'; }
      setBusy(true);

      var entry = createAssistantEntry(container, {
        withThinking: thinkOn,
        withSearch:   searchOn,
      });
      entry.setTyping(true);

      var acc           = '';
      var finished      = false;
      var reasoningDone = false;
      var searchDone    = false;

      current = streamChat(
        {
          csrf:            csrfEl ? csrfEl.value : (window.userCsrf || ''),
          message:         msg,
          conversation_id: conversationId,
          enable_thinking: thinkOn  ? '1' : '0',
          enable_search:   searchOn ? '1' : '0',
        },
        {
          onReasoning: function (text) {
            entry.appendReasoning(text);
          },
          onSearchStart: function () { /* 区块已在创建时建好 */ },
          onSearchDone: function (query) {
            searchDone = true;
            entry.finishSearch(query || msg);
          },
          onDelta: function (text) {
            if (!reasoningDone) { reasoningDone = true; entry.finishReasoning(); }
            if (searchOn && !searchDone) { searchDone = true; entry.finishSearch(msg); }
            entry.setTyping(false);
            acc += text;
            entry.appendContent(text);
          },
          onSources: function (items) {
            entry.setSources(items);
          },
          onDone: function (data) {
            if (finished) return;
            finished = true; current = null; setBusy(false);
            entry.setTyping(false);
            if (!reasoningDone) { reasoningDone = true; entry.finishReasoning(); }
            if (searchOn && !searchDone) { searchDone = true; entry.finishSearch(); }
            if (data && data.quota) updateQuotaDisplay(quotaEl, data.quota);
            if (data && data.conversation_id) {
              conversationId = data.conversation_id;
              saveConversationId(conversationId);
            }
            if (data && data.finish_reason === 'length') {
              entry.appendContent('\n\n（回答达到长度上限，内容可能未完整结束）');
            } else if (data && data.finish_reason === 'sensitive') {
              entry.appendContent('\n\n（回答因内容安全审核提前结束）');
            }
            if (acc) {
              history.push({ role: 'assistant', content: acc });
              if (history.length > 20) history = history.slice(-20);
            } else {
              entry.appendContent('（未返回内容）');
            }
          },
          onError: function (m, data) {
            if (finished) return;
            finished = true; current = null; setBusy(false);
            entry.setTyping(false);
            if (!reasoningDone) { reasoningDone = true; entry.finishReasoning(); }
            if (searchOn && !searchDone) { searchDone = true; entry.finishSearch(); }
            entry.appendContent('❌ ' + m);
            if (data && data.quota) updateQuotaDisplay(quotaEl, data.quota);
            if (history.length && history[history.length - 1].role === 'user') {
              history.pop();
            }
          },
        }
      );
    }
  }

  /* ── 挂载 ── */
  function tryInit() {
    var pane = document.getElementById('tab-ai_assistant');
    if (pane && pane.style.display !== 'none') initAiChat();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }

  /* 包装 switchUserTab，切到客服时初始化 */
  var origSwitch = window.switchUserTab;
  window.switchUserTab = function (tabKey) {
    if (typeof origSwitch === 'function') origSwitch(tabKey);
    if (tabKey === 'ai_assistant') initAiChat();
  };
})();
