// task 2.22r-D: @novnc/novnc (ghim 1.7.0, MPL-2.0) KHÔNG kèm type TypeScript — shim tối thiểu,
// CHỈ khai báo phần API trang Remote dùng. Đối chiếu node_modules/@novnc/novnc/core/rfb.js.
declare module '@novnc/novnc' {
  export type RfbCredentials = { username?: string; password?: string; target?: string }

  export type RfbOptions = {
    shared?: boolean
    credentials?: RfbCredentials
    repeaterID?: string
    wsProtocols?: string[]
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RfbOptions)
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    focusOnClick: boolean
    qualityLevel: number
    compressionLevel: number
    background: string
    disconnect(): void
    sendCredentials(credentials: RfbCredentials): void
    sendCtrlAltDel(): void
    focus(): void
    blur(): void
  }
}
