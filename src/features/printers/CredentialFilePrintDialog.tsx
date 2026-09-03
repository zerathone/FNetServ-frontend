import { useState, type ChangeEvent } from 'react'
import { Button, Dialog, InlineAlert } from '../../design-system/components'
import { CredentialOutputDialog } from './CredentialOutputDialog'
import {
  decodeCredentialFile,
  parseCredentialText,
  type CredentialKind,
  type PrintableCredential,
} from './credentialPrintModel'

type Props = {
  open: boolean
  kind: CredentialKind
  onClose: () => void
}

export function CredentialFilePrintDialog({ open, kind, onClose }: Props) {
  const [records, setRecords] = useState<PrintableCredential[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)

  const resetAndClose = () => {
    setRecords([])
    setFileName('')
    setError('')
    setReading(false)
    onClose()
  }

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setReading(true)
    setError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = parseCredentialText(kind, decodeCredentialFile(bytes))
      setRecords(parsed)
      setFileName(file.name)
    } catch (readError) {
      setRecords([])
      setFileName(file.name)
      setError(readError instanceof Error ? readError.message : 'Không đọc được file.')
    } finally {
      setReading(false)
    }
  }

  if (records.length) {
    return (
      <CredentialOutputDialog
        open={open}
        records={records}
        sourceLabel={`Đã đọc ${records.length} mục từ ${fileName}.`}
        onClose={resetAndClose}
      />
    )
  }

  return (
    <Dialog
      open={open}
      title={kind === 'member' ? 'In tài khoản từ file Text' : 'In thẻ nạp từ file Text'}
      description="Dữ liệu chỉ được đọc trong trình duyệt và không được tải lên máy chủ."
      size="sm"
      onClose={resetAndClose}
      footer={<Button type="button" variant="secondary" onClick={resetAndClose}>Đóng</Button>}
    >
      <div className="credential-file-picker">
        <label className="ds-field">
          <span className="ds-field__label">Chọn file .txt</span>
          <input
            className="ds-input"
            type="file"
            accept=".txt,text/plain"
            disabled={reading}
            onChange={(event) => void readFile(event)}
          />
          <span className="ds-field__hint">Tối đa 2 MB và 1.000 dòng; hỗ trợ UTF-8, UTF-16LE/BE.</span>
        </label>
        {reading ? <InlineAlert tone="info">Đang kiểm tra file…</InlineAlert> : null}
        {error ? <InlineAlert tone="danger">{fileName ? `${fileName}: ` : ''}{error}</InlineAlert> : null}
        <InlineAlert tone="info">
          {kind === 'member'
            ? 'Mỗi dòng: tên đăng nhập, mật khẩu, số tiền, hạn dùng; các cột cách nhau bằng Tab.'
            : 'Hỗ trợ file 7 cột của FNet cũ và file 4 cột mã thẻ, mệnh giá, hạn dùng, loại ví.'}
        </InlineAlert>
      </div>
    </Dialog>
  )
}
