import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  children?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className = '', type = 'button', ...rest }: Props) {
  const cls = [
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'ghost' && 'btn-ghost',
    variant === 'danger' && 'btn-danger',
    size === 'sm' && 'btn-sm',
    !children && 'btn-icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.8} aria-hidden />}
      {children}
    </button>
  );
}
