import type { OperationNotificationSeverity } from '../../api/notifications'

// Âm báo tạo bằng WebAudio — không thêm file âm thanh/dependency. Trình duyệt chặn phát âm tới khi
// người dùng tương tác với trang; bị chặn thì im lặng, không ném lỗi ra ngoài.
let audioContext: AudioContext | null = null

function beep(context: AudioContext, startAt: number, frequency: number) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + 0.24)
}

/** attention: 1 tiếng; urgent/critical: 2 tiếng cao hơn. */
export function playNotificationSound(severity: OperationNotificationSeverity) {
  try {
    if (typeof window === 'undefined' || !window.AudioContext) return
    audioContext ??= new window.AudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume()
    const now = audioContext.currentTime
    if (severity === 'urgent' || severity === 'critical') {
      beep(audioContext, now, 988)
      beep(audioContext, now + 0.26, 988)
    } else {
      beep(audioContext, now, 740)
    }
  } catch {
    // Âm báo chỉ là phụ trợ — không để lỗi âm thanh phá luồng thông báo.
  }
}
