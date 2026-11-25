import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import {
  ArrowCounterClockwise,
  CurrencyCircleDollar,
  Folders,
  ImageSquare,
  Images,
  Percent,
  Ruler,
  Tag,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { getMaterials, getRecipeConfig, getUnits, saveRecipe, saveToppings } from '../../api/inventory'
import {
  clearServiceImage,
  getServiceGroups,
  getServiceImage,
  saveService,
  saveServiceGroup,
  saveServiceImage,
  selectServiceImage,
  setServiceGroupActive,
  type ServiceGroupRow,
} from '../../api/serviceCatalog'
import { getServices, type ServiceItem } from '../../api/services'
import {
  Button,
  ConfirmAction,
  Dialog,
  IconButton,
  InlineAlert,
  RadioCards,
  Select,
  StateView,
  StatusBadge,
  Switch,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { describeInventoryError } from '../inventory/inventoryModel'
import { RecipeFields, ToppingFields } from '../inventory/RecipeFields'
import {
  emptyRecipeDraft,
  emptyToppingDraft,
  nextDraftKey,
  recipeChanged,
  recipeDraftForGroup,
  recipeDraftFromConfig,
  recipeSaveBody,
  toppingChanged,
  toppingDraftFromConfig,
  toppingSaveBody,
  validateRecipe,
  validateTopping,
  type RecipeDraft,
  type ToppingDraft,
} from '../inventory/recipeDraftModel'
import { ImageLibraryDialog } from './ImageLibraryDialog'
import { prepareImageFile, type PreparedImage } from './imageUpload'
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_SIDE,
  RIGHT_SERVICE_EDIT,
  compareGroups,
  draftFromGroup,
  draftFromService,
  describeCatalogError,
  emptyServiceDraft,
  GROUP_TYPE_NORMAL,
  GROUP_TYPE_TOPPING,
  groupChoices,
  groupSaveBody,
  groupTypeLabel,
  groupTypeLocked,
  inventoryFlagChanged,
  nextGroupOrder,
  pendingOrdersOf,
  parsePrice,
  parseVatInput,
  pendingOrderStatus,
  planGroupMove,
  serviceSaveBody,
  validateGroupDraft,
  validateServiceDraft,
  validateServiceName,
  type PendingOrdersInfo,
  type ServiceDraft,
} from './serviceCatalogModel'

const money = new Intl.NumberFormat('vi-VN')

/** Làm mới mọi nơi dùng danh mục: trang này, trang Kho (cùng danh sách dịch vụ), menu gọi món. */
function invalidateCatalog(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['services'] })
  void queryClient.invalidateQueries({ queryKey: ['inventory'] })
}

// ===== Thêm / sửa mặt hàng (dịch vụ & hàng hóa) =====

/**
 * Ô nhập kiểu form thêm hội viên (`Field` của CreateUserDialog): ô tiền tố chứa icon + ô nhập trong cùng một khung;
 * chữ hiển thị là placeholder, tên đầy đủ của trường nằm ở tooltip và cho trình đọc màn hình.
 */
function SvcField({
  id,
  label,
  icon,
  invalid,
  children,
}: {
  id: string
  label: string
  icon: ReactNode
  invalid?: boolean
  children: ReactNode
}) {
  const groupClasses = ['ds-input-group', 'svc-field__group']
  if (invalid) groupClasses.push('is-invalid')
  return (
    <div className="ds-field svc-field">
      <div className={groupClasses.join(' ')}>
        <label className="ds-input-group-separator svc-field__label" htmlFor={id} title={label}>
          {icon}
          <span className="ds-visually-hidden">{label}</span>
        </label>
        {children}
      </div>
    </div>
  )
}

