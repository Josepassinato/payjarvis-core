export function currency(value: number, cur = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cur,
  }).format(value);
}

export function shortDate(date: string | Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}
