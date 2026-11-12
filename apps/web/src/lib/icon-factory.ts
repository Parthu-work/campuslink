import { createElement, type ReactNode, type Ref, type SVGProps } from 'react';

/**
 * The renderer behind every lucide icon (ADR 0015, prompt 3 U0). `lucide-icons.ts` (a Vite plugin)
 * points lucide-react's icon modules here instead of its own `createLucideIcon`, so icons keep
 * their lucide data and names but render through these few lines: the design language's 1.75
 * stroke by default, `aria-hidden` unless the icon is labelled, and no per-node React keys (the
 * nodes are passed as arguments, which needs none). Saves lucide's runtime and the keys' bytes.
 */
type IconElement = [tag: string, attrs: Record<string, string | number>, children?: IconElement[]];
type IconNode = IconElement[];
interface IconData {
  name?: string;
  size?: number;
  node: IconNode;
}

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  /** Accepted for lucide compatibility; strokes already scale with the 24-unit view box. */
  absoluteStrokeWidth?: boolean;
  ref?: Ref<SVGSVGElement>;
}

/** ADR 0015: icons draw at 1.75 (lucide's own default is 2). */
export const ICON_STROKE = 1.75;

const render = (node: IconNode): ReactNode[] =>
  node.map(([tag, attrs, children]) => createElement(tag, attrs, ...(children ? render(children) : [])));

const labelled = (props: Record<string, unknown>, children: ReactNode) =>
  children != null || Object.keys(props).some((k) => k === 'title' || k === 'role' || k.startsWith('aria-'));

export default function createLucideIcon(data: IconData | string, iconNode: IconNode = []) {
  const icon: IconData = typeof data === 'string' ? { name: data, node: iconNode } : data;
  const box = icon.size ?? 24;
  const nodes = render(icon.node);
  return function Icon({
    size = 24,
    strokeWidth = ICON_STROKE,
    absoluteStrokeWidth: _absolute,
    color = 'currentColor',
    className,
    children,
    ...rest
  }: IconProps) {
    return createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: `0 0 ${box} ${box}`,
        fill: 'none',
        stroke: color,
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: className ? `lucide ${className}` : 'lucide',
        ...(labelled(rest, children) ? {} : { 'aria-hidden': true }),
        ...rest,
      },
      ...nodes,
      children,
    );
  };
}
