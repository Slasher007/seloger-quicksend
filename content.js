// SeLoger QuickSend - One-click background submission from listing cards
(() => {
  const BUILD = 'tag-6';
  console.info('[SeLoger QuickSend] content script loaded, build=' + BUILD);
  const MESSAGE = "Bonjour,\n\nJe suis très intéressé par votre logement. Je dois prochainement déménager à Lyon pour des raisons professionnelles, suite à une nouvelle prise de poste.\n\nVotre logement correspond bien à ma recherche. Je serais donc intéressé pour avoir plus d’informations et, si possible, organiser une visite.\n\nMerci d’avance pour votre retour.\n\nBien cordialement,\nMamadou";
  const CONTACT = {
    fullName: "Mamadou KEBE",
    email: "kebem221@gmail.com",
    phone: "+33760349649"
  };

  const SENT_KEY = 'quicksend_log';

  const CARD_SELECTORS = [
    '[data-testid="serp-core-classified-card-testid"]',
    'article[data-testid*="card"]',
    'div[role="article"]',
    '.serp-result',
    '.listing',
    '.classified-card'
  ];

  const COVER_LINK_SELECTORS = [
    '[data-testid="card-mfe-covering-link-testid"]',
    'a[data-testid*="covering-link"]',
    'a[href*="/annonces/"]',
    'a[href*="/annonce/"]',
    'a[href*="seloger.com/"]'
  ];

  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  let isProcessing = false;
  let observer = null;
  // Re-entrancy guard: scan() mutates the DOM, which fires the observer,
  // which would otherwise call scan() again in an unbounded loop.
  let scanning = false;
  let scanScheduled = false;
  // Keyed by normalized listing URL: key -> { sentAt, url, listingId, message }
  let sentMap = {};

  // Keep this identical to background.js.
  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) {
      return url;
    }
  }

  async function loadSentMap() {
    try {
      const data = await chrome.storage.local.get(SENT_KEY);
      sentMap = data[SENT_KEY] || {};
    } catch (e) {
      console.error('[SeLoger QuickSend] could not read sent log:', e);
      sentMap = {};
    }
  }

  function createToast(text, type = 'info') {
    const existing = document.querySelector('.qs-feedback-toast');
    if (existing) {
      existing.remove();
    }
    const toast = document.createElement('div');
    toast.className = `qs-feedback-toast ${type}`;
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 200);
    }, 2500);
  }

  function findCard(el) {
    let current = el;
    while (current && current !== document.body) {
      for (const sel of CARD_SELECTORS) {
        if (current.matches && current.matches(sel)) {
          return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  function findCoverLink(card) {
    for (const sel of COVER_LINK_SELECTORS) {
      const link = card.querySelector(sel);
      if (link && link.href) {
        return link;
      }
    }
    const links = card.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (href.includes('/annonce') || href.includes('seloger.com/')) {
        return link;
      }
    }
    return null;
  }

  function getPropertyUrl(card) {
    const link = findCoverLink(card);
    if (link) {
      try {
        return new URL(link.href, location.origin).href;
      } catch (e) {
        return link.href;
      }
    }
    return null;
  }

  function setCardState(card, state) {
    card.classList.remove('qs-card-processing', 'qs-card-success', 'qs-card-error');
    if (state) {
      card.classList.add(`qs-card-${state}`);
    }
  }

  // Badge + button state for a listing that was already sent. Safe to call
  // repeatedly (every scan) - it only ever creates the tag once.
  function applySentState(card) {
    const url = getPropertyUrl(card);
    if (!url) return null;
    const entry = sentMap[normalizeUrl(url)];
    if (!entry) return null;

    card.classList.add('qs-card-sent');
    card.style.position = 'relative';

    let tag = card.querySelector('.qs-sent-tag');
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'qs-sent-tag';
      card.appendChild(tag);
    }
    const when = entry.sentAt ? dateFmt.format(new Date(entry.sentAt)) : '';
    const label = when ? `Sent ${when}` : 'Sent';
    // Only touch the DOM when the label actually changes: writing the same
    // textContent still replaces the text node and re-triggers the observer.
    if (tag.textContent !== label) {
      tag.textContent = label;
    }

    const btn = card.querySelector('.quick-send-btn');
    if (btn && !btn.classList.contains('quick-send-processing')) {
      if (btn.textContent !== 'Sent ✓') {
        btn.textContent = 'Sent ✓';
      }
      btn.classList.add('quick-send-sent');
    }
    return entry;
  }

  // SeLoger's contact form has no action attribute - React intercepts the
  // submit and calls its own API. So there is nothing to POST to from here:
  // the background worker opens the property page in a hidden tab, fills the
  // live form and clicks its real submit button instead.
  async function sendToBackground(message) {
    const res = await chrome.runtime.sendMessage(message);
    if (!res) {
      throw new Error('Background worker did not respond');
    }
    if (!res.ok) {
      throw new Error(res.error || 'Background send failed');
    }
    return res;
  }

  function injectButton(card) {
    if (card.querySelector('.quick-send-btn')) {
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'quick-send-btn';
    btn.textContent = 'Quick send';
    btn.type = 'button';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isProcessing) {
        return;
      }
      await handleQuickSend(card, btn);
    });

    card.style.position = 'relative';
    card.appendChild(btn);
  }

  async function handleQuickSend(card, btn) {
    const url = getPropertyUrl(card);
    if (!url) {
      btn.textContent = 'No link';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = 'Quick send';
        btn.disabled = false;
      }, 1500);
      createToast('Could not find property link', 'error');
      return;
    }

    isProcessing = true;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    btn.classList.add('quick-send-processing');
    setCardState(card, 'processing');
    createToast('Submitting in background...', 'info');

    let entry = null;

    try {
      const result = await sendToBackground({
        type: 'quicksend:send',
        url,
        message: MESSAGE,
        contact: CONTACT
      });
      console.log('[SeLoger QuickSend] result:', JSON.stringify(result));

      // Remember the send even if the background worker could not persist it,
      // so the tag still shows for this session.
      entry = result.entry || {
        key: normalizeUrl(url),
        url,
        sentAt: new Date().toISOString()
      };
      sentMap[entry.key] = entry;
      applySentState(card);

      btn.classList.remove('quick-send-processing');
      btn.textContent = 'Sent ✓';
      btn.classList.add('quick-send-sent', 'quick-send-success');
      setCardState(card, 'success');
      if (result.unfilled && result.unfilled.length) {
        createToast(`Sent, but blank required: ${result.unfilled.join(', ')}`, 'info');
      } else {
        createToast('Message sent successfully', 'success');
      }
    } catch (err) {
      console.error('[SeLoger QuickSend]', err);
      btn.classList.remove('quick-send-processing');
      btn.textContent = 'Failed ✗';
      btn.classList.add('quick-send-error');
      setCardState(card, 'error');
      createToast(`Failed: ${err.message}`, 'error');
    } finally {
      isProcessing = false;
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('quick-send-success', 'quick-send-error');
        // A listing that was sent keeps its "Sent ✓" label instead of
        // reverting to "Quick send" like a failed attempt does.
        if (entry) {
          btn.textContent = 'Sent ✓';
          btn.classList.add('quick-send-sent');
        } else {
          btn.textContent = 'Quick send';
          btn.classList.remove('quick-send-sent');
        }
      }, 1800);
      // Keep the transient success/error tint briefly; the sent tag stays.
      setTimeout(() => {
        if (card.classList.contains('qs-card-success') || card.classList.contains('qs-card-error')) {
          setCardState(card, null);
        }
      }, 2200);
    }
  }

  function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const cards = document.querySelectorAll(CARD_SELECTORS.join(','));
      for (const card of cards) {
        if (card.offsetParent !== null || card === document.body || getComputedStyle(card).display !== 'none') {
          injectButton(card);
          applySentState(card);
        }
      }
    } finally {
      scanning = false;
    }
  }

  // Coalesce bursts of mutations (and the periodic rescan) into one scan per
  // animation frame instead of scanning once per mutation batch.
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  async function init() {
    await loadSentMap();
    scan();
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-scan periodically for SPAs
  setInterval(scheduleScan, 4000);
})();
