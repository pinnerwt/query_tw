export type SkillRow = { name: string; years_min: number };

export type Filters = {
  cities?: string[];
  categories?: string[];
  remote_ok?: boolean;
  pay_min?: number;
  pay_max?: number;
  pay_period?: 'monthly' | 'hourly' | 'daily' | 'per_case';
  period?: '24h' | '7d' | '30d';
  job_types?: string[];
  keyword?: string;
  skills?: SkillRow[];
  experience?: SkillRow[];
  hide_spam: boolean;
};

export type Profile = {
  id: string;
  name: string;
  filters: Filters;
};

export type Config = {
  version: number;
  profiles: Profile[];
  active_profile_id: string;
  favorites: string[]; // hex job ids
};

export type SkillReq = { name: string; years_min?: number };
export type RoleReq = { role: string; years_min?: number };
export type LangReq = { name: string; level?: string };
export type Pay = { min?: number; max?: number; period?: string; raw?: string };
export type Author = { handle: string; name?: string };

export type JobView = {
  id: string;
  title: string;
  company?: string;
  location: { city?: string; district?: string; remote: boolean };
  job_type: string;
  pay: Pay;
  requirements: { skills: SkillReq[]; experience: RoleReq[]; languages: LangReq[] };
  tags: string[];
  categories: string[];
  posted_at: string;
  source_url: string;
  author: Author;
  spam_score: number;
  raw_excerpt?: string;
};

export type JobsPage = {
  jobs: JobView[];
  next_cursor?: string;
};

export type DictItem = { id: number; canonical: string; aliases: string[] };

export const defaultFilters = (): Filters => ({ hide_spam: true });

export type AnnouncementSeverity = 'info' | 'warning' | 'critical';

export type Announcement = {
  id: number;
  severity: AnnouncementSeverity;
  body: string;
  created_at: string;
};
