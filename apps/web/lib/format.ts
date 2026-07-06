export function formatPriceCents(cents: number): string {
  return `NT$${Math.round(cents / 100)}`;
}
