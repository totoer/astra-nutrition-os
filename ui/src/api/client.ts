import type {
  AuthResponse,
  AuthUser,
  RegisteredUser,
  DashboardResponse,
  DiaryEntry,
  Exercise,
  Product,
  ProductMeasure,
  ProductNutritionScanResult,
  ProgressEntry,
  RecipeDetail,
  RecipeSummary,
  WorkoutEntry,
  WorkoutPlan
} from '@/types';

const TOKEN_KEY = 'astra_access_token';
const NUTRITION_SCAN_MAX_LANDSCAPE_WIDTH = 1920;
const NUTRITION_SCAN_MAX_LANDSCAPE_HEIGHT = 1080;
const NUTRITION_SCAN_IMAGE_TYPE = 'image/jpeg';
const NUTRITION_SCAN_IMAGE_QUALITY = 0.9;
let unauthorizedHandler: (() => void) | null = null;

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  }
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    headers
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      clearAccessToken();
      unauthorizedHandler?.();
    }
    const detail = Array.isArray(payload?.details) ? payload.details[0]?.msg : payload?.details;
    throw new Error(payload?.error || detail || 'Ошибка');
  }
  if (path === 'products' && Array.isArray(payload)) {
    payload.sort((a: Product, b: Product) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
  }
  return payload as T;
}

function write<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function fullHdSize(width: number, height: number) {
  const landscape = width >= height;
  const maxWidth = landscape ? NUTRITION_SCAN_MAX_LANDSCAPE_WIDTH : NUTRITION_SCAN_MAX_LANDSCAPE_HEIGHT;
  const maxHeight = landscape ? NUTRITION_SCAN_MAX_LANDSCAPE_HEIGHT : NUTRITION_SCAN_MAX_LANDSCAPE_WIDTH;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Не удалось сжать изображение'));
    }, type, quality);
  });
}

function compressedImageName(name: string) {
  const basename = name.replace(/\.[^.]+$/, '') || 'nutrition-label';
  return `${basename}-full-hd.jpg`;
}

async function compressImageForNutritionScan(file: File) {
  const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let bitmap: ImageBitmap | null = null;

  try {
    const size = fullHdSize(source.width, source.height);
    bitmap = await createImageBitmap(source, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high'
    });

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить изображение');

    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await canvasBlob(canvas, NUTRITION_SCAN_IMAGE_TYPE, NUTRITION_SCAN_IMAGE_QUALITY);
    return new File([blob], compressedImageName(file.name), {
      type: NUTRITION_SCAN_IMAGE_TYPE,
      lastModified: file.lastModified
    });
  } finally {
    bitmap?.close();
    source.close();
  }
}

export const api = {
  me: () => request<AuthUser>('auth/me'),
  users: () => request<RegisteredUser[]>('auth/users'),
  login: (email: string, password: string) => request<AuthResponse>('auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  }),
  register: (email: string, password: string) => request<AuthResponse>('auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  }),
  logout: () => write<{ ok: boolean }>('POST', 'auth/logout'),
  dashboard: () => request<DashboardResponse>('dashboard'),
  products: () => request<Product[]>('products'),
  scanProductNutrition: async (file: File) => {
    const body = new FormData();
    body.append('image', await compressImageForNutritionScan(file));
    return request<ProductNutritionScanResult>('products/scan-nutrition-label', {
      method: 'POST',
      body
    });
  },
  productMeasures: () => request<ProductMeasure[]>('product-measures'),
  recipes: () => request<RecipeSummary[]>('recipes'),
  recipe: (id: number) => request<RecipeDetail>(`recipes/${id}`),
  requestRecipeSubmission: (id: number) => write<RecipeSummary>('POST', `recipes/${id}/submission-request`),
  cancelRecipeSubmission: (id: number) => write<RecipeSummary>('DELETE', `recipes/${id}/submission-request`),
  moderateRecipe: (id: number, action: 'accept' | 'reject' | 'revision', note?: string) => write<RecipeSummary>('POST', `recipes/${id}/moderation`, { action, note }),
  diary: () => request<DiaryEntry[]>('diary'),
  progress: () => request<ProgressEntry[]>('progress'),
  workouts: () => request<WorkoutEntry[]>('workouts'),
  workoutPlans: () => request<WorkoutPlan[]>('workout-plans'),
  updateWorkoutPlan: (id: number, body: unknown) => write<WorkoutPlan>('PUT', `workout-plans/${id}`, body),
  completeWorkoutPlan: (id: number) => write<WorkoutPlan>('POST', `workout-plans/${id}/complete`),
  cancelWorkoutPlan: (id: number) => write<WorkoutPlan>('POST', `workout-plans/${id}/cancel`),
  exercises: () => request<Exercise[]>('exercises'),
  post: <T = { ok: boolean }>(path: string, body: unknown) => write<T>('POST', path, body),
  put: <T = { ok: boolean }>(path: string, body: unknown) => write<T>('PUT', path, body),
  delete: <T = { ok: boolean }>(path: string) => write<T>('DELETE', path)
};
