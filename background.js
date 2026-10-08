// SeLoger QuickSend - background worker
// SeLoger's contact form has no action attribute: React intercepts the submit
// and posts to its own API with headers/CSRF it computes at runtime. A plain
// fetch therefore has nowhere to go, so instead we open the property page in a
// hidden tab, let React mount, fill the real form and click its real submit
// button so the site's own handler runs with the live session.
(() => {
  const LOAD_TIMEOUT = 30000;
  const READY_TIMEOUT = 25000;
  const RESULT_TIMEOUT = 20000;
  const POLL_MS = 400;
  const SENT_KEY = 'quicksend_log';

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Listing URLs carry the whole search query plus a hash, so the log is keyed
  // on origin + pathname only. Keep this identical to content.js.
  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) {
      return url;
    }
  }

  function listingIdFromUrl(url) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
    } catch (e) {
      return '';
    }
  }

  // Persist one entry per listing; re-sending the same listing updates its
  // timestamp rather than adding a duplicate row.
  async function recordSent(url, message) {
    const key = normalizeUrl(url);
    const entry = {
      key,
      url,
      listingId: listingIdFromUrl(url),
      sentAt: new Date().toISOString(),
      message
    };
    const data = await chrome.storage.local.get(SENT_KEY);
    const log = data[SENT_KEY] || {};
    log[key] = entry;
    await chrome.storage.local.set({ [SENT_KEY]: log });
    return entry;
  }

  function waitForComplete(tabId, timeout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        fn(arg);
      };
      const timer = setTimeout(() => finish(reject, new Error('Page load timeout')), timeout);
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === 'complete') finish(resolve);
      };
      const onRemoved = (id) => {
        if (id === tabId) finish(reject, new Error('Tab closed during load'));
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  }

  async function probe(tabId, func, args, timeout) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId },
          func,
          args: args || []
        });
        last = result;
        if (result && result.done) return result;
      } catch (e) {
        last = { done: false, error: e.message };
      }
      await delay(POLL_MS);
    }
    return last || { done: false, error: 'probe timed out' };
  }

  // Runs in the page. Self-contained: executeScript serializes it and its
  // arguments, so it cannot reference anything from this file.
  function fillContactForm(message, contact) {
    const setInput = (el, value) => {
      const proto = el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    };

    const hints = (el) => {
      const label = el.id
        ? document.querySelector(`label[for="${el.id}"]`)
        : el.closest('label');
      return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
        el.getAttribute('autocomplete'), el.className,
        label ? label.textContent : ''].filter(Boolean).join(' ').toLowerCase();
    };

    // The real contact form is the one that owns a message textarea.
    const form = Array.from(document.querySelectorAll('form'))
      .find(f => f.querySelector('textarea'))
      || document.querySelector('form');
    if (!form) {
      return { done: true, stage: 'noform', forms: document.querySelectorAll('form').length };
    }
    // Remember we saw a live form, so watchOutcome can trust its later removal.
    window.__qsFormSeen = true;

    const messageField = form.querySelector('textarea[name*="message" i]')
      || form.querySelector('textarea')
      || document.querySelector('textarea[name*="message" i]');
    if (!messageField) {
      return { done: true, stage: 'notextarea', formHtml: form.outerHTML.slice(0, 300) };
    }

    setInput(messageField, message);

    const unfilled = [];
    for (const el of form.querySelectorAll('input, textarea, select')) {
      if (el === messageField || el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
      if (el.tagName === 'TEXTAREA' || el.type === 'checkbox') continue;
      const required = el.required === true || el.getAttribute('aria-required') === 'true';
      if (!required) continue;

      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options);
        const pick = opts.find(o => {
          const t = o.text.toLowerCase();
          return t.includes('non propri') || t.includes('locataire');
        }) || opts.find(o => o.value !== '');
        if (pick) {
          el.value = pick.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          unfilled.push(el.name || el.id || 'select');
        }
        continue;
      }

      const h = hints(el);
      let value = null;
      if (el.type === 'email' || h.includes('email') || h.includes('mail') || h.includes('courriel')) {
        value = contact.email;
      } else if (el.type === 'tel' || h.includes('tel') || h.includes('phone') || h.includes('portable') || h.includes('mobile')) {
        value = contact.phone;
      } else if (h.includes('name') || h.includes('nom') || h.includes('prenom') || h.includes('prénom')) {
        value = contact.fullName;
      }

      if (value === null) {
        unfilled.push(el.name || el.id || el.type);
        continue;
      }
      setInput(el, value);
    }

    for (const cb of form.querySelectorAll('input[type="checkbox"][required]')) {
      if (!cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('click', { bubbles: true }));
      }
    }

    // Leave consent boxes alone, but drop pure marketing opt-ins.
    for (const cb of form.querySelectorAll('input[type="checkbox"]:not([required])')) {
      const label = cb.closest('label') || document.querySelector(`label[for="${cb.id}"]`);
      const text = ((label && label.textContent) || cb.name || cb.value || '').toLowerCase();
      if (/ne souhaite pas|pas recevoir|suggestions|similaires|newsletter|offres/.test(text)) {
        if (cb.checked) {
          cb.checked = false;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new Event('click', { bubbles: true }));
        }
      }
    }

    // Report what we actually filled so failures are diagnosable.
    const report = {};
    for (const el of form.querySelectorAll('input, textarea')) {
      if (el.name || el.id) report[el.name || el.id] = String(el.value || '').slice(0, 24);
    }

    return { done: true, stage: 'filled', unfilled, report, formId: form.id || '(none)' };
  }

  // Runs in the page. Clicks the form's real submit control so React's own
  // submit handler fires with whatever token/headers it needs.
  function submitContactForm() {
    const form = Array.from(document.querySelectorAll('form'))
      .find(f => f.querySelector('textarea'));
    if (!form) return { done: true, stage: 'nosubmit' };

    const controls = Array.from(
      form.querySelectorAll('button, input[type="submit"], [role="button"]')
    );
    const submit = controls.find(b => b.type === 'submit' || b.type === 'button')
      || controls[0];

    if (submit) {
      submit.click();
    } else {
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }
    return { done: true, stage: 'clicked', label: submit ? (submit.innerText || submit.value || '').trim() : '(native)' };
  }

  // Runs in the page repeatedly until something conclusive happens.
  // Success phrases are searched only in rendered, non-script text: a detached
  // node's innerText falls back to textContent, which would otherwise expose
  // the JS bundles and false-positive on words like "merci"/"envoyé".
  function watchOutcome() {
    const form = Array.from(document.querySelectorAll('form'))
      .find(f => f.querySelector('textarea'));

    const statusNodes = document.querySelectorAll(
      '[role="status"], [role="alert"], [data-testid*="success" i], ' +
      '[data-testid*="error" i], [class*="Toast"], [class*="toast"], ' +
      '[class*="success"], [class*="confirmation"], [class*="alert"]'
    );
    let statusText = '';
    for (const n of statusNodes) {
      const t = (n.innerText || n.textContent || '').trim();
      if (t) statusText += t + ' | ';
    }

    const ERR_RE = /erreur|error|invalide|requise|required|obligatoire|impossible/i;
    const OK_RE = /merci|envoy|bien reçu|votre demande|demande envoy|message envoy|enregistrée/i;

    if (statusText && ERR_RE.test(statusText)) {
      return { done: true, state: 'error', evidence: statusText.slice(0, 200) };
    }
    if (statusText && OK_RE.test(statusText)) {
      return { done: true, state: 'success', evidence: statusText.slice(0, 200) };
    }

    // React replaces the form with a confirmation once the send succeeds.
    // Only trusted if we actually saw the form beforehand (marked during fill).
    if (!form && window.__qsFormSeen) {
      return { done: true, state: 'success', evidence: 'contact form removed from page' };
    }

    // Visible page text, with scripts/styles/templates stripped out.
    const clone = document.body.cloneNode(true);
    for (const el of clone.querySelectorAll('script, style, noscript, template, form, svg')) {
      el.remove();
    }
    const pageText = (clone.textContent || '').toLowerCase();
    if (OK_RE.test(pageText)) {
      return { done: true, state: 'success', evidence: 'confirmation text on page' };
    }

    if (statusText) {
      return { done: true, state: 'error', evidence: statusText.slice(0, 200) };
    }

    return { done: false, state: 'pending' };
  }

  async function send(url, message, contact) {
    const { id: tabId } = await chrome.tabs.create({ url, active: false });
    try {
      await waitForComplete(tabId, LOAD_TIMEOUT);
      await delay(1500); // let React hydrate

      const filled = await probe(tabId, fillContactForm, [message, contact], READY_TIMEOUT);
      if (!filled || !filled.done || filled.stage !== 'filled') {
        return {
          ok: false,
          error: `Live page: ${filled ? (filled.error || filled.stage || 'unexpected response') : 'no response'}`,
          detail: filled
        };
      }

      const submitted = await probe(tabId, submitContactForm, [], 5000);
      const outcome = await probe(tabId, watchOutcome, [], RESULT_TIMEOUT);

      return {
        ok: outcome && outcome.state === 'success',
        note: outcome ? outcome.state : 'unknown',
        evidence: outcome ? outcome.evidence : '',
        filled: filled.report || {},
        unfilled: filled.unfilled || [],
        submitted: submitted ? submitted.stage : '',
        error: outcome && outcome.state === 'error'
          ? outcome.evidence
          : (!outcome || outcome.state === 'pending' ? 'No confirmation seen in time' : null)
      };
    } finally {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  let busy = false;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'quicksend:send') return;
    if (busy) {
      sendResponse({ ok: false, error: 'A send is already in progress' });
      return;
    }
    busy = true;
    (async () => {
      try {
        const result = await send(msg.url, msg.message, msg.contact);
        if (result.ok) {
          // The log is the record of a successful send, so a storage failure
          // must not turn the send itself into a reported failure.
          try {
            result.entry = await recordSent(msg.url, msg.message);
          } catch (e) {
            console.error('[SeLoger QuickSend] could not record send:', e && e.message);
            result.entry = null;
          }
        }
        console.log('[SeLoger QuickSend] background result:', JSON.stringify(result));
        sendResponse(result);
      } catch (e) {
        console.error('[SeLoger QuickSend] background failed:', e && e.message);
        sendResponse({ ok: false, error: `${e.name}: ${e.message}` });
      } finally {
        busy = false;
      }
    })();
    return true; // keep the channel open for the async response
  });
})();