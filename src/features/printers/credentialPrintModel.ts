export type MemberCredential = {
  kind: 'member'
  username: string
  password: string
  initialMoney: number
  expiry: string
}

export type VoucherCredential = {
  kind: 'voucher'
  id?: number
  code: string
  value: number
  expiry: string
  walletType: 0 | 1
  createdDate?: string
  createdTime?: string
}

export type PrintableCredential = MemberCredential | VoucherCredential
export type CredentialKind = PrintableCredential['kind']

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_RECORDS = 1_000

function nonEmptyLines(text: string) {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => Boolean(line.trim()))
}

function parseMoney(value: string, line: number) {
  const normalized = value.replace(/[.\s₫đ]/gi, '').replace(',', '.')
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Dòng ${line}: số tiền không hợp lệ.`)
  }
  return amount
}

function assertRecordLimit(records: PrintableCredential[]) {
  if (!records.length) throw new Error('File không có dữ liệu hợp lệ.')
  if (records.length > MAX_RECORDS) {
    throw new Error(`File có quá ${MAX_RECORDS.toLocaleString('vi-VN')} dòng dữ liệu.`)
  }
  return records
}

export function parseCredentialText(kind: CredentialKind, text: string): PrintableCredential[] {
  const lines = nonEmptyLines(text)
  if (!lines.length) throw new Error('File trống.')

  if (kind === 'member') {
    const hasHeader = /^(tên đăng nhập|username)\t/i.test(lines[0])
    const data = hasHeader ? lines.slice(1) : lines
    return assertRecordLimit(data.map((line, index) => {
      const columns = line.split('\t').map((item) => item.trim())
      const lineNumber = index + (hasHeader ? 2 : 1)
      if (columns.length < 4 || !columns[0] || !columns[1]) {
        throw new Error(`Dòng ${lineNumber}: cần đủ tên đăng nhập, mật khẩu, số tiền và hạn dùng.`)
      }
      return {
        kind: 'member' as const,
        username: columns[0],
        password: columns[1],
        initialMoney: parseMoney(columns[2], lineNumber),
        expiry: columns[3],
      }
    }))
  }

  const firstColumns = lines[0].split('\t')
  const hasHeader = /^(mã thẻ|code|id)$/i.test(firstColumns[0].trim())
  const data = hasHeader ? lines.slice(1) : lines
  return assertRecordLimit(data.map((line, index) => {
    const columns = line.split('\t').map((item) => item.trim())
    const lineNumber = index + (hasHeader ? 2 : 1)
    const legacy = columns.length >= 7
    const code = legacy ? columns[1] : columns[0]
    if (!code || columns.length < 4) {
      throw new Error(`Dòng ${lineNumber}: dữ liệu thẻ nạp không hợp lệ.`)
    }
    const walletValue = legacy ? columns[6] : columns[3]
    const walletType = /^(1|khuyến mãi|vi khuyen mai|promo)/i.test(walletValue) ? 1 : 0
    const id = legacy && /^\d+$/.test(columns[0]) ? Number(columns[0]) : undefined
    return {
      kind: 'voucher' as const,
      id,
      code,
      value: parseMoney(legacy ? columns[2] : columns[1], lineNumber),
      expiry: legacy ? columns[3] : columns[2],
      createdDate: legacy ? columns[4] : undefined,
      createdTime: legacy ? columns[5] : undefined,
      walletType,
    }
  }))
}

export function decodeCredentialFile(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error('File vượt quá giới hạn 2 MB.')
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = bytes.subarray(2).slice()
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      ;[swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]]
    }
    return new TextDecoder('utf-16le').decode(swapped)
  }
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0) {
    return new TextDecoder('utf-16le').decode(bytes)
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export function formatCredentialText(records: PrintableCredential[]) {
  return records.map((record) => {
    if (record.kind === 'member') {
      return [record.username, record.password, record.initialMoney, record.expiry].join('\t')
    }
    return [
      record.id ?? '',
      record.code,
      record.value,
      record.expiry,
      record.createdDate ?? '',
      record.createdTime ?? '',
      record.walletType,
    ].join('\t')
  }).join('\r\n')
}

export function escapePrintHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function credentialTitle(kind: CredentialKind) {
  return kind === 'member' ? 'TÀI KHOẢN HỘI VIÊN' : 'THẺ NẠP TIỀN'
}

export function buildCredentialPrintHtml(records: PrintableCredential[], a4 = false) {
  const cards = records.map((record) => {
    const rows = record.kind === 'member'
      ? [
          ['Tên đăng nhập', record.username],
          ['Mật khẩu', record.password],
          ['Số tiền', `${record.initialMoney.toLocaleString('vi-VN')} đ`],
          ['Hạn dùng', record.expiry || 'Không giới hạn'],
        ]
      : [
          ['Mã thẻ', record.code],
          ['Mệnh giá', `${record.value.toLocaleString('vi-VN')} đ`],
          ['Nạp vào', record.walletType === 0 ? 'Ví chính' : 'Ví khuyến mãi'],
          ['Hạn dùng', record.expiry],
        ]
    return `<section class="credential-card">
      <h2>${credentialTitle(record.kind)}</h2>
      ${rows.map(([label, value]) => `<div class="credential-row"><span>${escapePrintHtml(label)}</span><strong>${escapePrintHtml(value)}</strong></div>`).join('')}
      <p>Giữ kín thông tin này và đổi mật khẩu sau lần đăng nhập đầu tiên.</p>
    </section>`
  }).join('')
  const style = `<style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#000;font-family:Arial,sans-serif}
    .credential-card{${a4 ? 'width:86mm;min-height:52mm;display:inline-block;vertical-align:top;margin:5mm;' : 'padding:8px 4px;border-bottom:1px dashed #000;'}font-size:12px;break-inside:avoid;border:1px solid #000}
    h2{margin:0 0 8px;text-align:center;font-size:15px}.credential-row{display:flex;justify-content:space-between;gap:8px;margin:4px 0}.credential-row strong{text-align:right;overflow-wrap:anywhere}.credential-card p{margin:8px 0 0;border-top:1px dashed #000;padding-top:6px;text-align:center;font-size:10px}
    @media print{@page{size:A4;margin:10mm}body{print-color-adjust:exact}}
  </style>`
  return `${style}${cards}`
}
