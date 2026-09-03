import { apiDelete, apiGet, apiPost, apiPut } from './client'

export type AppListType = 'allow' | 'restrict'

export interface AppEntry {
  id: number
  name: string
  description: string
  addedBy: number
  restrictType: number
  hash: string
}

export interface AppWriteBody {
  name: string
  description: string
  restrictType?: number
  hash?: string
}

export const appsApi = {
  getList: (type: AppListType) =>
    apiGet<AppEntry[]>(`/app/${type}`),

  addApp: (type: AppListType, data: AppWriteBody) =>
    apiPost<{ id: number }, AppWriteBody>(`/app/${type}`, data),

  updateApp: (type: AppListType, id: number, data: AppWriteBody) =>
    apiPut<void, AppWriteBody>(`/app/${type}?id=${id}`, data),

  deleteApp: (type: AppListType, id: number) =>
    apiDelete<void>(`/app/${type}?id=${id}`),
}
