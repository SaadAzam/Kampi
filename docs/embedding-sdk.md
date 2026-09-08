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
<iframe id="kampi-game" src="https://penalty.kampi.fun" allow="fullscreen"></iframe>
<script type="module">
  import { HostEmbedController } from '@kampi/game-sdk/embed';

  const iframe = document.getElementById('kampi-game');
  iframe.addEventListener('load', () => {
    const controller = new HostEmbedController({
      targetWindow: iframe.contentWindow,
      targetOrigin: 'https://penalty.kampi.fun',
      allowedOrigins: ['https://penalty.kampi.fun'],
      onMessage: (msg) => console.log('game event', msg),
    });
    controller.send({ type: 'host_ready', protocolVersion: '1.0.0' });
    // Prefer the bridge — never put bearer tokens in the iframe URL query string
    controller.sendSession('YOUR_AUTH_TOKEN');
  });
</script>
```

## PWA shell

The web app (`apps/web`) launches catalog games in an iframe and sends session tokens via `HostEmbedController` (`@kampi/game-sdk/embed`).

## Future Capacitor wrapper

Use the same postMessage protocol inside a WebView:

1. Load game URL in WebView.
2. Inject bridge that forwards messages between native shell and game.
3. Pass secure session tokens from native auth — never embed secrets in the game bundle.

Capacitor is **not** installed in this phase.

## Security

- Validate every message with Zod schemas from `@kampi/contracts`
- Restrict `allowedOrigins` — never use `*` in production
- Game iframes resolve the host origin at runtime (`location.ancestorOrigins` / referrer) so they do not postMessage to a baked-in localhost URL
- Auth tokens travel host → game only; games do not persist tokens in localStorage for production

See also `docs/security-and-trust-boundaries.md`.
