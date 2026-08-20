/**
 * @fileoverview The class-name helper every shadcn-style component uses.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names, letting later Tailwind utilities win over earlier
 * ones the way shadcn/ui components expect.
 * @param inputs The class values to combine.
 * @returns The merged class string.
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
