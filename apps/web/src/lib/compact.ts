/** Remove `undefined` dos tipos de propriedade, preservando a opcionalidade (`?`). */
export type Compact<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]: Compact<Exclude<T[K], undefined>> }
    : T;

/**
 * Remove recursivamente propriedades `undefined`. Formulários produzem `{ url: undefined }`,
 * mas o contrato (com exactOptionalPropertyTypes) espera a chave ausente.
 */
export const compact = <T>(value: T): Compact<T> => {
  if (Array.isArray(value)) return value as Compact<T>;
  if (value === null || typeof value !== 'object') return value as Compact<T>;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, compact(entry)]),
  ) as Compact<T>;
};
