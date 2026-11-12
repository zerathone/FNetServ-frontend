import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkstationRuntime } from '../src/api/workstations.ts'
import {
  LOGIN_TYPE,
  WORKSTATION_FLAGS,
  ICON_ACTIVITY_LABEL,
  WORKSTATION_STATUS,
  getStatusExtraIcons,
  getWinLicenseView,
  getWorkstationIconView,
  getWorkstationFlags,
  getWorkstationStatus,
  groupMachines,
  hasLeftServiceDebt,
  isComboCardLogin,
  interpolateSession,
  matchesWorkstationFilter,
} from '../src/features/workstations/workstationModel.ts'

function machine(
  patch: Partial<WorkstationRuntime> = {},
): WorkstationRuntime {
  return {
    hostName: 'PC-01',
    ip: '192.168.1.10',
    status: WORKSTATION_STATUS.ONLINE,
    flagMask: 0,
    version: '1.0',
    machineGroupId: 1,
    machineGroupName: 'Khu A',
    userId: 42,
    userName: 'member01',
    userGroupType: 1,
    note: null,
    lockLogin: false,
    session: {
      sessionId: 10,
      loginType: 1,
      prepaid: true,
      startedAt: '2026-07-30 10:00:00',
      usedSeconds: 60,
      remainingSeconds: 120,
      totalAmount: 5000,
      remainingMoney: 20000,
      comboName: null,
    },
    winLicense: null,
    updatedAtMs: 1,
    ...patch,
  }
}

test('running session clock advances locally without changing server money', () => {
  const result = interpolateSession(machine(), 15.9)
  assert.deepEqual(result, { used: 75, remaining: 105 })
})

test('paused and warning sessions keep the snapshot clock', () => {
  const paused = machine({ flagMask: WORKSTATION_FLAGS.CLIENT_PAUSE })
  const warning = machine({ status: WORKSTATION_STATUS.WARNING })
  assert.deepEqual(interpolateSession(paused, 30), { used: 60, remaining: 120 })
  assert.deepEqual(interpolateSession(warning, 30), { used: 60, remaining: 120 })
})

test('operational filters keep debt separate from connected default', () => {
  const connectedDebt = machine({ flagMask: WORKSTATION_FLAGS.HAVE_NOT_PAID })
  const disconnected = machine({ status: WORKSTATION_STATUS.DISCONNECT })
  assert.equal(matchesWorkstationFilter(connectedDebt, 'connected'), true)
  assert.equal(matchesWorkstationFilter(connectedDebt, 'debt'), true)
  assert.equal(matchesWorkstationFilter(disconnected, 'connected'), false)
  assert.equal(matchesWorkstationFilter(disconnected, 'disconnected'), true)
})

test('ADMIN and held-machine labels take priority over generic online status', () => {
  assert.equal(getWorkstationStatus(machine({ userId: 0 })).label, 'ADMIN')
  assert.equal(getWorkstationStatus(machine({ lockLogin: true })).label, 'Giữ máy')
})

test('missing windows license data yields no view at all (cell stays blank)', () => {
  // Khong co du lieu KHAC HAN status 0. Tra ve nhan bat ky o day la nhan vien se doc
  // thanh "may chua kich hoat Windows" tren nhung may chi don gian la chay client cu.
  assert.equal(getWinLicenseView(machine()), null)
})

test('licensed windows exposes label and partial key', () => {
  const view = getWinLicenseView(
    machine({ winLicense: { status: 1, pkey: '78RTG', channel: 'OEM:DM', graceMinutes: null } }),
  )
  assert.equal(view?.label, 'Đã kích hoạt')
  assert.equal(view?.tone, 'success')
  assert.equal(view?.pkey, '78RTG')
  assert.equal(view?.graceText, null)
})

test('grace period only shows remaining time for grace statuses', () => {
  // 4320 phut = 3 ngay. Status 2 (OOB Grace) co y nghia -> hien.
  const grace = getWinLicenseView(
    machine({ winLicense: { status: 2, pkey: 'ABCDE', channel: 'Volume:GVLK', graceMinutes: 4320 } }),
  )
  assert.equal(grace?.graceText, 'Còn 3 ngày')

  // Retail perpetual da activate tra ve 0 -- KHONG duoc hien "het han".
  const perpetual = getWinLicenseView(
    machine({ winLicense: { status: 1, pkey: 'ABCDE', channel: 'Retail', graceMinutes: 0 } }),
  )
  assert.equal(perpetual?.graceText, null)
})

