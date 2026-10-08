const SENT_KEY = 'quicksend_log';
const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

let entries = [];

function getEntries() {
  return chrome.storage.local.get(SENT_KEY).then(data => {
    const log = data[SENT_KEY] || {};
    return Object.values(log).sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
  });
}

function render() {
  const list = document.getElementById('list');
  const count = document.getElementById('count');
  count.textContent = entries.length
    ? `${entries.length} listing${entries.length > 1 ? 's' : ''} already contacted`
    : 'No listing contacted yet.';

  if (!entries.length) {
    list.innerHTML = '<div class="empty">No sends recorded yet.</div>';
    return;
  }

  list.innerHTML = entries.map(e => {
    const date = e.sentAt ? dateFmt.format(new Date(e.sentAt)) : '';
    const id = e.listingId || e.url || '';
    return `<div class="row"><span class="id" title="${escapeAttr(e.url)}">${escapeHtml(id)}</span>` +
           `<span class="date">${escapeHtml(date)}</span></div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

function toCsv(rows) {
  const header = ['sentAt', 'listingId', 'url', 'message'];
  const lines = [header.join(',')];
  for (const e of rows) {
    lines.push([e.sentAt, e.listingId, e.url, e.message].map(csvCell).join(','));
  }
  // BOM so Excel opens the accents correctly
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

function toJs(rows) {
  return JSON.stringify(rows.map(e => ({
    sentAt: e.sentAt,
    listingId: e.listingId,
    url: e.url,
    message: e.message
  })), null, 2);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function say(text) {
  const status = document.getElementById('status');
  status.textContent = text;
  setTimeout(() => {
    if (status.textContent === text) status.textContent = '';
  }, 3000);
}

document.getElementById('csv').addEventListener('click', () => {
  download(`seloger-quicksend-${stamp()}.csv`, toCsv(entries), 'text/csv;charset=utf-8');
  say(`CSV exported (${entries.length} rows)`);
});

document.getElementById('json').addEventListener('click', () => {
  download(`seloger-quicksend-${stamp()}.json`, toJs(entries), 'application/json');
  say(`JSON exported (${entries.length} rows)`);
});

document.getElementById('clear').addEventListener('click', async () => {
  if (!entries.length) return;
  if (!confirm(`Delete all ${entries.length} log entries? Sent tags on cards will disappear.`)) {
    return;
  }
  await chrome.storage.local.remove(SENT_KEY);
  entries = [];
  render();
  say('Log cleared');
});

getEntries().then(rows => {
  entries = rows;
  render();
}).catch(e => {
  document.getElementById('count').textContent = 'Could not read log: ' + e.message;
});
