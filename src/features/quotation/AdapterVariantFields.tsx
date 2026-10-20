import type { AdapterPresentation, QuotationRow } from './model'

export interface AdapterVariantDraft {
  productKey: string
  size: string
  presentation: AdapterPresentation | ''
}

interface AdapterVariantFieldsProps {
  value: AdapterVariantDraft
  existingRows: QuotationRow[]
  selectedRowId: string
  showVariantFields?: boolean
  onChange: (value: AdapterVariantDraft) => void
  onChoose: (rowId: string) => void
}

const presentations: Record<AdapterPresentation, string> = {
  unit: 'Unidad', pair: 'Par', set: 'Juego',
}

export function AdapterVariantFields({ value, existingRows, selectedRowId, showVariantFields = true, onChange, onChoose }: AdapterVariantFieldsProps) {
  return (
    <fieldset className="adapter-fields">
      <legend>Variante de aros</legend>
      {existingRows.length > 0 && (
        <label>Tomar datos de una variante
          <select value={selectedRowId} onChange={(event) => onChoose(event.target.value)}>
            <option value="">Nueva variante</option>
            {existingRows.map((row) => row.adapterVariant && (
              <option value={row.id} key={row.id}>
                {row.concept} · {row.adapterVariant.size}″ · {presentations[row.adapterVariant.presentation]} · {row.currency} {row.priceState === 'included' ? 'Incluido' : row.unitPrice || 'Pendiente'}
              </option>
            ))}
          </select>
        </label>
      )}
      {showVariantFields && <div className="form-grid">
        <label>Medida en pulgadas
          <input inputMode="decimal" value={value.size} maxLength={30} placeholder="6,5"
            onChange={(event) => onChange({ ...value, size: event.target.value })} />
        </label>
        <label>Cantidad expresada en
          <select value={value.presentation} onChange={(event) => {
            const presentation = event.target.value
            if (presentation === '' || presentation === 'unit' || presentation === 'pair' || presentation === 'set') {
              onChange({ ...value, presentation })
            }
          }}>
            <option value="">Seleccionar</option>
            <option value="unit">Unidades</option>
            <option value="pair">Pares</option>
            <option value="set">Juegos</option>
          </select>
        </label>
      </div>}
      {showVariantFields && <p className="field-help">Completá medida y presentación para agrupar los aros. La cantidad y el precio corresponden a esa presentación; un par cuenta como un par.</p>}
      {existingRows.length > 0 && <p className="field-help">Para sumar cantidad al mismo producto, tomá los datos de su variante arriba.</p>}
    </fieldset>
  )
}
