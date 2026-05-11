import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Announcement, AnnouncementSeverity } from '../types';

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<{ items: Announcement[] }>(`/api/announcements`),
    staleTime: 60 * 1000,
  });
}

export function useAdminAnnouncements() {
  return useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: () => api<{ items: Announcement[] }>(`/admin/api/announcements`),
  });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { severity: AnnouncementSeverity; body: string }) =>
      api<Announcement>(`/admin/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api<void>(`/admin/api/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}
