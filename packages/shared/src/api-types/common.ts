/** Generic API envelope types. */

export interface ApiError {
  error: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