export function ServiceEditorDialog({
  service,
  open,
  onClose,
  onPendingOrders,
}: {
  /** null = thêm mới. */
  service: ServiceItem | null
  open: boolean
  onClose: () => void
  /** Server từ chối đổi cờ quản lý tồn vì còn đơn treo ⇒ trang cha hiện danh sách đơn. */
  onPendingOrders: (info: PendingOrdersInfo, serviceName: string) => void
}) {
  const queryClient = useQueryClient()
  const canConfigure = useAuthStore((s) => s.hasRight)(RIGHT_SERVICE_EDIT)
  const unitsQuery = useQuery({ queryKey: ['inventory', 'units'], queryFn: getUnits, enabled: open })
  const groupsQuery = useQuery({ queryKey: ['services', 'groups'], queryFn: getServiceGroups, enabled: open })
  const materialsQuery = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: true, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: true, lowOnly: false, limit: 1000 }),
    enabled: open,
  })
  const servicesQuery = useQuery({ queryKey: ['services'], queryFn: getServices, enabled: open })
  // Cấu hình công thức/món bán kèm chỉ đọc được khi món đã có id (sửa). Không tự làm mới giữa chừng — sẽ đè bản nháp.
  const configQuery = useQuery({
    queryKey: ['inventory', 'recipe-config', service?.id ?? 0],
    queryFn: () => getRecipeConfig(service?.id ?? 0),
    enabled: open && service !== null,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft)
  const [groupKind, setGroupKind] = useState<'normal' | 'topping'>('normal')
  const [touched, setTouched] = useState(false)
  // Bản nháp công thức/món bán kèm + bản gốc lúc mở (để chỉ gửi phần đã đổi). null = chưa nạp xong.
  const [recipe, setRecipe] = useState<RecipeDraft>(emptyRecipeDraft)
  const [topping, setTopping] = useState<ToppingDraft>(emptyToppingDraft)
  const [initial, setInitial] = useState<{ recipe: RecipeDraft; topping: ToppingDraft } | null>(null)
  const loadedFor = useRef<number | null>(null)
  // Ảnh: keep = giữ nguyên; new = ảnh vừa chọn (đã thu nhỏ); clear = gỡ ảnh hiện có.
  // library = ảnh có sẵn trong thư viện (chỉ đổi tên file gắn cho món, không tải lên).
  const [imageDraft, setImageDraft] = useState<
    | { action: 'keep' }
    | { action: 'clear' }
    | ({ action: 'new' } & PreparedImage)
    | { action: 'library'; name: string; dataUrl: string }
  >({ action: 'keep' })
  const [imageBusy, setImageBusy] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // Server cũ / DB thiếu cột ⇒ món sửa không có `vatPercent`/`serviceImg` ⇒ ẩn mục tương ứng (món mới: luôn hiện).
  const vatSupported = service === null || service.vatPercent !== undefined
  const imageSupported = service === null || service.serviceImg !== undefined
  const hasStoredImage = service !== null && (service.serviceImg ?? '') !== ''
  const imageQuery = useQuery({
    queryKey: ['services', 'image', service?.id ?? 0, service?.serviceImg ?? ''],
    queryFn: () => getServiceImage(service?.id ?? 0),
    enabled: open && hasStoredImage,
    staleTime: Infinity,
  })

  const groups = useMemo(() => groupsQuery.data?.rows ?? [], [groupsQuery.data])
  const materials = useMemo(() => materialsQuery.data?.rows ?? [], [materialsQuery.data])
  const allServices = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])

  useEffect(() => {
    if (!open) return
    const next = service ? draftFromService(service) : emptyServiceDraft()
    setDraft(next)
    setTouched(false)
    setGroupKind(service?.groupTypeId === GROUP_TYPE_TOPPING ? 'topping' : 'normal')
    setImageDraft({ action: 'keep' })
  }, [open, service])

  // Nạp công thức/món bán kèm đúng MỘT lần mỗi lần mở (theo id món; 0 = món mới).
  useEffect(() => {
    if (!open) {
      loadedFor.current = null
      setInitial(null)
      return
    }
    const key = service?.id ?? 0
    if (loadedFor.current === key) return
    if (service === null) {
      const r = emptyRecipeDraft()
      const t = emptyToppingDraft()
      setRecipe(r)
      setTopping(t)
      setInitial({ recipe: r, topping: t })
      loadedFor.current = key
      return
    }
    const config = configQuery.data
    if (config?.supported) {
      const r = recipeDraftFromConfig(config)
      const t = toppingDraftFromConfig(config)
      setRecipe(r)
      setTopping(t)
      setInitial({ recipe: r, topping: t })
      loadedFor.current = key
    }
  }, [open, service, configQuery.data])

  const patch = (change: Partial<ServiceDraft>) => {
    setTouched(true)
    setDraft((current) => ({ ...current, ...change }))
  }

  const previewSrc =
    imageDraft.action === 'new' || imageDraft.action === 'library'
      ? imageDraft.dataUrl
      : imageDraft.action === 'keep' && imageQuery.data?.hasImage && imageQuery.data.imageBase64
        ? `data:${imageQuery.data.mime ?? 'image/jpeg'};base64,${imageQuery.data.imageBase64}`
        : ''

  const onPickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // chọn lại cùng một tệp vẫn kích hoạt onChange
    if (!file) return
    setImageBusy(true)
    try {
      setImageDraft({ action: 'new', ...(await prepareImageFile(file)) })
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Không xử lý được ảnh.', 'error')
    } finally {
      setImageBusy(false)
    }
  }

  // Chọn từ thư viện: tải ảnh đầy đủ để xem trước (hộp thoại thư viện chỉ có hình thu nhỏ).
  const onPickLibrary = async (name: string) => {
    setLibraryOpen(false)
    setImageBusy(true)
    try {
      const data = await getServiceImage({ name })
      if (!data.hasImage || !data.imageBase64) {
        pushToast('Không đọc được ảnh này trong thư viện.', 'error')
        return
      }
      setImageDraft({
        action: 'library',
        name,
        dataUrl: `data:${data.mime ?? 'image/jpeg'};base64,${data.imageBase64}`,
      })
    } catch (error) {
      pushToast(describeCatalogError(error), 'error')
    } finally {
      setImageBusy(false)
    }
  }

  // Phần công thức/món bán kèm hiện khi DB có bảng (món mới: theo bảng nguyên liệu; sửa: theo cấu hình của món).
  const configurable =
    materialsQuery.data?.supported !== false && (service === null || configQuery.data?.supported !== false)
  const configLoading = service !== null && configQuery.isLoading
  const configError = service !== null && configQuery.isError
  const configReady = initial !== null && configurable && canConfigure

  const mutation = useMutation({
    mutationFn: async () => {
      const saved = await saveService(serviceSaveBody(draft, service))
      const failures: string[] = []
      if (configReady && initial) {
        // Công thức/món bán kèm là endpoint riêng (xoá-hết-ghi-lại) — chỉ gửi phần đã đổi.
        if (recipeChanged(initial.recipe, recipe)) {
          try {
            await saveRecipe(recipeSaveBody(saved.serviceId, recipe))
          } catch (error) {
            failures.push(`công thức nguyên liệu (${describeInventoryError(error)})`)
          }
        }
        if (toppingChanged(initial.topping, topping)) {
          try {
            await saveToppings(toppingSaveBody(saved.serviceId, topping))
          } catch (error) {
            failures.push(`món bán kèm (${describeInventoryError(error)})`)
          }
        }
      }
      // Ảnh: route riêng (quyền 62). Chỉ gọi khi người dùng đã chọn ảnh mới / gỡ ảnh.
      if (imageSupported && canConfigure) {
        try {
          if (imageDraft.action === 'new') {
            await saveServiceImage({ serviceId: saved.serviceId, imageBase64: imageDraft.dataUrl })
          } else if (imageDraft.action === 'library') {
            await selectServiceImage({ serviceId: saved.serviceId, name: imageDraft.name })
          } else if (imageDraft.action === 'clear' && hasStoredImage) {
            await clearServiceImage(saved.serviceId)
          }
        } catch (error) {
          failures.push(`hình ảnh (${describeCatalogError(error)})`)
        }
      }
      return { ...saved, failures }
    },
    onSuccess: (result) => {
      invalidateCatalog(queryClient)
      if (result.failures.length === 0) {
        pushToast(result.created ? 'Đã thêm mặt hàng.' : 'Đã lưu mặt hàng.', 'success')
        onClose()
        return
      }
      const what = result.failures.join('; ')
      if (result.created) {
        // Món đã có id: bấm Lưu lần nữa sẽ tạo món thứ hai ⇒ đóng form, người dùng mở lại món để cấu hình tiếp.
        pushToast(`Đã thêm mặt hàng nhưng chưa lưu được ${what}. Mở lại món để cấu hình tiếp.`, 'error')
        onClose()
        return
      }
      pushToast(`Đã lưu mặt hàng nhưng chưa lưu được ${what}.`, 'error')
    },
    onError: (error) => {
      const pending = pendingOrdersOf(error)
      if (pending) {
        onPendingOrders(pending, draft.name.trim() || service?.name || '')
        return
      }
      pushToast(describeCatalogError(error), 'error')
    },
  })

  const selfId = service?.id ?? 0
  const configProblem = configReady
    ? (validateRecipe(recipe) ?? validateTopping(selfId, topping))
    : null
  const problem = validateServiceDraft(draft) ?? configProblem
  const choices = groupChoices(groups, service?.groupId ?? 0)
  const shown = groupKind === 'topping' ? choices.topping : choices.normal
  const units = (unitsQuery.data?.rows ?? []).filter((u) => u.isActive === 1 || u.id === draft.unitId)
  const flagChanging = inventoryFlagChanged(service, draft)

  return (
    <>
    <Dialog
      open={open}
      title={service ? 'Sửa mặt hàng' : 'Thêm mặt hàng'}
      description={
        service
          ? 'Tồn kho không sửa ở đây — nhập kho/kiểm kê ở trang Kho. Ngừng bán dùng nút riêng trên thẻ món.'
          : 'Món mới có tồn = 0. Bật “Quản lý tồn kho” rồi nhập kho ở trang Kho để bán.'
      }
      size="lg"
      // Thư viện ảnh đang mở: Esc/bấm nền chỉ đóng thư viện, không đóng luôn form.
      onClose={mutation.isPending || libraryOpen ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={mutation.isPending}
            disabled={problem !== null}
            title={problem ?? undefined}
            onClick={() => mutation.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="svc-form">
        {/* Đầu form — theo style form thêm hội viên: ô nhập dạng "icon + ô" (nhãn là placeholder, tên đầy đủ ở tooltip),
            fieldset có legend, khung hình ảnh dạng thẻ + nút icon bên phải. */}
        <div className={`svc-top svc-form__wide${imageSupported ? '' : ' svc-top--noimg'}`}>
          <fieldset className="svc-top__main">
            <legend>Thông tin mặt hàng</legend>
            <SvcField
              id="svc-name"
              label="Tên mặt hàng"
              icon={<Tag size={18} weight="bold" aria-hidden="true" />}
              invalid={touched && validateServiceName(draft.name) !== null}
            >
              <input
                id="svc-name"
                className="ds-input"
                placeholder="Tên mặt hàng *"
                value={draft.name}
                maxLength={50}
                autoFocus
                autoComplete="off"
                aria-required="true"
                aria-invalid={touched && validateServiceName(draft.name) !== null}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </SvcField>
            <div className={`svc-top__row${vatSupported ? '' : ' svc-top__row--2'}`}>
              <SvcField
                id="svc-price"
                label="Giá bán (đồng)"
                icon={<CurrencyCircleDollar size={18} weight="bold" aria-hidden="true" />}
                invalid={touched && parsePrice(draft.price) === null}
              >
                <input
                  id="svc-price"
                  className="ds-input"
                  inputMode="numeric"
                  placeholder="Giá bán (đồng) *"
                  autoComplete="off"
                  aria-required="true"
                  value={draft.price}
                  onChange={(e) => patch({ price: e.target.value })}
                />
              </SvcField>
              {vatSupported ? (
                <SvcField
                  id="svc-vat"
                  label="VAT (%) — để trống: không áp dụng thuế; 0: thuế 0%"
                  icon={<Percent size={18} weight="bold" aria-hidden="true" />}
                  invalid={touched && parseVatInput(draft.vat) === null}
                >
                  <input
                    id="svc-vat"
                    className="ds-input"
                    inputMode="numeric"
                    placeholder="VAT (%)"
                    maxLength={3}
                    autoComplete="off"
                    value={draft.vat}
                    aria-invalid={touched && parseVatInput(draft.vat) === null}
                    onChange={(e) => {
                      if (/^\d{0,3}$/.test(e.target.value)) patch({ vat: e.target.value })
                    }}
                  />
                </SvcField>
              ) : null}
              <SvcField id="svc-unit" label="Đơn vị tính" icon={<Ruler size={18} weight="bold" aria-hidden="true" />}>
                <Select
                  id="svc-unit"
                  className="ds-select"
                  value={draft.unitId}
                  onChange={(e) => patch({ unitId: Number(e.target.value) })}
                >
                  <option value={0}>Đơn vị tính</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unit}
                    </option>
                  ))}
                </Select>
              </SvcField>
            </div>
            {vatSupported ? (
              <small className="ds-field__hint">
                VAT: để trống = không áp dụng thuế cho món; nhập 0 = thuế 0% (vẫn gửi sang bên thuế).
              </small>
            ) : null}
            {/* Nhóm dịch vụ: MỘT khối liền — hàng đầu (icon + loại nhóm) và hàng tag nhóm chung một khung, ngăn bằng đường kẻ. */}
            <div
              className={`svc-groupblock${touched && draft.groupId <= 0 ? ' is-invalid' : ''}`}
              role="group"
              aria-label="Nhóm dịch vụ"
            >
              <div className="svc-groupblock__head">
                <span className="svc-field__label" title="Nhóm dịch vụ">
                  <Folders size={18} weight="bold" aria-hidden="true" />
                </span>
                <RadioCards
                  ariaLabel="Loại nhóm"
                  value={groupKind}
                  onChange={(kind) => {
                    setGroupKind(kind)
                    // Công thức đang bật: nhóm kèm thêm chỉ 1 nguyên liệu, nhóm thường nhiều nguyên liệu (dữ liệu của kiểu
                    // bên kia được giữ để đổi lại nhóm không mất).
                    setRecipe((cur) => recipeDraftForGroup(cur, kind === 'topping'))
                    const list = kind === 'topping' ? choices.topping : choices.normal
                    if (!list.some((g) => g.groupId === draft.groupId)) patch({ groupId: 0 })
                  }}
                  options={[
                    { value: 'normal', label: groupTypeLabel(GROUP_TYPE_NORMAL) },
                    { value: 'topping', label: groupTypeLabel(GROUP_TYPE_TOPPING) },
                  ]}
                />
              </div>
              <div className="svc-groupblock__body">
                {shown.length === 0 ? (
                  <small className="svc-muted">Chưa có nhóm đang dùng.</small>
                ) : (
                  <div className="svc-tags" role="radiogroup" aria-label="Nhóm dịch vụ">
                    {shown.map((g) => {
                      const selected = g.groupId === draft.groupId
                      // Sửa món: đã chọn nhóm khác thì tag nhóm đang lưu được viền để biết "từ đâu sang".
                      const previous = !selected && service !== null && g.groupId === service.groupId
                      return (
                        <button
                          key={g.groupId}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          title={previous ? 'Nhóm hiện tại của món' : undefined}
                          className={['svc-tag', selected ? 'is-selected' : '', previous ? 'is-previous' : ''].filter(Boolean).join(' ')}
                          onClick={() => patch({ groupId: g.groupId })}
                        >
                          {g.active === 1 ? g.name : `${g.name} (ngừng dùng)`}
                        </button>
                      )
                    })}
                  </div>
                )}
                {groupKind === 'topping' ? (
                  <small className="svc-muted">Món trong nhóm kèm thêm là món kèm thêm, không hiện ở menu bán lẻ.</small>
                ) : null}
              </div>
            </div>
          </fieldset>

          {imageSupported ? (
            <aside className="svc-top__rail" aria-label="Hình ảnh dịch vụ">
              <div className="svc-image-card">
                <div className="svc-image-frame">
                  {previewSrc ? (
                    <img src={previewSrc} alt={draft.name.trim() || 'Ảnh dịch vụ'} />
                  ) : (
                    <ImageSquare className="svc-image__placeholder" size={56} weight="light" role="img" aria-label="Chưa có hình" />
                  )}
                </div>
                <div className="svc-image-actions">
                  <input
                    ref={fileInput}
                    type="file"
                    className="ds-visually-hidden"
                    accept="image/png,image/jpeg"
                    tabIndex={-1}
                    onChange={(e) => void onPickImage(e)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="svc-image-icon-action"
                    icon={<UploadSimple size={18} weight="bold" aria-hidden="true" />}
                    aria-label="Chọn ảnh"
                    title="Chọn ảnh từ máy"
                    loading={imageBusy}
                    disabled={!canConfigure}
                    onClick={() => fileInput.current?.click()}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="svc-image-icon-action"
                    icon={<Images size={18} weight="bold" aria-hidden="true" />}
                    aria-label="Thư viện ảnh"
                    title="Chọn một ảnh có sẵn trong thư viện (dùng chung với iCafe)"
                    disabled={!canConfigure || imageBusy}
                    onClick={() => setLibraryOpen(true)}
                  />
                  {imageDraft.action === 'new' || imageDraft.action === 'library' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="svc-image-icon-action"
                      icon={<ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" />}
                      aria-label="Bỏ ảnh vừa chọn"
                      title="Bỏ ảnh vừa chọn"
                      onClick={() => setImageDraft({ action: 'keep' })}
                    />
                  ) : imageDraft.action === 'clear' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="svc-image-icon-action"
                      icon={<ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" />}
                      aria-label="Giữ lại ảnh cũ"
                      title="Giữ lại ảnh cũ"
                      onClick={() => setImageDraft({ action: 'keep' })}
                    />
                  ) : previewSrc ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="svc-image-icon-action"
                      icon={<Trash size={18} weight="bold" aria-hidden="true" />}
                      aria-label="Gỡ ảnh"
                      title="Gỡ ảnh"
                      disabled={!canConfigure}
                      onClick={() => setImageDraft({ action: 'clear' })}
                    />
                  ) : null}
                </div>
              </div>
              <small className="ds-field__hint">
                {imageDraft.action === 'new'
                  ? `Ảnh mới ${imageDraft.width}×${imageDraft.height} px, ${Math.max(1, Math.round(imageDraft.bytes / 1024))} KB${imageDraft.resized ? ' (đã tự thu nhỏ)' : ''} — lưu cùng lúc với dịch vụ.`
                  : imageDraft.action === 'library'
                    ? `Ảnh thư viện “${imageDraft.name}” — lưu cùng lúc với dịch vụ.`
                    : imageDraft.action === 'clear'
                      ? 'Ảnh sẽ được gỡ khi lưu.'
                      : hasStoredImage && imageQuery.data && !imageQuery.data.hasImage
                        ? `Không tìm thấy tệp ảnh “${service?.serviceImg}” trong thư mục ảnh.`
                        : `PNG hoặc JPEG, tối đa ${IMAGE_MAX_SIDE}×${IMAGE_MAX_SIDE} px và ${IMAGE_MAX_BYTES / (1024 * 1024)}MB — ảnh lớn hơn sẽ tự thu nhỏ.`}
              </small>
            </aside>
          ) : null}
        </div>
        <div className="svc-form__wide">
          <Switch
            checked={draft.inventoryManagement}
            onCheckedChange={(checked) => patch({ inventoryManagement: checked })}
            label="Quản lý tồn kho"
            description={
              draft.inventoryManagement
                ? 'Món quản lý tồn chỉ hiện ở menu bán khi còn tồn > 0 — nhập kho ở tab Kho hàng hóa.'
                : 'Không theo dõi số lượng tồn của món này.'
            }
          />
          {service ? (
            <small className="svc-muted">Chỉ đổi được khi tồn = 0 và món không còn đơn chưa hoàn tất.</small>
          ) : null}
        </div>
        {draft.inventoryManagement ? (
          <label className="ds-field svc-form__wide">
            <span className="ds-field__label">Cảnh báo khi tồn ≤ (để trống = không cảnh báo)</span>
            <input
              className="ds-input"
              inputMode="numeric"
              placeholder="Ví dụ: 5"
              value={draft.warning}
              onChange={(e) => patch({ warning: e.target.value })}
            />
          </label>
        ) : null}
        {!service ? (
          <div className="svc-form__wide">
            <Switch
              checked={draft.active}
              onCheckedChange={(checked) => patch({ active: checked })}
              label="Bán ngay"
              description="Tắt nếu muốn tạo sẵn nhưng chưa hiện ở menu."
            />
          </div>
        ) : null}
        {configLoading ? (
          <p className="svc-muted svc-form__wide">Đang tải công thức và món bán kèm…</p>
        ) : configError ? (
          <div className="svc-form__wide">
            <InlineAlert tone="warning">
              Không tải được công thức và món bán kèm của món này: {describeInventoryError(configQuery.error)} Các mục khác
              vẫn lưu bình thường.
            </InlineAlert>
          </div>
        ) : null}
        {configurable && !configLoading && !configError ? (
          <>
            <section className="inv-block svc-form__wide" aria-label="Công thức nguyên liệu">
              {/* Không có <h3> riêng: nhãn công tắc "Có công thức nguyên liệu" đã là tiêu đề (tránh lặp 2 dòng). */}
              <RecipeFields
                draft={recipe}
                onChange={setRecipe}
                materials={materials}
                disabled={!configReady}
                toppingGroup={groupKind === 'topping'}
              />
              {service && initial && recipe.mode === 'none' && initial.recipe.mode !== 'none' ? (
                <InlineAlert tone="info">
                  Lưu sẽ gỡ công thức hiện có; món này không còn trừ nguyên liệu khi bán.
                </InlineAlert>
              ) : null}
            </section>
            <section className="inv-block svc-form__wide" aria-label="Món bán kèm">
              <h3>Món bán kèm</h3>
              <Switch
                checked={topping.enabled}
                disabled={!configReady}
                onCheckedChange={(checked) =>
                  setTopping((cur) => ({
                    ...cur,
                    enabled: checked,
                    lines:
                      checked && cur.lines.length === 0
                        ? [{ key: nextDraftKey(), serviceId: 0, qty: '', price: '' }]
                        : cur.lines,
                  }))
                }
                label="Có món bán kèm"
                description="Khách chọn thêm món/nguyên liệu khi gọi món này (ví dụ topping trà sữa)."
              />
              {topping.enabled ? (
                <ToppingFields
                  draft={topping}
                  onChange={setTopping}
                  services={allServices}
                  selfId={selfId}
                  disabled={!configReady}
                />
              ) : null}
              {configProblem ? <span className="inv-error">{configProblem}</span> : null}
              {!canConfigure ? (
                <small className="svc-muted">Cần quyền Sửa dịch vụ (62) để cấu hình công thức và món bán kèm.</small>
              ) : null}
            </section>
          </>
        ) : null}
        {flagChanging ? (
          <div className="svc-form__wide">
            <InlineAlert tone="warning">
              Đổi chế độ quản lý tồn: máy chủ sẽ từ chối nếu món còn tồn hoặc còn đơn chưa hoàn tất.
            </InlineAlert>
          </div>
        ) : null}
        {touched && problem ? (
          <div className="svc-form__wide">
            <InlineAlert tone="warning">{problem}</InlineAlert>
          </div>
        ) : null}
      </div>
    </Dialog>
    <ImageLibraryDialog
      open={open && libraryOpen}
      currentName={imageDraft.action === 'library' ? imageDraft.name : (service?.serviceImg ?? '')}
      onClose={() => setLibraryOpen(false)}
      onPick={(name) => void onPickLibrary(name)}
    />
    </>
  )
}

