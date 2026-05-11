import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Announcement } from '../types';

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<{ items: Announcement[] }>(`/api/announcements`),
    staleTime: 60 * 1000,
  });
}
