import type { ChatHistoryMessage } from "../graphs/chat-state";

export function selectChatHistory(
  history: ChatHistoryMessage[],
  windowSize: number,
  tokenBudget: number,
  question: string,
): ChatHistoryMessage[] {
  const maximumMessages = Math.max(0, windowSize * 2);
  const remainingCharacters = Math.max(0, tokenBudget * 4 - question.length);
  if (maximumMessages === 0 || remainingCharacters === 0) return [];

  const recent = history.slice(-maximumMessages);
  if (recent.length % 2 !== 0) recent.shift();

  const selected: ChatHistoryMessage[] = [];
  let usedCharacters = 0;
  for (let index = recent.length - 2; index >= 0; index -= 2) {
    const userMessage = recent[index];
    const assistantMessage = recent[index + 1];
    if (
      userMessage?.role !== "user" ||
      assistantMessage?.role !== "assistant"
    ) {
      break;
    }

    const exchangeCharacters =
      userMessage.content.length + assistantMessage.content.length;
    if (usedCharacters + exchangeCharacters > remainingCharacters) break;

    selected.unshift(userMessage, assistantMessage);
    usedCharacters += exchangeCharacters;
  }
  return selected;
}
