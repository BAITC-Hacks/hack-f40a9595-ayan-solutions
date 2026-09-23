import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RoleCode } from "./types";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const roles: Record<RoleCode, { label: string; color: string }> = {
  coordinator: { label: "Координатор", color: "var(--gm-role-coordinator)" },
  distributor: { label: "Распределитель", color: "var(--gm-role-distributor)" },
  transit: { label: "Транзит", color: "var(--gm-role-transit)" },
  consolidator: { label: "Консолидатор", color: "var(--gm-role-consolidator)" },
  terminal: { label: "Конечный получатель", color: "var(--gm-role-terminal)" },
  peripheral: { label: "Периферия", color: "var(--gm-role-peripheral)" },
};
export const count = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
export const score = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n);
export function money(value: string) {
  const [whole, fraction = "00"] = value.split(".");
  return `${BigInt(whole).toLocaleString("ru-RU")},${fraction.padEnd(2, "0")} ₸`;
}
export function compactMoney(value: string) {
  return (
    new Intl.NumberFormat("ru-RU", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value)) + " ₸"
  );
}
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
export const clusterColor = (id: number) =>
  `hsl(${(id * 137.508 + 25) % 360} 68% 42%)`;
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "offline",
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError("Нет соединения с локальным сервисом.");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(
      error?.message || "Нет соединения с локальным сервисом.",
      response.status,
      error?.code || "offline",
      error?.request_id,
    );
  }
  return response.json();
}
export async function download(url: string, name: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error("Не удалось скачать артефакт. Повторите запрос.");
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
