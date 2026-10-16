import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The class-joining helper every shadcn/ui and 21st.dev component imports from "@/lib/utils".
// Money Manager's own components join classes by hand, so this (and tailwind-merge's ~7 KB) is only
// bundled with screens that use a pasted component.

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
