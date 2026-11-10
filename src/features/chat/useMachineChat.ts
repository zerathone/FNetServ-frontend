import { useCallback } from 'react'
import type { ChatConversation } from '../../api/chat'
import { machineConversation, type ChatMachineRef } from './chatModel'
import { useChatOpenStore } from './chatOpenStore'
import { useChatSummary } from './useChatSummary'
import { useLiveConversation } from './useLiveConversation'

/**
 * Nhắn tin tới MỘT máy qua Chat Center (chat v2) thay cho hộp thoại tin nhắn cũ.
 * - `ready`: kênh chat v2 dùng được VÀ dựng được hội thoại cho máy này. false ⇒ nơi gọi dùng đường cũ
 *   (cờ tắt / Server.exe bản cũ / tên máy server không nhận) — 90% khách không đổi hành vi.
 * - `unread`: số tin khách CHƯA ĐỌC của hội thoại, cùng nguồn với badge ở Chat Center (WS invalidate ⇒ tự đồng bộ).
 */
export function useMachineChat(machine: ChatMachineRef | null | undefined) {
  const { available } = useChatSummary()
  const base = machineConversation(machine)
  const target = available ? base : null
  const live: ChatConversation | null = useLiveConversation(target)
  const openChat = useChatOpenStore((state) => state.open)

  const open = useCallback(() => {
    if (live) openChat(live)
  }, [live, openChat])

  return { ready: Boolean(target), unread: live?.unread ?? 0, open }
}
