/** shadcn's ToggleGroup on Base UI's (`@base-ui/react/toggle-group`,
 *  `@base-ui/react/toggle`): a segmented control, one item pressed. */

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';
import { createElement as h, type ComponentProps } from 'react';
import { cn } from '../cn.ts';

export function ToggleGroup({ className, ...props }: ComponentProps<typeof BaseToggleGroup>) {
  return h(BaseToggleGroup, {
    className: cn('inline-flex w-fit items-center rounded-md border bg-background p-0.5 shadow-xs data-[disabled]:opacity-60 dark:bg-input/30', className as string),
    ...props,
  });
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof Toggle>) {
  return h(Toggle, {
    className: cn(
      "inline-flex h-8 min-w-0 shrink-0 items-center justify-center gap-2 rounded-sm px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none data-[pressed]:bg-accent data-[pressed]:text-accent-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
      className as string,
    ),
    ...props,
  });
}
