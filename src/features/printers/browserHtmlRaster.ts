import type { PrinterBitmapPayload } from '../../api/printer'

const PAPER = {
  1: { logicalWidth: 315, widthDots: 576 as const },
  2: { logicalWidth: 208, widthDots: 384 as const },
}

function isTransparent(color: string) {
  return color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
}

function drawBorderEdge(
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  width: number,
  color: string,
  style: string,
) {
  if (!width || style === 'none' || isTransparent(color)) return

  context.save()
  context.strokeStyle = color
  context.lineWidth = width
  context.setLineDash(style === 'dashed' ? [3, 2] : style === 'dotted' ? [1, 2] : [])
  context.beginPath()
  context.moveTo(fromX, fromY)
  context.lineTo(toX, toY)
  context.stroke()
  context.restore()
}

function drawElementBox(
  context: CanvasRenderingContext2D,
  element: Element,
  origin: DOMRect,
) {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const left = rect.left - origin.left
  const top = rect.top - origin.top

  if (rect.width > 0 && rect.height > 0 && !isTransparent(style.backgroundColor)) {
    context.fillStyle = style.backgroundColor
    context.fillRect(left, top, rect.width, rect.height)
  }

  drawBorderEdge(
    context, left, top, left + rect.width, top,
    Number.parseFloat(style.borderTopWidth), style.borderTopColor, style.borderTopStyle,
  )
  drawBorderEdge(
    context, left + rect.width, top, left + rect.width, top + rect.height,
    Number.parseFloat(style.borderRightWidth), style.borderRightColor, style.borderRightStyle,
  )
  drawBorderEdge(
    context, left, top + rect.height, left + rect.width, top + rect.height,
    Number.parseFloat(style.borderBottomWidth), style.borderBottomColor, style.borderBottomStyle,
  )
  drawBorderEdge(
    context, left, top, left, top + rect.height,
    Number.parseFloat(style.borderLeftWidth), style.borderLeftColor, style.borderLeftStyle,
  )
}

