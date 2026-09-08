export {
  EMBED_PROTOCOL_VERSION,
  isAllowedOrigin,
  parseGameMessage,
  parseHostMessage,
} from '@kampi/contracts';
export type { EmbedGameToHostMessage, EmbedHostToGameMessage } from '@kampi/contracts';

export {
  GameEmbedClient,
  HostEmbedController,
  embedAllowedOrigins,
  resolveParentOrigin,
} from '../embed/bridge.js';
export type { GameEmbedOptions, HostEmbedOptions, ParentOriginSource } from '../embed/bridge.js';
