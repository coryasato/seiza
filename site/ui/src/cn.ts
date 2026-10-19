import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's `cn`: class names joined, later Tailwind classes winning. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
