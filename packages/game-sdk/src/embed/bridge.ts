import {
  EMBED_PROTOCOL_VERSION,
  EmbedGameToHostMessage,
  EmbedHostToGameMessage,
  isAllowedOrigin,
  parseGameMessage,
  parseHostMessage,
} from '@kampi/contracts';

export type ParentOriginSource = {
  ancestorOrigins?: { length: number; item(index: number): string | null };
  referrer?: string;
};

const LOCAL_WEB_ORIGIN = 'http://localhost:3000';

/**
 * Target origin for iframe → host postMessage.
 * Prefers the real parent (Safari `ancestorOrigins`, then referrer) so production
 * embeds do not post to a baked-in localhost URL.
 */
export function resolveParentOrigin(
  configured?: string,
  source?: ParentOriginSource,
): string {
  const fallback = configured && configured.length > 0 ? configured : LOCAL_WEB_ORIGIN;
  const live: ParentOriginSource | undefined =
    source ??
    (typeof window !== 'undefined'
      ? {
          ancestorOrigins: window.location.ancestorOrigins,
          referrer: document.referrer,
        }
      : undefined);
  const ancestor = live?.ancestorOrigins?.item(0);
  if (ancestor) return ancestor;
  const referrer = live?.referrer;
  if (referrer) {
    try {
      return new URL(referrer).origin;
    } catch {
      /* ignore invalid referrer */
    }
  }
  return fallback;
}

export function embedAllowedOrigins(parentOrigin: string, configured?: string): string[] {
  const origins = new Set<string>([parentOrigin]);
  if (configured) origins.add(configured);
  return [...origins];
}

export type GameEmbedOptions = {
  /** Origin of the host page embedding this game (e.g. web shell). */
  parentOrigin: string;
  allowedOrigins: string[];
  onMessage?: (message: EmbedHostToGameMessage) => void;
};

export type HostEmbedOptions = {
  targetWindow: Window;
  targetOrigin: string;
  allowedOrigins: string[];
  onMessage?: (message: EmbedGameToHostMessage) => void;
};

export class GameEmbedClient {
  private readonly listener: (event: MessageEvent) => void;

  constructor(private readonly options: GameEmbedOptions) {
    if (options.parentOrigin === '*') {
      throw new Error('Wildcard postMessage parent origins are not allowed');
    }
    this.listener = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin, this.options.allowedOrigins)) return;
      if (event.source !== window.parent) return;
      try {
        const message = parseHostMessage(event.data);
        this.options.onMessage?.(message);
      } catch {
        this.postToHost({
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Host message failed validation',
        });
      }
    };
    window.addEventListener('message', this.listener);
  }

  notifyReady(gameSlug: string): void {
    this.postToHost({
      type: 'game_ready',
      protocolVersion: EMBED_PROTOCOL_VERSION,
      gameSlug,
    });
  }

  postToHost(message: EmbedGameToHostMessage): void {
    if (window.parent === window) return;
    window.parent.postMessage(message, this.options.parentOrigin);
  }

  destroy(): void {
    window.removeEventListener('message', this.listener);
  }
}

export class HostEmbedController {
  private readonly listener: (event: MessageEvent) => void;

  constructor(private readonly options: HostEmbedOptions) {
    if (options.targetOrigin === '*') {
      throw new Error('Wildcard postMessage target origins are not allowed');
    }
    this.listener = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin, this.options.allowedOrigins)) return;
      if (event.source !== this.options.targetWindow) return;
      try {
        const message = parseGameMessage(event.data);
        this.options.onMessage?.(message);
      } catch {
        // Ignore invalid messages from untrusted frames
      }
    };
    window.addEventListener('message', this.listener);
  }

  send(message: EmbedHostToGameMessage): void {
    this.options.targetWindow.postMessage(message, this.options.targetOrigin);
  }

  sendSession(authToken: string, playerId?: string): void {
    this.send({ type: 'session', authToken, playerId });
  }

  destroy(): void {
    window.removeEventListener('message', this.listener);
  }
}

export { EMBED_PROTOCOL_VERSION };