// ===== Đơn treo chặn đổi cờ quản lý tồn =====

export function PendingOrdersDialog({
  info,
  serviceName,
  onClose,
}: {
  info: PendingOrdersInfo | null
  serviceName: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const hidden = info ? Math.max(0, info.total - info.orders.length) : 0
  return (
    <Dialog
      open={info !== null}
      title="Món còn đơn chưa hoàn tất"
      description={`Món [${serviceName}] còn ${info?.total ?? 0} đơn — hoàn tất hoặc huỷ các đơn này trước khi đổi chế độ quản lý tồn.`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onClose()
              navigate('/orders')
            }}
          >
            Mở trang Đơn hàng
          </Button>
        </>
      }
    >
      <div className="svc-table-wrap">
        <table className="svc-table">
          <thead>
            <tr>
              <th>Khách</th>
              <th>Món</th>
              <th className="is-num">SL</th>
              <th className="is-num">Tiền</th>
              <th>Trạng thái</th>
              <th>Ngày giờ</th>
            </tr>
          </thead>
          <tbody>
            {(info?.orders ?? []).map((order) => (
              <tr key={order.serviceDetailId}>
                <td>{order.userName || `#${order.userId}`}</td>
                <td>{order.serviceName}</td>
                <td className="is-num">{order.quantity}</td>
                <td className="is-num">{money.format(order.serviceAmount)} đ</td>
                <td>
                  <StatusBadge tone={order.accept === 1 ? 'info' : 'warning'}>{pendingOrderStatus(order)}</StatusBadge>
                </td>
                <td>{`${order.serviceDate} ${order.serviceTime}`.trim()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? <p className="svc-muted">Còn {hidden} đơn nữa không hiển thị ở đây.</p> : null}
      <p className="svc-muted">Trang này không tự huỷ đơn hộ — xử lý từng đơn ở trang Đơn hàng rồi quay lại đổi.</p>
    </Dialog>
  )
}

// ===== Nhóm dịch vụ =====

export function GroupsDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const groupsQuery = useQuery({ queryKey: ['services', 'groups'], queryFn: getServiceGroups, enabled: open })
  const rows = useMemo(() => [...(groupsQuery.data?.rows ?? [])].sort(compareGroups), [groupsQuery.data])
  const [editing, setEditing] = useState<{ group: ServiceGroupRow | null } | null>(null)
  const [draft, setDraft] = useState(() => draftFromGroup(null))
  const [toggling, setToggling] = useState<ServiceGroupRow | null>(null)
  /** Nhóm vừa được bấm lên/xuống — tô nền để người dùng thấy dòng đã nhảy đi đâu. */
  const [movedId, setMovedId] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setEditing(null)
      setToggling(null)
      setMovedId(null)
    }
  }, [open])

  const startEdit = (group: ServiceGroupRow | null) => {
    setDraft(draftFromGroup(group))
    setEditing({ group })
  }

  const saveMutation = useMutation({
    mutationFn: () => saveServiceGroup(groupSaveBody(draft, editing?.group ?? null, nextGroupOrder(rows))),
    onSuccess: (result) => {
      pushToast(result.created ? 'Đã thêm nhóm.' : 'Đã lưu nhóm.', 'success')
      setEditing(null)
      invalidateCatalog(queryClient)
    },
    onError: (error) => pushToast(describeCatalogError(error), 'error'),
  })

  const moveMutation = useMutation({
    mutationFn: (move: { groupId: number; direction: -1 | 1 }) =>
      Promise.all(planGroupMove(rows, move.groupId, move.direction).map((update) => saveServiceGroup(update))),
    onMutate: (move) => setMovedId(move.groupId),
    onError: (error) => pushToast(describeCatalogError(error), 'error'),
    // Thành công hay lỗi một phần đều tải lại để danh sách khớp server.
    onSettled: () => invalidateCatalog(queryClient),
  })

  const activeMutation = useMutation({
    mutationFn: (body: { groupId: number; active: boolean }) => setServiceGroupActive(body),
    onSuccess: (_result, body) => {
      pushToast(body.active ? 'Đã dùng lại nhóm.' : 'Đã ngừng dùng nhóm.', 'success')
      setToggling(null)
      invalidateCatalog(queryClient)
    },
    onError: (error) => {
      setToggling(null)
      pushToast(describeCatalogError(error), 'error')
    },
  })

  const locked = groupTypeLocked(editing?.group ?? null)
  const problem = validateGroupDraft(draft)

  return (
    <>
      <Dialog
        open={open}
        title="Nhóm dịch vụ"
        description={
          canEdit
            ? 'Thêm nhóm, đổi tên, chọn nhóm thường hoặc nhóm kèm thêm, ngừng dùng hoặc dùng lại. Dùng nút mũi tên để đổi thứ tự hiển thị.'
            : 'Bạn chưa có quyền quản lý nhóm dịch vụ (66).'
        }
        size="lg"
        onClose={saveMutation.isPending ? () => undefined : onClose}
        footer={
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        }
      >
        <div className="svc-groups">
          {canEdit && !editing ? (
            <div>
              <Button type="button" variant="primary" onClick={() => startEdit(null)}>
                Thêm nhóm
              </Button>
            </div>
          ) : null}

          {editing ? (
            <form
              className="svc-groups__form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!problem) saveMutation.mutate()
              }}
            >
              <strong>{editing.group ? `Sửa nhóm #${editing.group.groupId}` : 'Thêm nhóm'}</strong>
              <label className="ds-field">
                <span className="ds-field__label">Tên nhóm</span>
                <input
                  className="ds-input"
                  value={draft.name}
                  maxLength={50}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <div className="ds-field">
                <span className="ds-field__label">Loại nhóm</span>
                <RadioCards
                  ariaLabel="Loại nhóm"
                  value={draft.typeId === GROUP_TYPE_TOPPING ? 'topping' : 'normal'}
                  disabled={locked}
                  onChange={(kind) => setDraft({ ...draft, typeId: kind === 'topping' ? 2 : 0 })}
                  options={[
                    { value: 'normal', label: groupTypeLabel(GROUP_TYPE_NORMAL) },
                    { value: 'topping', label: groupTypeLabel(GROUP_TYPE_TOPPING) },
                  ]}
                />
              </div>
              {locked ? (
                <small className="svc-muted svc-groups__wide">
                  Nhóm đang có {editing.group?.serviceCount} món — chuyển món sang nhóm khác trước khi đổi loại
                  (đổi loại sẽ làm cả nhóm biến khỏi menu hoặc thành kèm thêm).
                </small>
              ) : null}
              {problem ? (
                <div className="svc-groups__wide">
                  <InlineAlert tone="warning">{problem}</InlineAlert>
                </div>
              ) : null}
              <div className="svc-groups__form-actions">
                <Button type="button" variant="secondary" disabled={saveMutation.isPending} onClick={() => setEditing(null)}>
                  Huỷ
                </Button>
                <Button type="submit" variant="primary" loading={saveMutation.isPending} disabled={problem !== null}>
                  Lưu nhóm
                </Button>
              </div>
            </form>
          ) : null}

          {groupsQuery.isLoading ? (
            <p className="svc-muted">Đang tải…</p>
          ) : groupsQuery.isError ? (
            <StateView title="Không tải được nhóm dịch vụ" description={describeCatalogError(groupsQuery.error)} />
          ) : groupsQuery.data && !groupsQuery.data.supported ? (
            <StateView
              title="Cơ sở dữ liệu chưa có bảng nhóm dịch vụ"
              description="Hãy khởi động lại máy chủ với phiên bản mới."
            />
          ) : rows.length === 0 ? (
            <StateView title="Chưa có nhóm nào" />
          ) : (
            <div className="svc-table-wrap">
              <table className="svc-table">
                <thead>
                  <tr>
                    <th>Nhóm</th>
                    <th>Loại</th>
                    <th className="is-num">Số món</th>
                    <th>Trạng thái</th>
                    <th aria-label="Thao tác" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((group, index) => (
                    <tr
                      key={group.groupId}
                      className={[group.active === 1 ? '' : 'is-off', group.groupId === movedId ? 'is-moved' : '']
                        .filter(Boolean)
                        .join(' ')}
                      ref={
                        group.groupId === movedId
                          ? (el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                          : undefined
                      }
                    >
                      <td>
                        <small className="svc-muted">#{group.groupId} </small>
                        <strong>{group.name}</strong>
                      </td>
                      <td>{groupTypeLabel(group.typeId)}</td>
                      <td className="is-num">{group.serviceCount}</td>
                      <td>
                        <StatusBadge tone={group.active === 1 ? 'success' : 'neutral'}>
                          {group.active === 1 ? 'Đang dùng' : 'Ngừng dùng'}
                        </StatusBadge>
                      </td>
                      <td className="svc-table__actions">
                        <IconButton
                          type="button"
                          label={`Chuyển nhóm ${group.name} lên`}
                          icon={<CaretUp size={16} weight="bold" aria-hidden="true" />}
                          variant="secondary"
                          disabled={!canEdit || index === 0 || moveMutation.isPending}
                          onClick={() => moveMutation.mutate({ groupId: group.groupId, direction: -1 })}
                        />
                        <IconButton
                          type="button"
                          label={`Chuyển nhóm ${group.name} xuống`}
                          icon={<CaretDown size={16} weight="bold" aria-hidden="true" />}
                          variant="secondary"
                          disabled={!canEdit || index === rows.length - 1 || moveMutation.isPending}
                          onClick={() => moveMutation.mutate({ groupId: group.groupId, direction: 1 })}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!canEdit || editing !== null}
                          onClick={() => startEdit(group)}
                        >
                          Sửa
                        </Button>
                        {group.active === 1 ? (
                          <Button
                            type="button"
                            variant="danger-outline"
                            disabled={!canEdit}
                            onClick={() => setToggling(group)}
                          >
                            Ngừng dùng
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!canEdit}
                            loading={activeMutation.isPending && activeMutation.variables?.groupId === group.groupId}
                            onClick={() => activeMutation.mutate({ groupId: group.groupId, active: true })}
                          >
                            Dùng lại
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Dialog>

      <ConfirmAction
        open={toggling !== null}
        title={`Ngừng dùng nhóm [${toggling?.name ?? ''}]?`}
        description={
          toggling && toggling.serviceCount > 0
            ? `Nhóm đang có ${toggling.serviceCount} món. Món trong nhóm sẽ không hiện ở menu iCafe và menu gọi món khi nhóm ngừng dùng. Dữ liệu giữ nguyên, dùng lại bất cứ lúc nào.`
            : 'Nhóm sẽ không còn được chọn khi thêm món. Dữ liệu giữ nguyên, dùng lại bất cứ lúc nào.'
        }
        confirmLabel="Ngừng dùng"
        danger
        pending={activeMutation.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => toggling && activeMutation.mutate({ groupId: toggling.groupId, active: false })}
      />
    </>
  )
}
