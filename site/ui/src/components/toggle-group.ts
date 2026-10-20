/** shadcn's Toggle and ToggleGroup on Base UI's (`@base-ui/react/toggle`,
 *  `@base-ui/react/toggle-group`), in its Nova style (shadcn's `base-nova`
 *  registry), less `font-medium` (one weight), plus the site's `segmented`
 *  variant: the pressed item `--background`, raised on a `--muted` track
 *  (root docs/DECISIONS.md, "Comparison protocol": the site's theme). */

import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { createContext, createElement as h, useContext, type ComponentProps, type CSSProperties } from 'react';
import { cn, data } from '../cn.ts';

export const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg text-sm whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-muted',
        segmented:
          'rounded-md bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:ring-1 aria-pressed:ring-border',
      },
      size: {
        default: 'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ToggleVariants = VariantProps<typeof toggleVariants>;

export function Toggle({ className, variant, size, ...props }: ComponentProps<typeof BaseToggle> & ToggleVariants) {
  return h(BaseToggle, { ...data({ slot: 'toggle' }), className: cn(toggleVariants({ variant, size }), className as string), ...props });
}

const ToggleGroupContext = createContext<ToggleVariants & { spacing?: number }>({ variant: 'default', size: 'default', spacing: 2 });

export function ToggleGroup({
  className,
  variant,
  size,
  spacing = variant === 'segmented' ? 0.5 : 2,
  children,
  ...props
}: ComponentProps<typeof BaseToggleGroup> & ToggleVariants & { spacing?: number }) {
  return h(
    BaseToggleGroup,
    {
      ...data({ slot: 'toggle-group', variant: variant ?? undefined, size: size ?? undefined, spacing }),
      style: { '--gap': spacing } as CSSProperties,
      className: cn(
        'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[variant=segmented]:bg-muted data-[variant=segmented]:p-0.5',
        className as string,
      ),
      ...props,
    },
    h(ToggleGroupContext.Provider, { value: { variant, size, spacing } }, children),
  );
}

export function ToggleGroupItem({ className, children, variant, size, ...props }: ComponentProps<typeof BaseToggle> & ToggleVariants) {
  const context = useContext(ToggleGroupContext);
  return h(
    BaseToggle,
    {
      ...data({ slot: 'toggle-group-item', variant: context.variant || variant || undefined, size: context.size || size || undefined, spacing: context.spacing }),
      className: cn(
        'shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10',
        toggleVariants({ variant: context.variant || variant, size: context.size || size }),
        className as string,
      ),
      ...props,
    },
    children,
  );
}
