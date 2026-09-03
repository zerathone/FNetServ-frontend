// API Chặn web (Web Block) — Task 2.20 lane L4A.
// Danh sách URL bị chặn trên máy trạm + nút "Áp dụng" đẩy xuống các máy.
import { apiGet, apiPost, apiPut, apiDelete } from './client';

export interface WebBlockItem {
  id: number;
  url: string;
  title: string;
  active: boolean;
  description: string;
  addedBy: number;
}

export interface WebBlockList {
  total: number;
  items: WebBlockItem[];
}

export interface WebBlockWriteBody {
  url: string;
  title: string;
  description: string;
  active: boolean;
}

export const getWebBlocks = async (params: {
  limit: number;
  offset: number;
  url?: string;
  title?: string;
}): Promise<WebBlockList> => {
  const qs = new URLSearchParams();
  qs.set('limit', String(params.limit));
  qs.set('offset', String(params.offset));
  if (params.url) qs.set('url', params.url);
  if (params.title) qs.set('title', params.title);
  return apiGet<WebBlockList>(`/webblock?${qs.toString()}`);
};

export const createWebBlock = async (data: WebBlockWriteBody): Promise<{ id: number }> => {
  return apiPost<{ id: number }, WebBlockWriteBody>('/webblock', data);
};

export const updateWebBlock = async (id: number, data: WebBlockWriteBody): Promise<void> => {
  await apiPut<void, WebBlockWriteBody>(`/webblock?id=${id}`, data);
};

export const deleteWebBlock = async (id: number): Promise<void> => {
  await apiDelete<void>(`/webblock?id=${id}`);
};

// Đẩy danh sách chặn hiện tại xuống toàn bộ máy trạm.
export const acceptWebBlock = async (): Promise<void> => {
  await apiPost<void, Record<string, never>>('/webblock/accept', {});
};
