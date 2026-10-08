// SeLoger QuickSend - One-click background submission from listing cards
(() => {
  const MESSAGE = "Bonjour,\n\nJe dois déménager à Lyon début janvier pour des raisons professionnelles.\n\nMerci d'avance.\n\nCordialement,\nMamadou KEBE";
  const CONTACT = {
    fullName: "Mamadou KEBE",
    email: "kebem221@gmail.com",
    phone: "+33760349649",
    status: "Non propriétaire"
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
      if (href.includes('/annonces/') || href.includes('seloger.com/')) {
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
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': navigator.userAgent
        }
      });

      if (!res.ok) {
        throw new Error(`Failed to load page: ${res.status}`);
      }

      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Try to find contact form
      let form = doc.querySelector('form[action*="contact"]') ||
                 doc.querySelector('form[id*="contact"]') ||
                 doc.querySelector('form[name*="contact"]') ||
                 doc.querySelector('form[class*="contact"]') ||
                 doc.querySelector('form[action*="send"]') ||
                 doc.querySelector('form');

      if (!form) {
        throw new Error('No contact form found');
      }

      // Find message field
      let messageField = form.querySelector('textarea[name*="message"]') ||
                         form.querySelector('textarea[id*="message"]') ||
                         form.querySelector('textarea[placeholder*="message"]') ||
                         form.querySelector('textarea');

      // Find name
      let nameField = form.querySelector('input[name*="nom"]') ||
                      form.querySelector('input[name*="name"]') ||
                      form.querySelector('input[id*="nom"]') ||
                      form.querySelector('input[placeholder*="Nom"]') ||
                      form.querySelector('input[type="text"]:not([name*="search"]):not([type="hidden"])');

      // Find email
      let emailField = form.querySelector('input[type="email"]') ||
                       form.querySelector('input[name*="email"]') ||
                       form.querySelector('input[id*="email"]');

      // Find phone
      let phoneField = form.querySelector('input[type="tel"]') ||
                       form.querySelector('input[name*="tel"]') ||
                       form.querySelector('input[name*="phone"]') ||
                       form.querySelector('input[id*="tel"]');

      // Fill fields if found
      if (messageField) {
        messageField.value = MESSAGE;
        messageField.dispatchEvent(new Event('input', { bubbles: true }));
        messageField.dispatchEvent(new Event('change', { bubbles: true }));
        messageField.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      if (nameField) {
        nameField.value = CONTACT.fullName;
        nameField.dispatchEvent(new Event('input', { bubbles: true }));
        nameField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (emailField) {
        emailField.value = CONTACT.email;
        emailField.dispatchEvent(new Event('input', { bubbles: true }));
        emailField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (phoneField) {
        phoneField.value = CONTACT.phone;
        phoneField.dispatchEvent(new Event('input', { bubbles: true }));
        phoneField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Try to set "Non propriétaire" if select exists
      const statusSelects = form.querySelectorAll('select');
      for (const sel of statusSelects) {
        const opts = Array.from(sel.options);
        const match = opts.find(o => o.text.toLowerCase().includes('non propri') || o.text.toLowerCase().includes('locataire'));
        if (match) {
          sel.value = match.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Uncheck opt-in checkboxes
      const checkboxes = form.querySelectorAll('input[type="checkbox"]');
      for (const cb of checkboxes) {
        const label = cb.closest('label') || form.querySelector(`label[for="${cb.id}"]`);
        const text = (label?.textContent || cb.name || cb.value || '').toLowerCase();
        if (text.includes('ne souhaite pas') || text.includes('pas recevoir') || text.includes('suggestions') || text.includes('similaires')) {
          if (cb.checked) {
            cb.checked = false;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            cb.dispatchEvent(new Event('click', { bubbles: true }));
          }
        }
      }

      // Build form data
      const formData = new FormData(form);
      if (messageField && !formData.has(messageField.name || 'message')) {
        formData.set(messageField.name || 'message', MESSAGE);
      }
      if (nameField) {
        const key = nameField.name || 'nom';
        if (!formData.has(key)) formData.set(key, CONTACT.fullName);
      }
      if (emailField) {
        const key = emailField.name || 'email';
        if (!formData.has(key)) formData.set(key, CONTACT.email);
      }
      if (phoneField) {
        const key = phoneField.name || 'telephone';
        if (!formData.has(key)) formData.set(key, CONTACT.phone);
      }

      // Determine action
      let action = form.getAttribute('action') || '';
      if (action && !action.startsWith('http')) {
        try {
          action = new URL(action, url).href;
        } catch (e) {
          action = url;
        }
      } else if (!action) {
        action = url;
      }

      // Submit in background
      await fetch(action, {
        method: form.method || 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/json,*/*'
        }
      });

      btn.classList.remove('quick-send-processing');
      btn.textContent = 'Sent ✓';
      btn.classList.add('quick-send-success');
      setCardState(card, 'success');
      createToast('Message sent successfully', 'success');
    } catch (err) {
      console.error('[SeLoger QuickSend]', err);
      btn.classList.remove('quick-send-processing');
      btn.textContent = 'Failed ✗';
      btn.classList.add('quick-send-error');
      setCardState(card, 'error');
      createToast('Submission failed', 'error');
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