test('getStatusExtraIcons: icon nao cot Trang thai da co san (co no / duoi 18) thi bo, chi giu ve dat cho', () => {
  const flagsDebtMinor = getWorkstationFlags(
    machine({ flagMask: WORKSTATION_FLAGS.HAVE_NOT_PAID | WORKSTATION_FLAGS.USER_UNDER18 }),
  )
  // no + duoi 18 + ve: co "Con no" va "Duoi 18 tuoi" trong cot Trang thai => chi con ve
  assert.deepEqual(getStatusExtraIcons({ debt: true, minor: true, reservation: 'late' }, flagsDebtMinor), ['late'])
  assert.deepEqual(getStatusExtraIcons({ debt: true, minor: true, reservation: 'reserved' }, flagsDebtMinor), ['reserved'])
  assert.deepEqual(getStatusExtraIcons({ debt: true, minor: true, reservation: null }, flagsDebtMinor), [])

  // khong co co nao trong cot Trang thai (vd view bao no nhung co khong co) => icon phu van hien, khong mat thong tin
  assert.deepEqual(getStatusExtraIcons({ debt: true, minor: false, reservation: null }, []), ['debt'])
  assert.deepEqual(getStatusExtraIcons({ debt: false, minor: true, reservation: 'reserved' }, []), ['minor', 'reserved'])
  // co cua loai khac khong lam mat icon: chi co "Dang tam dung" thi no / duoi 18 van phai hien
  const flagsPause = getWorkstationFlags(machine({ flagMask: WORKSTATION_FLAGS.CLIENT_PAUSE }))
  assert.deepEqual(getStatusExtraIcons({ debt: true, minor: true, reservation: null }, flagsPause), ['debt', 'minor'])
})

test('groupMachines: theo thu tu nhom cua quan, giu thu tu may trong nhom, nhom la xep sau, chua gan nhom cuoi, bo nhom rong', () => {
  const m = (host: string, id: number, name: string | null = null) => ({ hostName: host, machineGroupId: id, machineGroupName: name })
  const machines = [m('A1', 2), m('B1', 1), m('A2', 2), m('Z1', 9, 'Phong VIP'), m('N1', 0), m('B2', 1), m('Y1', 7)]
  const sections = groupMachines(machines, [
    { id: 1, name: 'Thuong' },
    { id: 2, name: 'Net' },
    { id: 3, name: 'Rong' },
  ])
  assert.deepEqual(sections.map((s) => [s.groupId, s.name]), [
    [1, 'Thuong'],
    [2, 'Net'],
    [7, 'Nhóm 7'],
    [9, 'Phong VIP'],
    [0, 'Chưa gán nhóm'],
  ])
  assert.deepEqual(sections[0].machines.map((x) => x.hostName), ['B1', 'B2'])
  assert.deepEqual(sections[1].machines.map((x) => x.hostName), ['A1', 'A2'])
  assert.deepEqual(groupMachines([], [{ id: 1, name: 'X' }]), [])
})

test('icon activities: cung dieu kien voi cot Trang thai (goi mon, nhan mon, doi chuyen phi, tam dung, chuyen may, giu may)', () => {
  const F = WORKSTATION_FLAGS
  const view = (flagMask: number, patch: Partial<WorkstationRuntime> = {}, context = {}) =>
    getWorkstationIconView(machine({ status: WORKSTATION_STATUS.ONLINE, userId: 5, flagMask, ...patch }), context)

  assert.deepEqual(view(0).activities, [], 'khong co co => khong chip')
  assert.deepEqual(view(F.SERVICE_ORDER).activities, ['order'])
  assert.deepEqual(
    view(F.SERVICE_ORDER | F.SERVICE_ACCEPT | F.TRANSFER_PAYMENT | F.CLIENT_PAUSE | F.CHANGING_PC).activities,
    ['order', 'accept', 'transfer', 'pause', 'changing'],
    'thu tu co dinh',
  )
  // Cung hanh vi hideServiceAccept cua cot Trang thai.
  assert.deepEqual(view(F.SERVICE_ACCEPT).activities, ['accept'])
  assert.deepEqual(view(F.SERVICE_ACCEPT, {}, { serviceAcceptCleared: true }).activities, [], 'da het no dich vu => bo chip')
  // Giu may: lockLogin hoac co CLIENT_LOCK.
  assert.deepEqual(view(0, { lockLogin: true }).activities, ['lock'])
  assert.deepEqual(view(F.CLIENT_LOCK).activities, ['lock'])
  // Mo ta (tooltip) nhac tung hoat dong, nhung 'Giu may' da la nhan trang thai nen khong lap.
  const d = view(F.SERVICE_ORDER | F.CLIENT_LOCK).description
  assert.ok(d.includes(ICON_ACTIVITY_LABEL.order))
  assert.equal(d.split('Giữ máy').length - 1, 1)
  // Co dung de lam chip khong lam doi cac kenh khac (man hinh / thanh chan de).
  assert.equal(view(F.SERVICE_ORDER).screen, view(0).screen)
})

