# SeLoger QuickSend

One-click background submission from SeLoger listing cards. Injects a "Quick send" button on property cards, opens the property page in a hidden tab, fills SeLoger's live contact form, submits it, and records the send in a persistent log.

## Install in Brave/Chrome (Developer mode)

1. Open `brave://extensions/` (or `chrome://extensions/`)
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select `/Users/mamadoukebe/PycharmProjects/seloger-quicksend`
5. Navigate to `https://www.seloger.com/*` - "Quick send" appears on listing cards.

Reload the extension after every change, then hard-reload the SeLoger tab (the content script is injected at `document_idle` and does not hot-reload).

## Pre-filled values

- Message: the French contact template in `MESSAGE` (content.js)
- Name: `Mamadou KEBE`
- Email: `kebem221@gmail.com`
- Phone: `+33760349649`
- Consent checkbox: checked; marketing opt-ins: unchecked
- Non-required fields left at their defaults

## Behavior

- Click "Quick send" - the card pulses while the background worker (background.js) opens the listing in a hidden tab, fills the form and clicks its real submit button
- Green flash on success, red on failure, toast feedback bottom center
- The result is confirmed by watching the DOM of the hidden tab (form removed, confirmation text, or an error banner), then the tab is closed
- Why a hidden tab: SeLoger's contact form has no `action` attribute - React intercepts the submit and calls its own API, so there is no endpoint to POST to directly

## Sent log and card tags

- On a confirmed send, an entry is written to `chrome.storage.local` under `quicksend_log`, keyed by the listing's `origin + pathname` (query string and hash are stripped, so the same listing is never logged twice)
- Each entry stores `key`, `url`, `listingId`, `sentAt` (ISO) and the `message` that was sent
- Listings already contacted show a green **Sent** badge on the card and their button reads `Sent ✓` - the tag survives the success/error tint and page re-scans
- Click the extension toolbar icon to open the popup: count, recent sends, and three actions
  - **Export CSV** - RFC 4180 quoted, CRLF line endings, UTF-8 BOM so Excel renders the accents correctly
  - **Export JSON** - pretty-printed array of entries
  - **Clear** - wipes the log (removes every tag on the next scan)

## Console diagnostics

`QS-DEBUG` in the property tab's console reports the form state (field names found, `formAction`, message body). The service worker logs `[SeLoger QuickSend] background result` with the same detail.

## Notes

- The log lives in `chrome.storage.local`; it is not synced across profiles or browsers
- The `storage` permission in `manifest.json` is required by this feature
- SeLoger's bot protection may reject automated submissions - a CloudFront 403 body (`The request could not be satisfied`) is treated as a failure
