import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Filters, JobsPage, JobView, DictItem } from '../types';
import { encodeFilters } from '../lib/filtersWire';

export function jobsKey(filters: Filters) {
  return ['jobs', encodeFilters(filters)] as const;
}

export function useJobsInfinite(filters: Filters) {
  const enc = encodeFilters(filters);
  return useInfiniteQuery({
    queryKey: ['jobs', enc],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (enc) params.set('filters', enc);
      if (pageParam) params.set('cursor', pageParam);
      params.set('limit', '20');
      return api<JobsPage>(`/api/jobs?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => api<JobView>(`/api/jobs/${id}`),
    enabled: !!id,
  });
}

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => api<{ skills: DictItem[] }>(`/api/skills`),
    staleTime: 5 * 60 * 1000,
  });
}
export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api<{ roles: DictItem[] }>(`/api/roles`),
    staleTime: 5 * 60 * 1000,
  });
}
export function useCities() {
  return useQuery({
    queryKey: ['cities'],
    queryFn: () => api<{ cities: string[] }>(`/api/cities`),
    staleTime: 60 * 60 * 1000,
  });
}
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: DictItem[] }>(`/api/categories`),
    staleTime: 5 * 60 * 1000,
  });
}
