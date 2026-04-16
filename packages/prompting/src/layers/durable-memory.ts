export type PromptDurableMemoryItem = {
  kind: 'user_profile' | 'chat_summary';
  text: string;
};

export function renderDurableMemoryLayer(memories: readonly PromptDurableMemoryItem[]): string {
  if (memories.length === 0) {
    return ['# Durable Memory', 'No durable memory was retrieved for this turn.'].join('\n');
  }

  return [
    '# Durable Memory',
    ...memories.map((memory) => `- [${memory.kind}] ${memory.text}`),
  ].join('\n');
}
