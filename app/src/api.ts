export type User = {
  username: string;
  email: string;
  bio: string | null;
  image: string | null;
  token: string;
};

export type Profile = {
  username: string;
  bio: string | null;
  image: string | null;
  following: boolean;
};

export type Article = {
  slug: string;
  title: string;
  description: string;
  body?: string;
  tagList: string[];
  createdAt: string;
  updatedAt: string;
  favorited: boolean;
  favoritesCount: number;
  author: Profile;
};

export type Comment = {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: Profile;
};

export type ApiErrorBody = { errors?: Record<string, string[]> };

export class ApiError extends Error {
  constructor(readonly status: number, readonly errors: Record<string, string[]>) {
    super(Object.values(errors).flat().join(', ') || `Request failed (${status})`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('jwtToken');
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Token ${token}`);
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, { server: ['The server returned an invalid response'] });
  }
  if (!response.ok) {
    const body = payload as ApiErrorBody;
    throw new ApiError(response.status, body.errors ?? { server: ['Request failed'] });
  }
  return payload as T;
}

export function imageUrl(image: string | null | undefined): string {
  if (!image || !/^https?:\/\//i.test(image)) return '/default-avatar.svg';
  return image;
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
