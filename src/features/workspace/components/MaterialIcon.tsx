import type { CSSProperties } from 'react';

type MaterialIconProps = {
  name: string;
  variant?: 'filled' | 'outlined' | 'round' | 'sharp' | 'two-tone';
  size?: number;
  className?: string;
  style?: CSSProperties;
};

const variantClasses = {
  filled: 'material-icons',
  outlined: 'material-icons-outlined',
  round: 'material-icons-round',
  sharp: 'material-icons-sharp',
  'two-tone': 'material-icons-two-tone',
};

export default function MaterialIcon({
  name,
  variant = 'filled',
  size = 20,
  className = '',
  style,
}: MaterialIconProps) {
  return (
    <span
      className={`${variantClasses[variant]} ${className}`.trim()}
      aria-hidden="true"
      style={{
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {name}
    </span>
  );
}