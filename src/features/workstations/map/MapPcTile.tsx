import { TileName, WorkstationIcon } from '../WorkstationIcon'
import type { WorkstationIconView } from '../workstationModel'
import './map.css'

// Máy trên sơ đồ ở TRÌNH CHỈNH SỬA: cùng icon + cách ghi tên máy trong thân màn hình như ô máy ở màn thu ngân, nhưng tô màn
// hình kiểu máy ĐANG DÙNG (sáng) và KHÔNG có thanh chân đế màu loại khách. Không dùng màu máy tắt: ở giao diện tối nó
// (#1d202b) gần trùng màu nền nên không nhìn thấy. Không có trạng thái / huy hiệu — chỉ là chỗ đặt máy.
const PLACEHOLDER_VIEW: WorkstationIconView = {
  screen: 'inUse',
  bar: 'none',
  rim: 'none',
  debt: false,
  minor: false,
  reservation: null,
  activities: [],
  description: 'Máy trạm',
}

export function MapPcTile({ host, orphan = false }: { host: string; orphan?: boolean }) {
  return (
    <div
      className={`ws-tile ws-tile--screen-inUse wsmap-pctile${orphan ? ' wsmap-pctile--orphan' : ''}`}
      title={orphan ? `${host} — không còn trong danh sách máy trạm` : host}
    >
      <div className="ws-tile__btn">
        <WorkstationIcon view={PLACEHOLDER_VIEW} glyph={false} />
        <TileName text={host} />
      </div>
    </div>
  )
}
