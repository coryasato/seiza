import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's `cn`: class names joined, later Tailwind classes winning. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

/** `data-*` attributes for `createElement`'s props, which JSX would allow
 *  but an object literal's excess-property check doesn't. */
export const data = (attributes: Record<string, string | number | undefined>): object =>
  Object.fromEntries(Object.entries(attributes).map(([name, value]) => [`data-${name}`, value]));
