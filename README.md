# SeLoger QuickSend

One-click background submission from SeLoger listing cards. Injects a "Quick send" button on property cards, fetches the property page, auto-fills the contact form with pre-set details, unchecks opt-ins, submits in the background, and animates the card with feedback.

## Install in Brave/Chrome (Developer mode)

1. Open `brave://extensions/` (or `chrome://extensions/`)
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select `/Users/mamadoukebe/PycharmProjects/seloger-quicksend`
5. Navigate to `https://www.seloger.com/*` and hover over listing cards - "Quick send" appears.

## Pre-filled values

- Message: `Bonjour,

Je dois déménager à Lyon début janvier pour des raisons professionnelles.

Merci d'avance.

Cordialement,
Mamadou KEBE`
- Name: `Mamadou KEBE`
- Email: `kebem221@gmail.com`
- Phone: `+33760349649`
- Status: `Non propriétaire`
- Unchecks: "Je ne souhaite pas recevoir d'annonces similaires et de suggestions personnalisées...

## Behavior

- One click: everything runs in background (fetch property page, parse form, fill, uncheck, submit via fetch)
- Card animates (pulse) while processing; green/red flash on result
- Toast feedback bottom center
