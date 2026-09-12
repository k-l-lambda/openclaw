// Chooses which projected chat-history messages survive the response budget.
// Split out of the handler so the fork's rawContent bypass and upstream's two
// capping strategies stay together without pushing the handler over its
// max-lines budget.
import { capArrayByJsonBytes } from "../session-transcript-readers.js";
import {
  type createChatHistoryByteCounter,
  trimChatHistoryActivity,
} from "./chat-history-budget.js";
import { capChatHistoryAroundMessage } from "./chat-history-pages.js";

export function selectChatHistoryPageMessages(params: {
  /** Enriched page before oversized-message replacement. */
  normalized: unknown[];
  /** Messages after oversized-message replacement. */
  replacedMessages: unknown[];
  messageId?: string;
  /** Anthroid clients request the whole page and cap it themselves. */
  rawContent?: boolean;
  completeCliImport?: boolean;
  responseHistoryBytes: number;
  byteCounter: ReturnType<typeof createChatHistoryByteCounter>;
}): unknown[] {
  const { byteCounter, messageId, responseHistoryBytes } = params;
  // Terminal imports have no older-page cursor. Anchored reads retain their
  // existing neighborhood selector instead of changing which groups surround the anchor.
  const prioritized =
    params.completeCliImport && !messageId
      ? trimChatHistoryActivity({
          messages: params.replacedMessages,
          maxBytes: responseHistoryBytes,
          byteCounter,
        })
      : params.replacedMessages;
  // When rawContent is requested (Anthroid client), skip size-based truncation
  // and return the full projected page as-is so the client can display complete
  // conversation history. Computed after prioritized so the byte counter sees
  // the same calls it saw before this selection moved out of the handler.
  if (params.rawContent) {
    return params.normalized;
  }
  if (messageId) {
    return capChatHistoryAroundMessage({
      messages: prioritized,
      messageId,
      // A nonempty JSON array costs one framing byte plus each message and its separator.
      maxCost: responseHistoryBytes - 1,
      messageCost: (message) => byteCounter.messageBytes(message) + 1,
    });
  }
  return capArrayByJsonBytes(prioritized, responseHistoryBytes, byteCounter.messageBytes).items;
}
