/**
 * shadcn's Sidebar parts in its Nova style (shadcn's `base-nova` registry),
 * less `font-medium` (one weight): the groups, their labels, and the menu
 * with its items. Only the parts: shadcn's provider, its sheet for phones,
 * and its cookie aren't here, since a sidebar's state and layout are its
 * page's (the observatory's, applied before first paint), and an item is a
 * link, so it works before any JS.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { createElement as h, type ComponentProps } from 'react';
import { cn } from '../cn.ts';

export function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return h('div', { 'data-slot': 'sidebar-group', 'data-sidebar': 'group', className: cn('relative flex w-full min-w-0 flex-col p-2', className), ...props });
}

export function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return h('div', {
    'data-slot': 'sidebar-group-label',
    'data-sidebar': 'group-label',
    className: cn('flex h-8 shrink-0 items-center rounded-md px-2 text-xs text-sidebar-foreground/70 ring-sidebar-ring outline-hidden [&>svg]:size-4 [&>svg]:shrink-0', className),
    ...props,
  });
}

export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return h('ul', { 'data-slot': 'sidebar-menu', 'data-sidebar': 'menu', className: cn('flex w-full min-w-0 flex-col gap-0', className), ...props });
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return h('li', { 'data-slot': 'sidebar-menu-item', 'data-sidebar': 'menu-item', className: cn('group/menu-item relative', className), ...props });
}

export const sidebarMenuButtonVariants = cva(
  'peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline: 'bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/** A menu item's link; `isActive` fills it (the page it's on). */
export function SidebarMenuLink({ className, isActive = false, variant, size, ...props }: ComponentProps<'a'> & { isActive?: boolean } & VariantProps<typeof sidebarMenuButtonVariants>) {
  return h('a', {
    'data-slot': 'sidebar-menu-button',
    'data-sidebar': 'menu-button',
    'data-size': size ?? 'default',
    'data-active': isActive ? '' : undefined,
    'aria-current': isActive ? 'page' : undefined,
    className: cn(sidebarMenuButtonVariants({ variant, size }), className),
    ...props,
  });
}
