import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class names, merged so a later Tailwind utility wins over an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Two letters for an avatar: first and last initial, or the first two. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * A stable hue for a name, so the same person always gets the same avatar
 * tint. Kept low in chroma so a wall of avatars reads as texture, not
 * confetti.
 */
export function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
