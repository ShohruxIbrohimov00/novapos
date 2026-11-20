import { cleanNumInput, money, parseNum } from '@/lib/format';
import { Field, type FieldProps } from './Field';

/**
 * Son maydoni: telefonda raqamli klaviatura, vergul ham qabul qilinadi,
 * pul bo'lsa ostida o'qishli ko'rinish ("12 500 so'm").
 */
export function NumField({ value, onValue, isMoney, decimals = true, hint, ...rest }:
  Omit<FieldProps, 'value' | 'onChange'> & { value: string; onValue: (v: string) => void; isMoney?: boolean; decimals?: boolean }) {
  const n = parseNum(value);
  const auto = isMoney && n >= 1000 ? money(n) : undefined;
  return (
    <Field inputMode={decimals ? 'decimal' : 'numeric'} autoComplete="off" value={value}
           onChange={(e) => onValue(cleanNumInput(e.target.value, decimals))}
           hint={hint ?? auto} {...rest} />
  );
}
