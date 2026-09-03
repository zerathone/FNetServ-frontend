// API Khuyến mãi (Promotion) — Task 2.20 lane L4A.
// 3 nhóm KM gắn theo nhóm giá (priceId = id nhóm người dùng): member / time / discount.
import { apiGet, apiPut } from './client';

// ---- Member (KM nạp tiền) ----
export interface PromoAccumulate {
  charge: number;
  bonus: number;
  beginDate: string;
  endDate: string;
}
export interface PromoFreeTier {
  charge: number;
  free: number;
}
export interface PromoPercentTier {
  charge: number;
  percent: number;
}
export interface PromoFirstDeposit {
  percent: number;
  minAmount: number;
  beginDate?: string;
  endDate?: string;
}

export type MemberPolicy = 'accumulate' | 'free' | 'percent' | 'none';

export interface PromotionMember {
  priceId: number;
  accumulate: PromoAccumulate | null;
  freeTiers: PromoFreeTier[];
  percentTiers: PromoPercentTier[];
  firstDeposit: PromoFirstDeposit | null;
}

export interface PromotionMemberBody {
  priceId: number;
  apply: boolean;
  beginDate: string;
  endDate: string;
  policy: MemberPolicy;
  charge?: number;
  bonus?: number;
  freeTiers?: PromoFreeTier[];
  percentTiers?: PromoPercentTier[];
  firstDeposit?: { percent: number; minAmount: number };
}

export const getPromotionMember = async (priceId: number): Promise<PromotionMember> => {
  return apiGet<PromotionMember>(`/promotion/member?priceId=${priceId}`);
};

export const savePromotionMember = async (body: PromotionMemberBody): Promise<void> => {
  await apiPut<void, PromotionMemberBody>('/promotion/member', body);
};

// ---- Time (KM khung giờ vàng) ----
export interface PromoTimeRow {
  price: number;
  beginTime: string;
  endTime: string;
  machineGroupId: number;
  dayOfWeekMask: number;
  beginDate?: string;
  endDate?: string;
}

export interface PromotionTime {
  priceId: number;
  rows: PromoTimeRow[];
}

export interface PromotionTimeBody {
  priceId: number;
  beginDate: string;
  endDate: string;
  rows: Array<Omit<PromoTimeRow, 'beginDate' | 'endDate'>>;
}

export const getPromotionTime = async (priceId: number): Promise<PromotionTime> => {
  return apiGet<PromotionTime>(`/promotion/time?priceId=${priceId}`);
};

export const savePromotionTime = async (body: PromotionTimeBody): Promise<void> => {
  await apiPut<void, PromotionTimeBody>('/promotion/time', body);
};

// ---- Discount (KM theo mức/kỳ hạn) ----
export interface PromoDiscountRow {
  price: number;
  term: number;
  promotionOrder: number; // 0 | 1
  machineGroupId: number;
  beginDate?: string;
  endDate?: string;
}

export interface PromotionDiscount {
  priceId: number;
  rows: PromoDiscountRow[];
}

export interface PromotionDiscountBody {
  priceId: number;
  beginDate: string;
  endDate: string;
  rows: Array<Omit<PromoDiscountRow, 'beginDate' | 'endDate'>>;
}

export const getPromotionDiscount = async (priceId: number): Promise<PromotionDiscount> => {
  return apiGet<PromotionDiscount>(`/promotion/discount?priceId=${priceId}`);
};

export const savePromotionDiscount = async (body: PromotionDiscountBody): Promise<void> => {
  await apiPut<void, PromotionDiscountBody>('/promotion/discount', body);
};