test('the combo: dung mau "tra truoc" du server khong bat co PrePaid; hoi vien dung combo van la hoi vien', () => {
  const session = (patch: Partial<NonNullable<WorkstationRuntime['session']>>) => ({
    sessionId: 1, loginType: 0, prepaid: false, startedAt: null, usedSeconds: 0, remainingSeconds: null,
    totalAmount: null, remainingMoney: null, comboName: null, anonymId: null, ...patch,
  })
  const online = (patch: Partial<WorkstationRuntime>) =>
    getWorkstationIconView(machine({ status: WORKSTATION_STATUS.ONLINE, userId: 9, ...patch }))

  // Nhan dien theo nhom nguoi dung 5 HOAC loai dang nhap cua phien.
  const byGroup = online({ userGroupType: 5, session: session({ prepaid: false }) })
  assert.equal(byGroup.screen, 'inUse')
  assert.equal(byGroup.bar, 'prepaid', 'the combo: khong con roi vao mau tra sau')
  assert.ok(byGroup.description.includes('Thẻ combo'))
  assert.equal(online({ userGroupType: 1, session: session({ loginType: LOGIN_TYPE.COMBO_CARD }) }).bar, 'prepaid')
  assert.equal(online({ userGroupType: 1, session: session({ loginType: LOGIN_TYPE.COMBO_BOOK }) }).bar, 'prepaid')
  // Chua co phien van la the combo (nhom 5) => van mau tra truoc, khong "none".
  assert.equal(online({ userGroupType: 5, session: null }).bar, 'prepaid')

  // Khong nham: hoi vien dung combo (loginType 7) van la hoi vien; vang lai tra sau van tra sau; vang lai tra truoc giu nguyen.
  assert.equal(online({ userGroupType: 2, session: session({ loginType: LOGIN_TYPE.MEMBER_USE_COMBO }) }).bar, 'member')
  assert.equal(online({ userGroupType: 1, session: session({ loginType: LOGIN_TYPE.ANONYM_PAY_LATER }) }).bar, 'postpaid')
  assert.equal(online({ userGroupType: 1, session: session({ loginType: LOGIN_TYPE.ANONYM_PREPAID, prepaid: true }) }).bar, 'prepaid')
  assert.equal(isComboCardLogin(machine({ userGroupType: 1 })), false)
})

test('bo loc "canh bao" chi nhan may o trang thai WARNING; "con no" theo co HAVE_NOT_PAID; hai bo loc doc lap', () => {
  const warn = machine({ status: WORKSTATION_STATUS.WARNING })
  const debt = machine({ status: WORKSTATION_STATUS.ONLINE, flagMask: WORKSTATION_FLAGS.HAVE_NOT_PAID })
  const ok = machine({ status: WORKSTATION_STATUS.AVAILABLE })
  assert.equal(matchesWorkstationFilter(warn, 'warning'), true)
  assert.equal(matchesWorkstationFilter(debt, 'warning'), false)
  assert.equal(matchesWorkstationFilter(ok, 'warning'), false)
  assert.equal(matchesWorkstationFilter(debt, 'debt'), true)
  assert.equal(matchesWorkstationFilter(warn, 'debt'), false)
  assert.equal(matchesWorkstationFilter(warn, 'all'), true)
})

test('no dich vu khi khach DA ROI: chi may san sang / ngat ket noi co co SERVICE_ACCEPT, tru may da thu het no', () => {
  const ACCEPT = WORKSTATION_FLAGS.SERVICE_ACCEPT
  const at = (status: number, flagMask = ACCEPT) => machine({ status, flagMask })

  assert.equal(hasLeftServiceDebt(at(WORKSTATION_STATUS.AVAILABLE)), true, 'dang xuat, may van bat')
  assert.equal(hasLeftServiceDebt(at(WORKSTATION_STATUS.DISCONNECT)), true, 'tat may / rot ket noi')
  assert.equal(hasLeftServiceDebt(at(WORKSTATION_STATUS.ONLINE)), false, 'khach con ngoi may => chua phai da roi')
  assert.equal(hasLeftServiceDebt(at(WORKSTATION_STATUS.WARNING)), false)
  assert.equal(hasLeftServiceDebt(at(WORKSTATION_STATUS.AVAILABLE, 0)), false, 'khong co co => khong no')

  // Server bat co nay vo dieu kien cho may con giu khach truoc: da thu het no thi bo (cung ham voi cot Trang thai).
  assert.equal(hasLeftServiceDebt(at(WORKSTATION_STATUS.AVAILABLE), () => true), false)
  assert.equal(hasLeftServiceDebt(at(WORKSTATION_STATUS.AVAILABLE), () => false), true)

  // Bo loc dung cung ham, co truyen ham "da thu het no".
  assert.equal(matchesWorkstationFilter(at(WORKSTATION_STATUS.DISCONNECT), 'serviceDebt'), true)
  assert.equal(matchesWorkstationFilter(at(WORKSTATION_STATUS.AVAILABLE), 'serviceDebt', { isServiceAcceptCleared: () => true }), false)
  assert.equal(matchesWorkstationFilter(at(WORKSTATION_STATUS.ONLINE), 'serviceDebt'), false)
})
