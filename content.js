// SeLoger QuickSend - One-click background submission from listing cards
(() => {
  const BUILD = 'tabdrive-4';
  console.info('[SeLoger QuickSend] content script loaded, build=' + BUILD);
  const MESSAGE = "Bonjour,\n\nJe suis très intéressé par votre logement. Je dois prochainement déménager à Lyon pour des raisons professionnelles, suite à une nouvelle prise de poste.\n\nVotre logement correspond bien à ma recherche. Je serais donc intéressé pour avoir plus d’informations et, si possible, organiser une visite.\n\nMerci d’avance pour votre retour.\n\nBien cordialement,\nMamadou";
  const CONTACT = {
    fullName: "Mamadou KEBE",
    email: "kebem221@gmail.com",
    phone: "+33760349649"
  };

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

  let isProcessing = false;
  let observer = null;

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

    try {
      const result = await sendToBackground({
        type: 'quicksend:send',
        url,
        message: MESSAGE,
        contact: CONTACT
      });
      console.log('[SeLoger QuickSend] result:', JSON.stringify(result));

      btn.classList.remove('quick-send-processing');
      btn.textContent = 'Sent ✓';
      btn.classList.add('quick-send-success');
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
        btn.textContent = 'Quick send';
      }, 1800);
      // Keep success/error card state briefly
      setTimeout(() => {
        if (card.classList.contains('qs-card-success') || card.classList.contains('qs-card-error')) {
          setCardState(card, null);
        }
      }, 2200);
    }
  }

  function scan() {
    const cards = document.querySelectorAll(CARD_SELECTORS.join(','));
    for (const card of cards) {
      if (card.offsetParent !== null || card === document.body || getComputedStyle(card).display !== 'none') {
        injectButton(card);
      }
    }
  }

  function init() {
    scan();
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          scan();
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
  setInterval(scan, 2000);
})();
