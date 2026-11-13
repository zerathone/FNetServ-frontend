import { TileName, WorkstationIcon } from '../WorkstationIcon'
import type { WorkstationIconView } from '../workstationModel'
import './map.css'

// Máy trên sơ đồ ở TRÌNH CHỈNH SỬA: vẽ y như ô máy đang TẮT của màn hình thu ngân (cùng icon, cùng cách ghi tên máy trong
// thân màn hình) để người vẽ thấy đúng hình sẽ hiện thật. Không có trạng thái / huy hiệu — chỉ là chỗ đặt máy.
const OFFLINE_VIEW: WorkstationIconView = {
  screen: 'offline',
  bar: 'none',
  rim: 'none',
  debt: false,
  minor: false,
  reservation: null,
  activities: [],
  description: 'Máy tắt',
}

export function MapPcTile({ host, orphan = false }: { host: string; orphan?: boolean }) {
  return (
    <div
      className={`ws-tile ws-tile--screen-offline wsmap-pctile${orphan ? ' wsmap-pctile--orphan' : ''}`}
      title={orphan ? `${host} — không còn trong danh sách máy trạm` : host}
    >
      <div className="ws-tile__btn">
        <WorkstationIcon view={OFFLINE_VIEW} glyph={false} />
        <TileName text={host} />
      </div>
    </div>
  )
}
