export const PRICE_INPUT_MAX_LENGTH = 15

export function getPriceInputLengthError(value: string): string | null {
  return value.length > PRICE_INPUT_MAX_LENGTH
    ? 'El precio admite hasta 15 caracteres, incluidos puntos y coma. El importe anterior se conserva.'
    : null
}