function canvasFont(style: CSSStyleDeclaration) {
  return `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

function textLayoutBox(element: Element) {
  let current: Element | null = element
  while (current) {
    const display = getComputedStyle(current).display
    if (display !== 'inline' && display !== 'contents') return current
    current = current.parentElement
  }
  return element
}

function drawTextRun(
  context: CanvasRenderingContext2D,
  text: string,
  rect: DOMRect,
  parent: Element,
  style: CSSStyleDeclaration,
  origin: DOMRect,
) {
  if (rect.width <= 0 || rect.height <= 0) return

  const fontSize = Number.parseFloat(style.fontSize)
  const layout = textLayoutBox(parent)
  const layoutStyle = getComputedStyle(layout)
  const layoutRect = layout.getBoundingClientRect()
  const configuredLineHeight = Number.parseFloat(layoutStyle.lineHeight)
  const lineHeight = Number.isFinite(configuredLineHeight) ? configuredLineHeight : fontSize * 1.2
  const contentTop = layoutRect.top + Number.parseFloat(layoutStyle.paddingTop)
  const line = Math.max(0, Math.round((rect.top - contentTop) / lineHeight))

  context.save()
  context.font = canvasFont(style)
  context.fillStyle = style.color
  context.textBaseline = 'alphabetic'
  // Use the layout box's line grid, not the word's glyph box. Glyph boxes differ for accented
  // and descender characters, which otherwise makes words such as "TIN" and "nguyen" jump.
  const baseline = contentTop - origin.top + line * lineHeight
    + (lineHeight - fontSize) / 2 + fontSize * 0.8
  context.fillText(text, rect.left - origin.left, baseline)
  context.restore()
}

function drawTextNodes(
  context: CanvasRenderingContext2D,
  root: Node,
  origin: DOMRect,
) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()

  while (node) {
    const text = node.textContent ?? ''
    const parent = node.parentElement
    if (!parent || parent.tagName === 'STYLE' || !text.trim()) {
      node = walker.nextNode()
      continue
    }

    const style = getComputedStyle(parent)
    const wholeRange = document.createRange()
    wholeRange.selectNodeContents(node)
    const wholeLineRects = Array.from(wholeRange.getClientRects())
    const wholeRect = wholeRange.getBoundingClientRect()
    wholeRange.detach()

    // Most receipt values are a single line. Drawing the complete run preserves its browser
    // spacing and kerning, instead of positioning every word independently.
    if (wholeLineRects.length === 1) {
      drawTextRun(context, text, wholeRect, parent, style, origin)
      node = walker.nextNode()
      continue
    }

    const wordPattern = /\S+/g
    let match = wordPattern.exec(text)
    while (match) {
      const range = document.createRange()
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      const rect = range.getBoundingClientRect()
      range.detach()

      if (rect.width > 0 && rect.height > 0) {
        drawTextRun(context, match[0], rect, parent, style, origin)
      }

      match = wordPattern.exec(text)
    }
    node = walker.nextNode()
  }
}

/**
 * Rasterizes the supported receipt HTML without SVG foreignObject. Chromium treats an SVG
 * foreignObject as cross-origin in some configurations, which taints the canvas and makes
 * getImageData unavailable. Drawing from DOM layout information keeps the canvas readable.
 */
export async function renderPrinterHtml(
  printerId: number,
  printerType: 1 | 2,
  html: string,
): Promise<PrinterBitmapPayload> {
  const paper = PAPER[printerType]
  const measure = document.createElement('div')
  measure.setAttribute('aria-hidden', 'true')
  measure.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${paper.logicalWidth}px`,
    'margin:0',
    'padding:0',
    'background:#fff',
    'color:#000',
    'font-family:Arial,sans-serif',
    'pointer-events:none',
  ].join(';')
  const shadow = measure.attachShadow({ mode: 'open' })
  const content = document.createElement('div')
  content.style.cssText = [
    `width:${paper.logicalWidth}px`,
    'margin:0',
    'padding:0',
    'background:#fff',
    'color:#000',
    'font-family:Arial,sans-serif',
  ].join(';')
  content.innerHTML = html
  shadow.appendChild(content)
  document.body.appendChild(measure)

  try {
    const logicalHeight = Math.max(1, Math.ceil(content.scrollHeight))
    const scale = paper.widthDots / paper.logicalWidth
    const heightDots = Math.max(1, Math.ceil(logicalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = paper.widthDots
    canvas.height = heightDots
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.')

    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.scale(scale, scale)
    const origin = content.getBoundingClientRect()
    content.querySelectorAll('*').forEach((element) => drawElementBox(context, element, origin))
    drawTextNodes(context, content, origin)

    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
    const bytesPerRow = paper.widthDots / 8
    const bitmap = new Uint8Array(bytesPerRow * heightDots)
    for (let y = 0; y < heightDots; y += 1) {
      for (let x = 0; x < paper.widthDots; x += 1) {
        const offset = (y * paper.widthDots + x) * 4
        const gray = Math.round(
          rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114,
        )
        if (rgba[offset + 3] > 0 && gray < 128) {
          bitmap[y * bytesPerRow + Math.floor(x / 8)] |= 1 << (7 - (x % 8))
        }
      }
    }

    return {
      printerId,
      width: paper.widthDots,
      height: heightDots,
      bitmap: Array.from(bitmap, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    }
  } finally {
    measure.remove()
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

// Mirrors PrintReceipt::generateTestPrintHtml in the Qt application. Both clients print a
// readable receipt rather than a transport-only stripe pattern.
type TestPrintCafeInfo = {
  cafeName: string
  cafeAddress: string
  cafePhone: string
}

export function printerHtmlTestTemplate(
  printerName: string,
  ipAddress: string,
  type: 1 | 2,
  cafeInfo: TestPrintCafeInfo,
) {
  const paper = type === 1 ? 'K80' : 'K58'
  const dots = '.'.repeat(type === 1 ? 46 : 32)
  const cafeName = cafeInfo.cafeName || 'NET HUB CENTER'
  const cafeAddress = cafeInfo.cafeAddress || 'nguyen thai binh'
  const cafePhone = cafeInfo.cafePhone || '0909090909'
  return `
    <style>
      * { box-sizing: border-box; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      td { padding: 2px 0; font: 15px 'Segoe UI', Arial, sans-serif; overflow-wrap: break-word; }
      .divider { text-align: center; white-space: pre; font-size: 13px; }
    </style>
    <table>
      <tr><td colspan="2" style="padding:5px 0;text-align:center;font-size:18px;font-weight:700;">FNET BILLING</td></tr>
      <tr><td colspan="2" class="divider">${dots}</td></tr>
      <tr><td colspan="2" style="text-align:center;font-weight:700;">THÔNG TIN PHÒNG MÁY</td></tr>
      <tr><td style="width:35%;">Phòng máy:</td><td style="width:65%;text-align:right;font-weight:700;">${escapeHtml(cafeName)}</td></tr>
      <tr><td>Địa chỉ:</td><td style="text-align:right;font-weight:700;">${escapeHtml(cafeAddress)}</td></tr>
      <tr><td>SĐT:</td><td style="text-align:right;font-weight:700;">${escapeHtml(cafePhone)}</td></tr>
      <tr><td colspan="2" class="divider">${dots}</td></tr>
      <tr><td colspan="2" style="text-align:center;font-weight:700;">BẢN IN THỬ NGHIỆM</td></tr>
      <tr><td style="width:35%;">Tên máy in:</td><td style="width:65%;text-align:right;font-weight:700;">${escapeHtml(printerName)}</td></tr>
      <tr><td>Khổ giấy:</td><td style="text-align:right;font-weight:700;">${paper}</td></tr>
      <tr><td>IP Address:</td><td style="text-align:right;font-weight:700;">${escapeHtml(ipAddress)}</td></tr>
      <tr><td colspan="2" class="divider">${dots}</td></tr>
      <tr><td colspan="2" style="text-align:center;font-size:12px;font-style:italic;">Xin chúc mừng! In thử thành công.</td></tr>
    </table>`
}
