/** shadcn's Collapsible on Base UI's (`@base-ui/react/collapsible`), in its
 *  Nova style (shadcn's `base-nova` registry): Base UI's parts with their
 *  slots, styled where they're used. */

import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import { createElement as h, type ComponentProps } from 'react';
import { data } from '../cn.ts';

export const Collapsible = (props: ComponentProps<typeof BaseCollapsible.Root>) => h(BaseCollapsible.Root, { ...data({ slot: 'collapsible' }), ...props });
export const CollapsibleTrigger = (props: ComponentProps<typeof BaseCollapsible.Trigger>) => h(BaseCollapsible.Trigger, { ...data({ slot: 'collapsible-trigger' }), ...props });
export const CollapsibleContent = (props: ComponentProps<typeof BaseCollapsible.Panel>) => h(BaseCollapsible.Panel, { ...data({ slot: 'collapsible-content' }), ...props });
