# Embedding SDK

The `@kampi/game-sdk` package provides typed iframe/postMessage integration for embedding Kampi games in websites, the PWA shell, or future Capacitor WebViews.

## Protocol version

`1.0.0` (`EMBED_PROTOCOL_VERSION` in `@kampi/contracts`)

## Host → Game messages

| Type | Purpose |
|------|---------|
| `host_ready` | Host initialized; includes protocol version |
| `session` | Auth token (+ optional player ID) |
| `locale` | Locale string |
| `theme` | Theme/config object |
| `request_close` | Host requests game close |

## Game → Host messages

| Type | Purpose |
|------|---------|
| `game_ready` | Game loaded |
| `balance_changed` | Chip balance updated (string) |
| `match_started` | Match ID + game slug |
| `match_completed` | Result + optional payout |
| `error` | Error code + message |
| `request_close` | Game requests close |

All messages are validated with Zod. Origins must match configured allowlists.

## Website embed example

```html
<iframe id="kampi-rps" src="https://rps.kampi.fun?token=..." allow="fullscreen"></iframe>
<script type="module">
  import { HostEmbedController } from '@kampi/game-sdk';

  const iframe = document.getElementById('kampi-rps');
  iframe.addEventListener('load', () => {
    const controller = new HostEmbedController({
      targetWindow: iframe.contentWindow,
      targetOrigin: 'https://rps.kampi.fun',
      allowedOrigins: ['https://rps.kampi.fun'],
      onMessage: (msg) => console.log('game event', msg),
    });
    controller.send({ type: 'host_ready', protocolVersion: '1.0.0' });
    controller.sendSession('YOUR_AUTH_TOKEN');
  });
</script>
```

## PWA shell

The web app (`apps/web`) launches the RPS iframe and sends session tokens via `HostEmbedController`.

## Future Capacitor wrapper

Use the same postMessage protocol inside a WebView:

1. Load game URL in WebView.
2. Inject bridge that forwards messages between native shell and game.
3. Pass secure session tokens from native auth — never embed secrets in the game bundle.

Capacitor is **not** installed in this phase.

## Security

- Validate every message with Zod schemas from `@kampi/contracts`
- Restrict `allowedOrigins` — never use `*` in production
- Auth tokens travel host → game only; games do not persist tokens in localStorage for production

See also `docs/security-and-trust-boundaries.md`.
