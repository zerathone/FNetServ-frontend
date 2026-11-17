import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_TYPES, dataUrlBytes, fitWithin } from './serviceCatalogModel'

// Chuẩn bị ảnh món trước khi gửi: PNG/JPEG, tự thu nhỏ về ≤ 600×600 px (giữ tỉ lệ, không phóng to), ≤ 2MB.
// Cần DOM (canvas) nên tách khỏi serviceCatalogModel (chạy được bằng node --test). Server kiểm lại tất cả.

export type PreparedImage = {
  /** `data:image/...;base64,...` — gửi thẳng làm `imageBase64`. */
  dataUrl: string
  bytes: number
  width: number
  height: number
  /** true nếu ảnh đã bị thu nhỏ / nén lại. */
  resized: boolean
}

function loadImage(file: File): Promise<{ image: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, revoke: () => URL.revokeObjectURL(url) })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Không đọc được ảnh. Chỉ nhận ảnh PNG hoặc JPEG.'))
    }
    image.src = url
  })
}

export async function prepareImageFile(file: File): Promise<PreparedImage> {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Chỉ nhận ảnh PNG hoặc JPEG.')
  }
  const { image, revoke } = await loadImage(file)
  try {
    const natural = { width: image.naturalWidth, height: image.naturalHeight }
    const target = fitWithin(natural.width, natural.height, IMAGE_MAX_SIDE)
    if (target.width === 0) throw new Error('Ảnh không hợp lệ.')
    const resized = target.width !== natural.width || target.height !== natural.height

    // Ảnh đã vừa khung và vừa dung lượng: gửi nguyên bản, không nén lại (không mất chất lượng).
    if (!resized && file.size <= IMAGE_MAX_BYTES) {
      const dataUrl = await readAsDataUrl(file)
      return { dataUrl, bytes: dataUrlBytes(dataUrl), width: target.width, height: target.height, resized: false }
    }

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Trình duyệt không xử lý được ảnh.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, target.width, target.height)

    // Giữ định dạng gốc; PNG vẫn quá 2MB thì chuyển sang JPEG (nền trắng, PNG trong suốt sẽ mất alpha).
    const attempts: Array<{ type: string; quality?: number }> =
      file.type === 'image/png'
        ? [{ type: 'image/png' }, { type: 'image/jpeg', quality: 0.9 }, { type: 'image/jpeg', quality: 0.75 }]
        : [{ type: 'image/jpeg', quality: 0.92 }, { type: 'image/jpeg', quality: 0.8 }, { type: 'image/jpeg', quality: 0.65 }]
    for (const attempt of attempts) {
      if (attempt.type === 'image/jpeg' && file.type === 'image/png') {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-over'
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.restore()
      }
      const dataUrl = canvas.toDataURL(attempt.type, attempt.quality)
      const bytes = dataUrlBytes(dataUrl)
      if (bytes <= IMAGE_MAX_BYTES) {
        return { dataUrl, bytes, width: target.width, height: target.height, resized: true }
      }
    }
    throw new Error('Ảnh quá lớn (tối đa 2MB) ngay cả sau khi nén. Hãy chọn ảnh khác.')
  } finally {
    revoke()
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'))
    reader.readAsDataURL(file)
  })
}
