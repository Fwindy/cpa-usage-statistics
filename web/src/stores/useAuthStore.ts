import { create } from 'zustand';

export const useAuthStore = create<{ apiBase: string; managementKey: string }>(() => ({
  apiBase: '',
  managementKey: '',
}));
