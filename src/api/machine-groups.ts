import { apiGet, apiPost, apiPut, apiDelete } from './client';

export interface MachineGroup {
  id: number;
  name: string;
  description: string;
  active: number;
  anonymPrice: number | null;
  anonymPriceAmbiguous?: boolean;
  anonymPrices?: MachineGroupPrice[];
}

export interface MachineGroupPrice {
  priceId: number;
  priceType: string;
  price: number;
}

export interface MachineGroupWriteBody {
  name: string;
  description: string;
  active?: number;
  anonymPrice?: number;
}

export const getMachineGroups = async (): Promise<MachineGroup[]> => {
  return apiGet<MachineGroup[]>('/machinegroup');
};

export const createMachineGroup = async (data: MachineGroupWriteBody): Promise<{ id: number }> => {
  return apiPost<{ id: number }, MachineGroupWriteBody>('/machinegroup', data);
};

export const updateMachineGroup = async (id: number, data: MachineGroupWriteBody): Promise<void> => {
  await apiPut<void, MachineGroupWriteBody>(`/machinegroup?id=${id}`, data);
};

export const deleteMachineGroup = async (id: number): Promise<void> => {
  await apiDelete<void>(`/machinegroup?id=${id}`);
};
